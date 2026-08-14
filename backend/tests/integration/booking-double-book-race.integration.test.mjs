/**
 * Deep HTTP integration: concurrent double-booking of the same slot.
 *
 * Two students authorize separately, then confirm the same lesson/court/time
 * concurrently. Exactly one booking must win; payment state must stay consistent.
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Op } from 'sequelize';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking, Payment } from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { SLOT_NO_LONGER_AVAILABLE_CODE } from '../../utils/bookingIntentContract.js';
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

describeHttp('HTTP integration: concurrent double-booking race', () => {
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

  it('allows exactly one concurrent confirm for the same slot', async () => {
    fixture = await createBookingJourneyFixture({ studentCount: 2 });
    const [studentA, studentB] = fixture.students;
    const { baseUrl } = server;
    const slotIso = fixture.scheduledAt.toISOString();

    const loginA = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: studentA.email, password: fixture.password },
    });
    const loginB = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: studentB.email, password: fixture.password },
    });
    assert.equal(loginA.status, 200, loginA.text);
    assert.equal(loginB.status, 200, loginB.text);
    const tokenA = loginA.json.data.token;
    const tokenB = loginB.json.data.token;

    // Authorize both students first (sequential). Race is on confirm.
    const intentBody = {
      lesson_id: fixture.lesson.id,
      scheduled_at: slotIso,
      court_location_id: fixture.court.id,
      payment_method: 'stripe',
    };

    const intentA = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: tokenA,
      body: { ...intentBody, idempotency_key: `race_a_${Date.now()}` },
    });
    const intentB = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: tokenB,
      body: { ...intentBody, idempotency_key: `race_b_${Date.now()}` },
    });
    assert.equal(intentA.status, 201, intentA.text);
    assert.equal(intentB.status, 201, intentB.text);
    const piA = intentA.json.data.payment_intent_id;
    const piB = intentB.json.data.payment_intent_id;
    assert.notEqual(piA, piB);

    const [confirmA, confirmB] = await Promise.all([
      api(baseUrl, 'POST', '/api/bookings/confirm', {
        token: tokenA,
        body: { payment_intent_id: piA },
      }),
      api(baseUrl, 'POST', '/api/bookings/confirm', {
        token: tokenB,
        body: { payment_intent_id: piB },
      }),
    ]);

    const results = [confirmA, confirmB];
    const successes = results.filter((r) => [200, 201].includes(r.status));
    const failures = results.filter((r) => ![200, 201].includes(r.status));

    assert.equal(
      successes.length,
      1,
      `expected exactly one success, got statuses ${results.map((r) => r.status).join(',')} bodies=${results.map((r) => r.text).join(' | ')}`,
    );
    assert.equal(failures.length, 1);

    const fail = failures[0];
    assert.equal(fail.status, 409, fail.text);
    assert.equal(
      fail.json?.code,
      SLOT_NO_LONGER_AVAILABLE_CODE,
      `loser should be slot_no_longer_available: ${fail.text}`,
    );

    const winnerBookingId = successes[0].json?.data?.booking?.id;
    assert.ok(winnerBookingId);

    const slotBookings = await Booking.findAll({
      where: {
        coach_id: fixture.coach.id,
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt,
        status: { [Op.notIn]: ['cancelled'] },
      },
    });
    assert.equal(slotBookings.length, 1, `expected 1 booking, found ${slotBookings.map((b) => b.id).join(',')}`);
    assert.equal(slotBookings[0].id, winnerBookingId);

    const paymentsForSlot = await Payment.findAll({
      where: { booking_id: winnerBookingId },
    });
    assert.equal(paymentsForSlot.length, 1);
    assert.equal(paymentsForSlot[0].payment_status, 'authorized');
    assert.ok([piA, piB].includes(paymentsForSlot[0].payment_intent_id));

    // Losing PI must not have created a booking/payment row; confirm cancels the orphan PI.
    const loserPi = paymentsForSlot[0].payment_intent_id === piA ? piB : piA;
    const orphanPayment = await Payment.findOne({ where: { payment_intent_id: loserPi } });
    assert.equal(orphanPayment, null);

    const loserStripe = await stripeDouble.getPaymentIntent(loserPi);
    assert.equal(loserStripe.status, 'canceled');

    const winnerStripe = await stripeDouble.getPaymentIntent(paymentsForSlot[0].payment_intent_id);
    assert.equal(winnerStripe.status, 'requires_capture');
  });
});

if (!RUN) {
  describe('HTTP integration double-book (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
