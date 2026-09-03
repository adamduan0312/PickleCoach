/**
 * HTTP integration: lifecycle gaps not covered by authorize-accept / cancel-race /
 * financial-review-cutoff suites.
 *
 * Covers:
 *   1. Coach acceptance timeout → expire + void authorization
 *   2. Coach cancels pending (void) and confirmed (refund queue)
 *   3. Coach completes after lesson end
 *   4. Coach marks student no-show
 *   5. Admin marks coach no-show (+ refund held until 24h window)
 *   6. Confirm/decline create Notification rows
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import {
  sequelize,
  Booking,
  Payment,
  PaymentAction,
  CancellationHistory,
  Notification,
  User,
  UserRole,
} from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import * as paymentService from '../../services/paymentService.js';
import { expireStalePendingBookings } from '../../workers/pendingBookingExpiryWorker.js';
import {
  FINANCIAL_REVIEW_WINDOW_MS,
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

const CANCEL_BODY = { reason: 'schedule_conflict' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function createCapturedConfirmedBooking(baseUrl, fixture, studentToken, coachToken, keyPrefix) {
  const pending = await createPendingAuthorizedBooking(baseUrl, fixture, studentToken, keyPrefix);
  const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${pending.bookingId}/accept`, {
    token: coachToken,
  });
  assert.equal(acceptRes.status, 200, acceptRes.text);
  const booking = await Booking.findByPk(pending.bookingId);
  assert.equal(booking.status, 'confirmed');
  return pending;
}

async function shiftLessonIntoPast(bookingId) {
  const booking = await Booking.findByPk(bookingId);
  const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
  await booking.update({
    scheduled_at: new Date(Date.now() - durationMs - 2000),
  });
  return Booking.findByPk(bookingId);
}

async function waitForNotification({ userId, type, bookingId, timeoutMs = 3000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await Notification.findAll({
      where: {
        user_id: userId,
        type,
        channel: 'in_app',
      },
      order: [['id', 'DESC']],
      limit: 20,
    });
    const row = rows.find((n) => {
      const payloadBookingId = n.payload?.booking_id ?? n.entity_id;
      return Number(payloadBookingId) === Number(bookingId);
    });
    if (row) return row;
    await sleep(50);
  }
  return null;
}

async function createAdminUser(password) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
  const admin = await User.create({
    full_name: 'HTTP Int Admin',
    email: `http.int.admin.${suffix}@picklecoach.example.org`,
    password_hash: bcrypt.hashSync(password, 8),
    is_active: true,
    email_verified_at: new Date(),
    timezone: 'America/New_York',
  });
  await UserRole.create({ user_id: admin.id, role: 'admin' });
  return {
    admin,
    cleanup: async () => {
      await Notification.destroy({ where: { user_id: admin.id } }).catch(() => {});
      await UserRole.destroy({ where: { user_id: admin.id } });
      await User.destroy({ where: { id: admin.id } });
    },
  };
}

describeHttp('HTTP integration: booking lifecycle gaps', () => {
  let server = null;
  let fixture = null;
  let stripeDouble = null;
  let adminBundle = null;

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      if (adminBundle?.cleanup) await adminBundle.cleanup();
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('expires stale pending booking and voids authorization (worker path)', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken } = await loginPair(baseUrl, fixture);

    const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'gap_expire',
    );

    // Force acceptance window closed: request age beyond timeout.
    await Booking.update(
      { created_at: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      { where: { id: bookingId } },
    );

    await expireStalePendingBookings();

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(booking.status, 'cancelled');
    assert.equal(booking.cancelled_by, 'system');
    assert.equal(payment.payment_status, 'pending_void');
    assert.equal(payment.escrow_status, 'released');

    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(pi.status, 'canceled');

    const history = await CancellationHistory.findOne({ where: { booking_id: bookingId } });
    assert.ok(history);
    assert.equal(history.cancelled_by, 'system');
  });

  it('coach cancel of pending booking voids authorization', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'gap_coach_cancel_pending',
    );

    const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
      token: coachToken,
      body: CANCEL_BODY,
    });
    assert.equal(cancelRes.status, 200, cancelRes.text);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(booking.status, 'cancelled');
    assert.equal(booking.cancelled_by, 'coach');
    assert.equal(payment.payment_status, 'pending_void');
    assert.equal(payment.escrow_status, 'released');

    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(pi.status, 'canceled');

    const history = await CancellationHistory.findOne({ where: { booking_id: bookingId } });
    assert.equal(history.cancelled_by, 'coach');
  });

  it('coach cancel of confirmed booking queues full cancel refund', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId } = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'gap_coach_cancel_confirmed',
    );

    const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
      token: coachToken,
      body: CANCEL_BODY,
    });
    assert.equal(cancelRes.status, 200, cancelRes.text);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(booking.status, 'cancelled');
    assert.equal(booking.cancelled_by, 'coach');
    assert.equal(payment.payment_status, 'captured');

    const actions = await PaymentAction.findAll({
      where: { booking_id: bookingId, action_type: 'booking_cancel_refund', status: 'pending' },
    });
    assert.equal(actions.length, 1, 'coach cancel of captured booking should queue exactly one refund action');
    assert.ok(Number(actions[0].refund_cents) > 0);
  });

  it('coach complete after lesson end sets completed + pending payout (escrow still held)', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId } = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'gap_complete',
    );

    await shiftLessonIntoPast(bookingId);

    const completeRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/complete`, {
      token: coachToken,
      body: {},
    });
    assert.equal(completeRes.status, 200, completeRes.text);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(booking.status, 'completed');
    assert.equal(booking.payout_status, 'pending');
    assert.equal(payment.payment_status, 'captured');
    assert.equal(payment.escrow_status, 'held');
    assert.ok(payment.charge_id);
  });

  it('coach marks student_no_show after lesson end; escrow stays held', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId } = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'gap_student_noshow',
    );
    await shiftLessonIntoPast(bookingId);

    const noShowRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/student-no-show`, {
      token: coachToken,
      body: {},
    });
    assert.equal(noShowRes.status, 200, noShowRes.text);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(booking.status, 'student_no_show');
    assert.equal(payment.payment_status, 'captured');
    assert.equal(payment.escrow_status, 'held');

    const refundActions = await PaymentAction.findAll({
      where: { booking_id: bookingId },
    });
    assert.equal(refundActions.length, 0, 'student no-show must not auto-refund');
  });

  it('admin marks coach_no_show; refund held during 24h window then enqueueable', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    if (adminBundle?.cleanup) await adminBundle.cleanup();
    fixture = await createBookingJourneyFixture();
    adminBundle = await createAdminUser(fixture.password);
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const adminLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: adminBundle.admin.email, password: fixture.password },
    });
    assert.equal(adminLogin.status, 200, adminLogin.text);
    const adminToken = adminLogin.json.data.token;

    const { bookingId } = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'gap_coach_noshow',
    );
    await shiftLessonIntoPast(bookingId);

    const markRes = await api(baseUrl, 'POST', `/api/admin/bookings/${bookingId}/coach-no-show`, {
      token: adminToken,
      body: { notes: 'Coach never arrived' },
    });
    assert.equal(markRes.status, 200, markRes.text);
    assert.equal(markRes.json?.data?.auto_refund?.status, 'held_until_review');

    let booking = await Booking.findByPk(bookingId);
    let payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(booking.status, 'coach_no_show');
    assert.equal(payment.payment_status, 'captured');
    assert.equal(payment.escrow_status, 'held');

    let actions = await PaymentAction.findAll({
      where: { booking_id: bookingId, action_type: 'booking_coach_no_show_refund' },
    });
    assert.equal(actions.length, 0, 'refund must not enqueue during review window');

    // Move lesson end so review window has elapsed, then enqueue.
    const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
    await booking.update({
      scheduled_at: new Date(Date.now() - FINANCIAL_REVIEW_WINDOW_MS - durationMs - 60_000),
    });

    const plan = await paymentService.enqueueCoachNoShowRefundIfEligible(bookingId);
    assert.equal(plan.status, 'queued', JSON.stringify(plan));
    assert.ok(plan.payment_action_id);

    actions = await PaymentAction.findAll({
      where: {
        booking_id: bookingId,
        action_type: 'booking_coach_no_show_refund',
        status: 'pending',
      },
    });
    assert.equal(actions.length, 1);
    assert.ok(Number(actions[0].refund_cents) > 0);

    payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(payment.escrow_status, 'held');
    assert.notEqual(booking.payout_status, 'paid');
  });

  it('confirm creates coach booking_request notification; decline creates student booking_declined', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'gap_notify',
    );

    const coachNotif = await waitForNotification({
      userId: fixture.coach.id,
      type: 'booking_request_coach',
      bookingId,
    });
    assert.ok(coachNotif, 'expected in-app booking_request_coach for coach after confirm');

    const declineRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/decline`, {
      token: coachToken,
      body: {
        message_to_student: 'Sorry, I cannot take this time.',
        decline_reason_code: 'availability_conflict',
      },
    });
    assert.equal(declineRes.status, 200, declineRes.text);

    const studentNotif = await waitForNotification({
      userId: fixture.student.id,
      type: 'booking_declined',
      bookingId,
    });
    assert.ok(studentNotif, 'expected in-app booking_declined for student after decline');
  });
});

if (!RUN) {
  describe('HTTP integration lifecycle gaps (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
