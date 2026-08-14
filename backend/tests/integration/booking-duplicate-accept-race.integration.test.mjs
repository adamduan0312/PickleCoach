/**
 * Deep HTTP integration: concurrent duplicate coach accept must not double-capture.
 *
 * Setup: student intent → confirm (pending + authorized).
 * Then two concurrent PUT /bookings/:id/accept from the same coach.
 *
 * Expected:
 *   - exactly one accept succeeds (200)
 *   - the other is rejected (booking no longer pending)
 *   - booking confirmed once
 *   - payment captured once
 *   - Stripe capture invoked at most once for a real capture (idempotent replay OK if already succeeded)
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking, Payment } from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
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

describeHttp('HTTP integration: concurrent duplicate accept race', () => {
  let server = null;
  let fixture = null;
  let stripeDouble = null;

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('allows exactly one concurrent accept and a single Stripe capture', async () => {
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;

    const studentLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.student.email, password: fixture.password },
    });
    const coachLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.coach.email, password: fixture.password },
    });
    assert.equal(studentLogin.status, 200, studentLogin.text);
    assert.equal(coachLogin.status, 200, coachLogin.text);
    const studentToken = studentLogin.json.data.token;
    const coachToken = coachLogin.json.data.token;

    const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        idempotency_key: `dup_accept_${Date.now()}`,
      },
    });
    assert.equal(intentRes.status, 201, intentRes.text);
    const paymentIntentId = intentRes.json.data.payment_intent_id;

    const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
      token: studentToken,
      body: { payment_intent_id: paymentIntentId },
    });
    assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
    const bookingId = confirmRes.json?.data?.booking?.id;
    assert.ok(bookingId);

    const pending = await Booking.findByPk(bookingId);
    assert.equal(pending.status, 'pending');

    const capturesBefore = stripeDouble.captureCallCount;

    const [acceptA, acceptB] = await Promise.all([
      api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, { token: coachToken }),
      api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, { token: coachToken }),
    ]);

    const results = [acceptA, acceptB];
    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status !== 200);

    assert.equal(
      successes.length,
      1,
      `expected exactly one accept success, got ${results.map((r) => `${r.status}:${r.text}`).join(' | ')}`,
    );
    assert.equal(failures.length, 1);
    assert.equal(failures[0].status, 400, failures[0].text);
    assert.match(
      String(failures[0].json?.message || failures[0].text),
      /not pending/i,
      failures[0].text,
    );

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(booking.status, 'confirmed');
    assert.equal(payment.payment_status, 'captured');
    assert.ok(payment.charge_id);

    const captureDelta = stripeDouble.captureCallCount - capturesBefore;
    // Row lock should reject the loser before Stripe; exactly one money-moving capture.
    assert.equal(captureDelta, 1, `expected exactly one Stripe capture call, got ${captureDelta}`);
    assert.equal(stripeDouble.intents.get(paymentIntentId).captureCalls, 1);

    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(pi.status, 'succeeded');
    assert.equal(pi.latest_charge, payment.charge_id);

    const payments = await Payment.findAll({ where: { booking_id: bookingId } });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].charge_id, payment.charge_id);
  });
});

if (!RUN) {
  describe('HTTP integration duplicate-accept (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
