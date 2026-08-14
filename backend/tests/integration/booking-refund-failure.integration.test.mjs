/**
 * Deep HTTP integration: Stripe refund failure must not claim a refund succeeded.
 *
 * Flow:
 *   authorize → confirm → accept (captured) → cancel (queues booking_cancel_refund)
 *   → processPendingRefundPaymentActions with Stripe createRefund failing
 *
 * Intended invariant:
 *   booking stays cancelled
 *   payment stays captured (not refunded / not falsely pending)
 *   payment_action stays pending with attempts incremented + error_message
 *   retry after Stripe recovers can succeed
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import {
  sequelize,
  Booking,
  Payment,
  PaymentAction,
} from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import * as paymentService from '../../services/paymentService.js';
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

describeHttp('HTTP integration: Stripe refund failure on cancel action', () => {
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

  it('keeps payment captured when refund Stripe call fails, then recovers on retry', async () => {
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
        idempotency_key: `ref_fail_${Date.now()}`,
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

    const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
      token: coachToken,
    });
    assert.equal(acceptRes.status, 200, acceptRes.text);

    const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
      token: studentToken,
      body: { reason: 'schedule_conflict' },
    });
    assert.equal(cancelRes.status, 200, cancelRes.text);
    assert.equal(cancelRes.json?.data?.refund?.queued, true);

    const action = await PaymentAction.findOne({
      where: { booking_id: bookingId, action_type: 'booking_cancel_refund' },
    });
    assert.ok(action);
    assert.equal(action.status, 'pending');
    assert.equal(action.attempts, 0);

    const paymentBefore = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(paymentBefore.payment_status, 'captured');
    assert.equal(paymentBefore.escrow_status, 'held');
    assert.ok(!paymentBefore.stripe_refund_id);

    stripeDouble.failNextCreateRefund = new Error('simulated Stripe refund failure');

    const batch1 = await paymentService.processPendingRefundPaymentActions({ batchLimit: 20 });
    assert.ok(batch1.failed >= 1, `expected a failed refund attempt: ${JSON.stringify(batch1)}`);

    const bookingAfterFail = await Booking.findByPk(bookingId);
    const paymentAfterFail = await Payment.findOne({ where: { booking_id: bookingId } });
    const actionAfterFail = await PaymentAction.findByPk(action.id);

    assert.equal(bookingAfterFail.status, 'cancelled');
    assert.equal(paymentAfterFail.payment_status, 'captured', 'must not mark refunded when Stripe refund failed');
    assert.equal(paymentAfterFail.escrow_status, 'held');
    assert.ok(!paymentAfterFail.stripe_refund_id);
    assert.notEqual(paymentAfterFail.refund_status, 'succeeded');
    assert.equal(actionAfterFail.status, 'pending', 'transient Stripe errors stay pending for retry');
    assert.equal(actionAfterFail.attempts, 1);
    assert.match(String(actionAfterFail.error_message || ''), /simulated Stripe refund failure/);

    const chargeAfterFail = await stripeDouble.retrieveCharge(paymentAfterFail.charge_id);
    assert.equal(chargeAfterFail.amount_refunded, 0);

    // Retry after Stripe recovers.
    assert.equal(stripeDouble.failNextCreateRefund, null);
    const batch2 = await paymentService.processPendingRefundPaymentActions({ batchLimit: 20 });
    assert.ok(batch2.succeeded >= 1, `expected refund success: ${JSON.stringify(batch2)}`);

    const paymentOk = await Payment.findOne({ where: { booking_id: bookingId } });
    const actionOk = await PaymentAction.findByPk(action.id);
    assert.equal(actionOk.status, 'succeeded');
    assert.ok(actionOk.stripe_refund_id);
    assert.equal(paymentOk.refund_status, 'pending', 'API marks pending until charge.refunded webhook');
    assert.equal(paymentOk.stripe_refund_id, actionOk.stripe_refund_id);
    assert.equal(paymentOk.payment_status, 'captured');

    const chargeOk = await stripeDouble.retrieveCharge(paymentOk.charge_id);
    assert.ok(chargeOk.amount_refunded > 0);
  });
});

if (!RUN) {
  describe('HTTP integration refund-failure (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
