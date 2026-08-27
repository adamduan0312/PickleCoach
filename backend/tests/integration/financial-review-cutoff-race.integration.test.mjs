/**
 * HTTP + DB integration: post-lesson 24h cutoff race.
 *
 * Encodes the manual C4 race: student dispute just before `review_until`,
 * payout worker at/after `review_until`. Must never finish as
 * coach paid + open dispute.
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
  Dispute,
  Payout,
  User,
  CoachProfile,
  DisputeType,
} from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { processHeldEscrowPayment } from '../../workers/payoutWorker.js';
import {
  FINANCIAL_REVIEW_WINDOW_MS,
  getFinancialReviewUntil,
  isPostLessonFinancialReviewElapsed,
} from '../../utils/financialReviewWindow.js';
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scheduledAtForReviewUntil(booking, reviewUntil) {
  const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
  const lessonEnd = new Date(reviewUntil.getTime() - FINANCIAL_REVIEW_WINDOW_MS);
  return new Date(lessonEnd.getTime() - durationMs);
}

function isPaidish(booking, payment) {
  return (
    ['processing', 'paid'].includes(String(booking.payout_status || ''))
    || ['released', 'pending_release'].includes(String(payment.escrow_status || ''))
    || Boolean(payment.transfer_id)
  );
}

async function loadPayablePayment(paymentId) {
  return Payment.findByPk(paymentId, {
    include: [
      {
        model: Booking,
        as: 'booking',
        include: [{ model: Payment, as: 'payments' }],
      },
      {
        model: User,
        as: 'coach',
        attributes: ['id', 'full_name', 'email'],
        include: [{ model: CoachProfile, as: 'coachProfile' }],
      },
    ],
  });
}

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

async function createCapturedCompletedBooking(baseUrl, fixture, studentToken, coachToken, keyPrefix) {
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

  const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
    token: coachToken,
  });
  assert.equal(acceptRes.status, 200, acceptRes.text);

  const booking = await Booking.findByPk(bookingId);
  const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
  await booking.update({
    scheduled_at: new Date(Date.now() - durationMs - 1000),
  });

  const completeRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/complete`, {
    token: coachToken,
    body: {},
  });
  assert.equal(completeRes.status, 200, completeRes.text);

  const completed = await Booking.findByPk(bookingId);
  const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.payout_status, 'pending');
  assert.equal(payment.payment_status, 'captured');
  assert.equal(payment.escrow_status, 'held');
  return { bookingId, paymentId: payment.id };
}

async function lessonNotCompletedTypeId() {
  const row = await DisputeType.findOne({ where: { code: 'lesson_not_completed' } });
  assert.ok(row, 'dispute_types.lesson_not_completed must exist (run migrations)');
  return row.id;
}

describeHttp('HTTP integration: 24h financial-review cutoff race', () => {
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

  it('dispute 2s before review_until blocks payout after the cutoff', async () => {
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const { bookingId, paymentId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'cutoff_seq',
    );
    const typeId = await lessonNotCompletedTypeId();

    const booking = await Booking.findByPk(bookingId);
    const leadMs = 1500;
    await booking.update({
      scheduled_at: scheduledAtForReviewUntil(booking, new Date(Date.now() + leadMs)),
    });
    await booking.reload();
    const until = getFinancialReviewUntil(booking);
    assert.ok(until.getTime() - Date.now() > 200);

    const disputeBeforeMs = until.getTime() - Date.now() - 200;
    if (disputeBeforeMs > 0) await sleep(disputeBeforeMs);

    const disputeRes = await api(baseUrl, 'POST', '/api/disputes', {
      token: studentToken,
      body: {
        booking_id: bookingId,
        dispute_type_id: typeId,
        notes: 'cutoff race T-200ms',
      },
    });
    assert.equal(disputeRes.status, 201, disputeRes.text);
    assert.equal(disputeRes.json?.data?.status, 'open');

    const waitForCutoff = until.getTime() - Date.now();
    if (waitForCutoff > 0) await sleep(waitForCutoff + 20);
    assert.equal(isPostLessonFinancialReviewElapsed(await Booking.findByPk(bookingId)), true);

    const payable = await loadPayablePayment(paymentId);
    const payoutResult = await processHeldEscrowPayment(payable);
    assert.equal(payoutResult.skipped, true);
    assert.equal(payoutResult.reason, 'open_dispute');

    const finalBooking = await Booking.findByPk(bookingId);
    const finalPayment = await Payment.findByPk(paymentId);
    const open = await Dispute.findAll({
      where: { booking_id: bookingId, status: ['open', 'under_review'] },
    });
    const payouts = await Payout.findAll({ where: { payment_id: paymentId } });

    assert.equal(open.length, 1);
    assert.equal(isPaidish(finalBooking, finalPayment), false);
    assert.equal(finalPayment.escrow_status, 'held');
    assert.equal(finalPayment.transfer_id, null);
    assert.equal(payouts.length, 0);
    assert.equal(
      stripeDouble.transfers.filter((t) => String(t.metadata?.booking_id) === String(bookingId)).length,
      0,
    );
  });

  it('concurrent dispute + payout at cutoff never ends paid with an open dispute', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const { bookingId, paymentId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'cutoff_race',
    );
    const typeId = await lessonNotCompletedTypeId();

    const booking = await Booking.findByPk(bookingId);
    await booking.update({
      scheduled_at: scheduledAtForReviewUntil(booking, new Date(Date.now() + 400)),
    });
    const until = getFinancialReviewUntil(await Booking.findByPk(bookingId));

    const disputePromise = api(baseUrl, 'POST', '/api/disputes', {
      token: studentToken,
      body: {
        booking_id: bookingId,
        dispute_type_id: typeId,
        notes: 'cutoff concurrent',
      },
    });
    const payoutPromise = (async () => {
      const delay = until.getTime() - Date.now();
      if (delay > 0) await sleep(delay);
      const payable = await loadPayablePayment(paymentId);
      return processHeldEscrowPayment(payable);
    })();

    const [disputeRes] = await Promise.all([disputePromise, payoutPromise]);
    assert.ok([201, 400].includes(disputeRes.status), disputeRes.text);
    if (disputeRes.status === 400) {
      assert.equal(disputeRes.json?.code, 'dispute_create_financial_review_closed');
    }

    const finalBooking = await Booking.findByPk(bookingId);
    const finalPayment = await Payment.findByPk(paymentId);
    const open = await Dispute.findAll({
      where: { booking_id: bookingId, status: ['open', 'under_review'] },
    });
    const paidish = isPaidish(finalBooking, finalPayment);
    assert.equal(
      Boolean(open.length) && paidish,
      false,
      'open dispute must not coexist with a released/processing payout',
    );
  });

  it('after the window with no dispute, payout worker can release escrow', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const { bookingId, paymentId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'cutoff_pay',
    );

    const booking = await Booking.findByPk(bookingId);
    await booking.update({
      scheduled_at: scheduledAtForReviewUntil(booking, new Date(Date.now() - 1000)),
    });
    assert.equal(isPostLessonFinancialReviewElapsed(await Booking.findByPk(bookingId)), true);

    const payable = await loadPayablePayment(paymentId);
    const payoutResult = await processHeldEscrowPayment(payable);
    assert.equal(payoutResult.skipped, false, JSON.stringify(payoutResult));

    const finalBooking = await Booking.findByPk(bookingId);
    const finalPayment = await Payment.findByPk(paymentId);
    const open = await Dispute.findAll({
      where: { booking_id: bookingId, status: ['open', 'under_review'] },
    });
    assert.equal(open.length, 0);
    assert.equal(isPaidish(finalBooking, finalPayment), true);
    assert.ok(finalPayment.transfer_id);
    assert.equal(
      stripeDouble.transfers.some((t) => String(t.metadata?.booking_id) === String(bookingId)),
      true,
    );
  });
});

if (!RUN) {
  describe('HTTP integration 24h cutoff race (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
