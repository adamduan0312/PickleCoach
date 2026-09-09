/**
 * Booking-intent attempt idempotency:
 *   - same attempt key → same PaymentIntent (double-submit / refresh)
 *   - authorize → decline → same student/lesson/time/court with stale key → fresh usable PI
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking } from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { isPaymentIntentUsableForCheckout } from '../../utils/bookingIntentContract.js';
import { createInMemoryPaymentIntentDouble } from '../helpers/inMemoryPaymentIntentDouble.mjs';
import { createBookingJourneyFixture } from '../helpers/integrationFixture.mjs';
import { startTestServer, api } from '../helpers/httpApp.mjs';

let dbOk = false;
if (RUN) {
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch (e) {
    console.warn('[http-integration] DB unavailable:', e.message);
  }
}

const describeHttp = RUN && dbOk ? describe : describe.skip;

async function login(baseUrl, email, password) {
  const res = await api(baseUrl, 'POST', '/api/auth/login', {
    body: { email, password },
  });
  assert.equal(res.status, 200, res.text);
  return res.json.data.token;
}

describeHttp('HTTP integration: booking intent attempt idempotency', () => {
  let server = null;
  let stripeDouble = null;
  /** @type {Array<() => Promise<void>>} */
  const cleanups = [];

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch {
        /* ignore */
      }
    }
    if (server) await server.close();
  });

  it('same booking_attempt_id reuses the same PaymentIntent', async () => {
    const fixture = await createBookingJourneyFixture();
    cleanups.push(() => fixture.cleanup());
    const { baseUrl } = server;
    const token = await login(baseUrl, fixture.student.email, fixture.password);
    const attemptId = `same_attempt_${Date.now()}`;

    const body = {
      lesson_id: fixture.lesson.id,
      scheduled_at: fixture.scheduledAt.toISOString(),
      court_location_id: fixture.court.id,
      payment_method: 'stripe',
      booking_attempt_id: attemptId,
    };

    const first = await api(baseUrl, 'POST', '/api/booking-intents', { token, body });
    assert.equal(first.status, 201, first.text);
    const second = await api(baseUrl, 'POST', '/api/booking-intents', { token, body });
    assert.equal(second.status, 201, second.text);

    assert.equal(first.json.data.payment_intent_id, second.json.data.payment_intent_id);
    assert.equal(first.json.data.client_secret, second.json.data.client_secret);

    const live = await stripeDouble.getPaymentIntent(first.json.data.payment_intent_id);
    assert.equal(isPaymentIntentUsableForCheckout(live), true);
  });

  it('authorize → decline → same slot with stale key returns a fresh usable PaymentIntent', async () => {
    const fixture = await createBookingJourneyFixture();
    cleanups.push(() => fixture.cleanup());
    const { baseUrl } = server;
    const studentToken = await login(baseUrl, fixture.student.email, fixture.password);
    const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);

    // Mimic the old frontend bug: param-only key reused across decline → rebook.
    const staleKey = `pc_${fixture.student.id}_${fixture.lesson.id}_${fixture.scheduledAt.toISOString()}_${fixture.court.id}`;

    const intent1 = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        idempotency_key: staleKey,
      },
      headers: { 'Idempotency-Key': staleKey },
    });
    assert.equal(intent1.status, 201, intent1.text);
    const piA = intent1.json.data.payment_intent_id;
    assert.ok(piA);

    const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
      token: studentToken,
      body: { payment_intent_id: piA },
    });
    assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
    const bookingId = confirmRes.json.data.booking.id;

    const declineRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/decline`, {
      token: coachToken,
      body: {
        message_to_student: 'Sorry, this time no longer works.',
        decline_reason_code: 'availability_conflict',
      },
    });
    assert.equal(declineRes.status, 200, declineRes.text);
    assert.equal((await Booking.findByPk(bookingId)).status, 'cancelled');

    const canceled = await stripeDouble.getPaymentIntent(piA);
    assert.equal(canceled.status, 'canceled');

    const intent2 = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        idempotency_key: staleKey,
      },
      headers: { 'Idempotency-Key': staleKey },
    });
    assert.equal(intent2.status, 201, intent2.text);
    const piB = intent2.json.data.payment_intent_id;
    assert.ok(piB);
    assert.notEqual(piB, piA, 'must not return the canceled PaymentIntent for a new checkout');

    const liveB = await stripeDouble.getPaymentIntent(piB);
    assert.equal(isPaymentIntentUsableForCheckout(liveB), true);
    assert.ok(intent2.json.data.client_secret);
    assert.notEqual(intent2.json.data.client_secret, intent1.json.data.client_secret);
  });

  it('new booking_attempt_id after decline creates a distinct PaymentIntent', async () => {
    const fixture = await createBookingJourneyFixture();
    cleanups.push(() => fixture.cleanup());
    const { baseUrl } = server;
    const studentToken = await login(baseUrl, fixture.student.email, fixture.password);
    const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);
    const slotIso = fixture.scheduledAt.toISOString();

    const first = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: slotIso,
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        booking_attempt_id: `attempt_a_${Date.now()}`,
      },
    });
    assert.equal(first.status, 201, first.text);

    const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
      token: studentToken,
      body: { payment_intent_id: first.json.data.payment_intent_id },
    });
    assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
    const bookingId = confirmRes.json.data.booking.id;

    const declineRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/decline`, {
      token: coachToken,
      body: {
        message_to_student: 'Please book again.',
        decline_reason_code: 'availability_conflict',
      },
    });
    assert.equal(declineRes.status, 200, declineRes.text);

    const second = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: slotIso,
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        booking_attempt_id: `attempt_b_${Date.now()}`,
      },
    });
    assert.equal(second.status, 201, second.text);
    assert.notEqual(second.json.data.payment_intent_id, first.json.data.payment_intent_id);
    const live = await stripeDouble.getPaymentIntent(second.json.data.payment_intent_id);
    assert.equal(isPaymentIntentUsableForCheckout(live), true);
  });
});

if (!RUN) {
  describe('HTTP integration (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
