/**
 * Deep HTTP integration: Stripe capture failure must not leave booking/payment as captured.
 *
 * Intended invariant (current implementation):
 *   coach accept runs capture inside a DB transaction;
 *   if Stripe capture throws, the transaction rolls back →
 *     booking stays pending, payment stays authorized, no charge_id;
 *   HTTP accept returns 500;
 *   a later accept can retry and succeed.
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking, Payment, PaymentAction } from '../../models/index.js';
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

describeHttp('HTTP integration: Stripe capture failure on coach accept', () => {
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

  it('rolls back accept when capture fails, then allows a successful retry', async () => {
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
        idempotency_key: `cap_fail_${Date.now()}`,
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

    stripeDouble.failNextCapture = new Error('simulated Stripe capture failure');

    const failAccept = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
      token: coachToken,
    });
    assert.equal(failAccept.status, 500, failAccept.text);
    assert.match(String(failAccept.json?.message || failAccept.text), /capture failure|Failed to accept|simulated Stripe/i);

    const bookingAfterFail = await Booking.findByPk(bookingId);
    const paymentAfterFail = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(bookingAfterFail.status, 'pending', 'must not confirm when Stripe capture failed');
    assert.equal(paymentAfterFail.payment_status, 'authorized');
    assert.equal(paymentAfterFail.escrow_status, 'pending');
    assert.equal(paymentAfterFail.charge_id, null);

    const piAfterFail = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(piAfterFail.status, 'requires_capture', 'failed capture must not mark PI succeeded');
    assert.equal(piAfterFail.latest_charge, null);

    const actions = await PaymentAction.findAll({ where: { booking_id: bookingId } });
    assert.equal(actions.length, 0);

    // Retry after Stripe recovers.
    assert.equal(stripeDouble.failNextCapture, null);
    const okAccept = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
      token: coachToken,
    });
    assert.equal(okAccept.status, 200, okAccept.text);

    const bookingOk = await Booking.findByPk(bookingId);
    const paymentOk = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(bookingOk.status, 'confirmed');
    assert.equal(paymentOk.payment_status, 'captured');
    assert.ok(paymentOk.charge_id);

    const piOk = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(piOk.status, 'succeeded');
    assert.equal(piOk.latest_charge, paymentOk.charge_id);
    assert.equal(stripeDouble.captureCallCount, 2);
  });
});

if (!RUN) {
  describe('HTTP integration capture-failure (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
