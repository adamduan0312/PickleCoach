/**
 * Deep HTTP integration: concurrent duplicate cancel must not double-void / double-queue refund.
 *
 * Cases:
 *   1. Pending + authorized → exactly one Stripe PaymentIntent cancel
 *   2. Confirmed + captured → exactly one booking_cancel_refund payment_action
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
  CancellationHistory,
} from '../../models/index.js';
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

const CANCEL_BODY = { reason: 'schedule_conflict' };

async function loginPair(baseUrl, fixture) {
  const studentLogin = await api(baseUrl, 'POST', '/api/auth/login', {
    body: { email: fixture.student.email, password: fixture.password },
  });
  const coachLogin = await api(baseUrl, 'POST', '/api/auth/login', {
    body: { email: fixture.coach.email, password: fixture.password },
  });
  assert.equal(studentLogin.status, 200, studentLogin.text);
  assert.equal(coachLogin.status, 200, coachLogin.text);
  return {
    studentToken: studentLogin.json.data.token,
    coachToken: coachLogin.json.data.token,
  };
}

async function createPendingAuthorizedBooking(baseUrl, fixture, studentToken, keyPrefix) {
  const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
    token: studentToken,
    body: {
      lesson_id: fixture.lesson.id,
      scheduled_at: fixture.scheduledAt.toISOString(),
      court_location_id: fixture.court.id,
      payment_method: 'stripe',
      idempotency_key: `${keyPrefix}_${Date.now()}`,
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
  return { bookingId, paymentIntentId };
}

function assertOneCancelWinner(results) {
  const successes = results.filter((r) => r.status === 200);
  const failures = results.filter((r) => r.status !== 200);
  assert.equal(
    successes.length,
    1,
    `expected exactly one cancel success, got ${results.map((r) => `${r.status}:${r.text}`).join(' | ')}`,
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].status, 400, failures[0].text);
  assert.equal(failures[0].json?.code, 'booking_already_cancelled', failures[0].text);
  assert.match(String(failures[0].json?.message || ''), /already been cancelled/i);
}

describeHttp('HTTP integration: concurrent duplicate cancel race', () => {
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

  it('voids authorized PaymentIntent exactly once under concurrent cancels', async () => {
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken } = await loginPair(baseUrl, fixture);
    const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'dup_cancel_void',
    );

    const pending = await Booking.findByPk(bookingId);
    const paymentBefore = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(pending.status, 'pending');
    assert.equal(paymentBefore.payment_status, 'authorized');

    const cancelsBefore = stripeDouble.cancelCallCount;

    const [cancelA, cancelB] = await Promise.all([
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: studentToken,
        body: CANCEL_BODY,
      }),
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: studentToken,
        body: CANCEL_BODY,
      }),
    ]);
    assertOneCancelWinner([cancelA, cancelB]);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(booking.status, 'cancelled');
    assert.equal(payment.payment_status, 'pending_void');
    assert.equal(payment.escrow_status, 'released');

    const cancelDelta = stripeDouble.cancelCallCount - cancelsBefore;
    assert.equal(cancelDelta, 1, `expected exactly one Stripe PI cancel, got ${cancelDelta}`);
    assert.equal(stripeDouble.intents.get(paymentIntentId).cancelCalls, 1);

    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(pi.status, 'canceled');

    const histories = await CancellationHistory.findAll({ where: { booking_id: bookingId } });
    assert.equal(histories.length, 1);

    const refundActions = await PaymentAction.findAll({
      where: { booking_id: bookingId, action_type: 'booking_cancel_refund' },
    });
    assert.equal(refundActions.length, 0);
  });

  it('queues exactly one cancel-refund action under concurrent cancels after capture', async () => {
    // Fresh fixture so slot/users are clean after the prior cancel case.
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'dup_cancel_refund',
    );

    const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
      token: coachToken,
    });
    assert.equal(acceptRes.status, 200, acceptRes.text);

    const confirmed = await Booking.findByPk(bookingId);
    const paymentBefore = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(paymentBefore.payment_status, 'captured');
    assert.ok(paymentBefore.charge_id);

    const retrieveBefore = stripeDouble.retrieveChargeCallCount;

    const [cancelA, cancelB] = await Promise.all([
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: studentToken,
        body: CANCEL_BODY,
      }),
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: studentToken,
        body: CANCEL_BODY,
      }),
    ]);
    assertOneCancelWinner([cancelA, cancelB]);

    const booking = await Booking.findByPk(bookingId);
    assert.equal(booking.status, 'cancelled');

    const retrieveDelta = stripeDouble.retrieveChargeCallCount - retrieveBefore;
    assert.equal(retrieveDelta, 1, `expected exactly one retrieveCharge, got ${retrieveDelta}`);

    const refundActions = await PaymentAction.findAll({
      where: { booking_id: bookingId, action_type: 'booking_cancel_refund' },
    });
    assert.equal(refundActions.length, 1);
    assert.equal(refundActions[0].status, 'pending');
    assert.ok(refundActions[0].refund_cents > 0);

    const histories = await CancellationHistory.findAll({ where: { booking_id: bookingId } });
    assert.equal(histories.length, 1);

    // Capture must not have been re-invoked during cancel; PI stays succeeded.
    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(pi.status, 'succeeded');
  });
});

if (!RUN) {
  describe('HTTP integration duplicate-cancel (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
