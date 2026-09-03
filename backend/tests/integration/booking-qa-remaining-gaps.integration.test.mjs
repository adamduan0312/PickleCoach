/**
 * Remaining booking-flow QA gaps from the post-manual-QA audit.
 *
 * Covers:
 *   1. Accept ↔ expiry race (one money outcome)
 *   2. Accept ↔ pending cancel race
 *   3. Student cancel ≥24h / <24h / exactly 24h / pending void
 *   4. Wrong-user 403 on mutate + view
 *   5. Idle auto-complete → payout eligibility → one Connect transfer
 *   6. Attendance edges (complete early/dup, no-show dup, complete vs auto-confirm)
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
  Payout,
  User,
  UserRole,
  CoachProfile,
} from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import * as paymentService from '../../services/paymentService.js';
import { expirePendingBookingNoCoachResponse } from '../../services/paymentService.js';
import { expireStalePendingBookings } from '../../workers/pendingBookingExpiryWorker.js';
import { autoConfirmLessons } from '../../workers/autoConfirmWorker.js';
import { processHeldEscrowPayment } from '../../workers/payoutWorker.js';
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
const DECLINE_BODY = {
  message_to_student: 'Sorry, I cannot take this time.',
  decline_reason_code: 'availability_conflict',
};

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
      idempotency_key: `${keyPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
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

async function shiftLessonIntoPast(bookingId, { hoursAgo = null, pastEndByMs = 2000 } = {}) {
  const booking = await Booking.findByPk(bookingId);
  const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
  let scheduledAt;
  if (hoursAgo != null) {
    scheduledAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  } else {
    scheduledAt = new Date(Date.now() - durationMs - pastEndByMs);
  }
  await booking.update({ scheduled_at: scheduledAt });
  return Booking.findByPk(bookingId);
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

function assertExclusiveMoneyOutcomes({ booking, payment, pi, captureCallDelta, cancelCallDelta }) {
  const confirmed = booking.status === 'confirmed' && payment.payment_status === 'captured';
  const expired =
    booking.status === 'cancelled'
    && booking.cancelled_by === 'system'
    && ['pending_void', 'failed'].includes(payment.payment_status);
  const cancelledByUser =
    booking.status === 'cancelled'
    && ['student', 'coach'].includes(booking.cancelled_by)
    && ['pending_void', 'failed', 'authorized'].includes(payment.payment_status);

  assert.ok(
    confirmed || expired || cancelledByUser,
    `unexpected final state status=${booking.status} cancelled_by=${booking.cancelled_by} pay=${payment.payment_status}`,
  );

  if (confirmed) {
    assert.equal(pi.status, 'succeeded');
    assert.ok(captureCallDelta >= 1);
    assert.notEqual(pi.status, 'canceled');
  } else {
    assert.equal(pi.status, 'canceled');
    assert.equal(payment.escrow_status, 'released');
    assert.ok(cancelCallDelta >= 1 || payment.payment_status === 'pending_void');
  }
}

describeHttp('HTTP integration: booking QA remaining gaps', () => {
  let server = null;
  let fixture = null;
  let stripeDouble = null;
  let strangerBundle = null;

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      if (strangerBundle?.cleanup) await strangerBundle.cleanup();
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('accept ↔ expiry race: exactly one of confirmed/captured or cancelled/voided', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'qa_accept_expire',
    );

    const capturesBefore = stripeDouble.captureCallCount;
    const cancelsBefore = stripeDouble.cancelCallCount;

    const [acceptRes, expireResult] = await Promise.all([
      api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, { token: coachToken }),
      expirePendingBookingNoCoachResponse(bookingId),
    ]);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);

    assertExclusiveMoneyOutcomes({
      booking,
      payment,
      pi,
      captureCallDelta: stripeDouble.captureCallCount - capturesBefore,
      cancelCallDelta: stripeDouble.cancelCallCount - cancelsBefore,
    });

    const acceptWon = acceptRes.status === 200 && booking.status === 'confirmed';
    const expireWon = expireResult.expired === true && booking.status === 'cancelled';
    assert.ok(
      acceptWon || expireWon,
      `expected one winner; accept=${acceptRes.status} expire=${JSON.stringify(expireResult)} status=${booking.status}`,
    );
    assert.notEqual(
      booking.status === 'confirmed' && pi.status === 'canceled',
      true,
      'must never capture and void the same authorization',
    );
    assert.notEqual(
      payment.payment_status === 'captured' && pi.status === 'canceled',
      true,
    );
  });

  it('worker expiry path still voids when window is closed (control)', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken } = await loginPair(baseUrl, fixture);
    const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'qa_expire_control',
    );
    await Booking.update(
      { created_at: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      { where: { id: bookingId } },
    );
    await expireStalePendingBookings();
    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(booking.status, 'cancelled');
    assert.equal(booking.cancelled_by, 'system');
    assert.equal(payment.payment_status, 'pending_void');
    assert.equal(pi.status, 'canceled');
  });

  it('accept ↔ pending student cancel race: coherent final money state (no capture+void)', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'qa_accept_cancel',
    );

    const capturesBefore = stripeDouble.captureCallCount;
    const cancelsBefore = stripeDouble.cancelCallCount;

    const [acceptRes, cancelRes] = await Promise.all([
      api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, { token: coachToken }),
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: studentToken,
        body: CANCEL_BODY,
      }),
    ]);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    const refundActions = await PaymentAction.findAll({
      where: { booking_id: bookingId, action_type: 'booking_cancel_refund' },
    });

    const acceptOk = acceptRes.status === 200;
    const cancelOk = cancelRes.status === 200;
    assert.ok(acceptOk || cancelOk, `at least one must succeed: accept=${acceptRes.status} cancel=${cancelRes.status}`);

    // Case A: cancel won while still pending → void auth, no capture, no refund action
    // Case B: accept won first → confirmed/captured; cancel may then succeed as confirmed cancel → one refund action
    // Case C: accept won, cancel lost on pending → remains confirmed/captured
    if (booking.status === 'confirmed') {
      assert.equal(acceptOk, true);
      assert.equal(cancelOk, false);
      assert.equal(payment.payment_status, 'captured');
      assert.equal(pi.status, 'succeeded');
      assert.equal(refundActions.length, 0);
      assert.ok(stripeDouble.captureCallCount - capturesBefore >= 1);
    } else {
      assert.equal(booking.status, 'cancelled');
      assert.equal(booking.cancelled_by, 'student');
      assert.equal(cancelOk, true);

      if (payment.payment_status === 'pending_void') {
        // Cancel beat accept on the pending row
        assert.equal(pi.status, 'canceled');
        assert.equal(refundActions.length, 0);
        assert.equal(payment.escrow_status, 'released');
        assert.notEqual(acceptOk && pi.status === 'succeeded', true);
      } else {
        // Accept captured first; student cancel of confirmed queued a refund
        assert.ok(['captured', 'partially_refunded', 'refunded'].includes(payment.payment_status));
        assert.equal(pi.status, 'succeeded');
        assert.equal(refundActions.length, 1);
        assert.ok(Number(refundActions[0].refund_cents) > 0);
        assert.ok(stripeDouble.captureCallCount - capturesBefore >= 1);
      }
    }

    // Hard invariant: never leave a captured local row against a canceled PaymentIntent
    assert.notEqual(
      payment.payment_status === 'captured' && pi.status === 'canceled',
      true,
      'must never capture and void the same PaymentIntent',
    );
    void cancelsBefore;
  });

  it('student cancel boundaries: ≥24h full, <24h ~50%, exactly 24h full, pending voids', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    // Pending → void (no refund action)
    {
      const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
        baseUrl,
        fixture,
        studentToken,
        'qa_cancel_pending',
      );
      const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: studentToken,
        body: CANCEL_BODY,
      });
      assert.equal(cancelRes.status, 200, cancelRes.text);
      const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
      const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
      assert.equal(payment.payment_status, 'pending_void');
      assert.equal(pi.status, 'canceled');
      assert.equal(cancelRes.json?.data?.cancellation?.cancellation_type, 'non_late');
      const refundActions = await PaymentAction.findAll({
        where: { booking_id: bookingId, action_type: 'booking_cancel_refund' },
      });
      assert.equal(refundActions.length, 0);
    }

    async function cancelConfirmedAtOffsetHours(hoursUntil, key) {
      const { bookingId } = await createCapturedConfirmedBooking(
        baseUrl,
        fixture,
        studentToken,
        coachToken,
        key,
      );
      await Booking.update(
        { scheduled_at: new Date(Date.now() + hoursUntil * 60 * 60 * 1000) },
        { where: { id: bookingId } },
      );
      const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: studentToken,
        body: CANCEL_BODY,
      });
      assert.equal(cancelRes.status, 200, cancelRes.text);
      const action = await PaymentAction.findOne({
        where: { booking_id: bookingId, action_type: 'booking_cancel_refund', status: 'pending' },
      });
      assert.ok(action, 'captured cancel should queue refund action');
      return {
        bookingId,
        cancelRes,
        refundCents: Number(action.refund_cents),
        cancellationType: cancelRes.json?.data?.cancellation?.cancellation_type,
        totalChargeCents: Number(
          Math.round(Number((await Payment.findOne({ where: { booking_id: bookingId } })).total_charge_to_student) * 100),
        ),
      };
    }

    const early = await cancelConfirmedAtOffsetHours(48, 'qa_cancel_early');
    assert.equal(early.cancellationType, 'non_late');
    assert.equal(early.refundCents, early.totalChargeCents, '≥24h must full-refund');

    const late = await cancelConfirmedAtOffsetHours(12, 'qa_cancel_late');
    assert.equal(late.cancellationType, 'late');
    assert.equal(late.refundCents, Math.floor(late.totalChargeCents / 2), '<24h ~50% refund');

    // Boundary policy: late iff 0 ≤ hoursUntil < 24. Use ±5s cushions so HTTP latency
    // cannot flip the intended side of the cutoff.
    const justUnder = await cancelConfirmedAtOffsetHours(24 - 5 / 3600, 'qa_cancel_just_under_24');
    assert.equal(justUnder.cancellationType, 'late');
    assert.equal(justUnder.refundCents, Math.floor(justUnder.totalChargeCents / 2));

    const atOrOver = await cancelConfirmedAtOffsetHours(24 + 5 / 3600, 'qa_cancel_at_or_over_24');
    assert.equal(
      atOrOver.cancellationType,
      'non_late',
      'hoursUntil >= 24 is intentionally non-late (full refund)',
    );
    assert.equal(atOrOver.refundCents, atOrOver.totalChargeCents);
  });

  it('wrong-user mutations return 403 and leave DB/payment unchanged', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    if (strangerBundle?.cleanup) await strangerBundle.cleanup();
    fixture = await createBookingJourneyFixture({ studentCount: 2 });
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const strangerStudent = fixture.students[1];
    const strangerLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: strangerStudent.email, password: fixture.password },
    });
    assert.equal(strangerLogin.status, 200, strangerLogin.text);
    const strangerStudentToken = strangerLogin.json.data.token;

    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const strangerCoach = await User.create({
      full_name: 'Wrong Coach',
      email: `http.int.wrong.coach.${suffix}@picklecoach.example.org`,
      password_hash: bcrypt.hashSync(fixture.password, 8),
      is_active: true,
      email_verified_at: new Date(),
      timezone: 'America/New_York',
    });
    await UserRole.create({ user_id: strangerCoach.id, role: 'coach' });
    strangerBundle = {
      cleanup: async () => {
        await UserRole.destroy({ where: { user_id: strangerCoach.id } });
        await User.destroy({ where: { id: strangerCoach.id } });
      },
    };
    const strangerCoachLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: strangerCoach.email, password: fixture.password },
    });
    assert.equal(strangerCoachLogin.status, 200, strangerCoachLogin.text);
    const strangerCoachToken = strangerCoachLogin.json.data.token;

    const { bookingId, paymentIntentId } = await createPendingAuthorizedBooking(
      baseUrl,
      fixture,
      studentToken,
      'qa_wrong_user',
    );

    const snap = async () => {
      const booking = await Booking.findByPk(bookingId);
      const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
      return {
        status: booking.status,
        cancelled_by: booking.cancelled_by,
        payment_status: payment.payment_status,
        escrow_status: payment.escrow_status,
        updated_at: String(booking.updated_at),
      };
    };

    const before = await snap();
    const capturesBefore = stripeDouble.captureCallCount;
    const cancelsBefore = stripeDouble.cancelCallCount;

    const attempts = [
      api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, { token: strangerCoachToken }),
      api(baseUrl, 'PUT', `/api/bookings/${bookingId}/decline`, {
        token: strangerCoachToken,
        body: DECLINE_BODY,
      }),
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: strangerStudentToken,
        body: CANCEL_BODY,
      }),
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/complete`, {
        token: strangerCoachToken,
        body: {},
      }),
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/student-no-show`, {
        token: strangerCoachToken,
        body: {},
      }),
      api(baseUrl, 'GET', `/api/bookings/${bookingId}`, { token: strangerStudentToken }),
      api(baseUrl, 'GET', `/api/bookings/${bookingId}`, { token: strangerCoachToken }),
    ];

    const results = await Promise.all(attempts);
    for (const r of results) {
      assert.equal(r.status, 403, r.text);
    }

    const after = await snap();
    assert.deepEqual(after, before);
    assert.equal(stripeDouble.captureCallCount, capturesBefore);
    assert.equal(stripeDouble.cancelCallCount, cancelsBefore);
    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(pi.status, 'requires_capture');

    // Legitimate coach accept still works afterward
    const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
      token: coachToken,
    });
    assert.equal(acceptRes.status, 200, acceptRes.text);
  });

  it('idle path: confirmed → awaiting_verification → auto-complete → payout → one transfer', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId } = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'qa_idle',
    );

    // Lesson just ended → awaiting_verification
    await shiftLessonIntoPast(bookingId, { pastEndByMs: 5_000 });
    await autoConfirmLessons();
    let booking = await Booking.findByPk(bookingId);
    assert.equal(booking.status, 'awaiting_verification');

    let payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(payment.payment_status, 'captured');
    assert.equal(payment.escrow_status, 'held');

    // Coach idle past 24h after lesson end → completed + payout pending
    const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
    await booking.update({
      scheduled_at: new Date(Date.now() - FINANCIAL_REVIEW_WINDOW_MS - durationMs - 60_000),
    });
    await autoConfirmLessons();
    booking = await Booking.findByPk(bookingId);
    assert.equal(booking.status, 'completed');
    assert.equal(booking.payout_status, 'pending');

    payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(payment.escrow_status, 'held', 'attendance complete must not release money');

    const transfersBefore = stripeDouble.transferCallCount;
    const payable = await loadPayablePayment(payment.id);
    const payoutResult = await processHeldEscrowPayment(payable);
    assert.ok(!payoutResult?.skipped, JSON.stringify(payoutResult));

    payment = await Payment.findByPk(payment.id);
    booking = await Booking.findByPk(bookingId);
    assert.ok(['pending_release', 'released'].includes(payment.escrow_status));
    assert.ok(payment.transfer_id);
    assert.equal(stripeDouble.transferCallCount - transfersBefore, 1);

    // Simulate Stripe transfer.paid webhook finalize
    const transfer = stripeDouble.transfers.find((t) => t.id === payment.transfer_id);
    assert.ok(transfer);
    await paymentService.finalizeTransferFromStripe(transfer);

    payment = await Payment.findByPk(payment.id);
    booking = await Booking.findByPk(bookingId);
    assert.equal(payment.escrow_status, 'released');
    assert.equal(booking.payout_status, 'paid');

    const payouts = await Payout.findAll({ where: { payment_id: payment.id } });
    assert.equal(payouts.filter((p) => p.status === 'paid' || p.external_payout_id).length >= 1, true);
  });

  it('attendance edges: complete-too-early rejected; after end succeeds; duplicate complete/no-show safe', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId } = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'qa_attendance',
    );

    // Future lesson — complete rejected
    const early = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/complete`, {
      token: coachToken,
      body: {},
    });
    assert.equal(early.status, 400, early.text);
    assert.match(String(early.json?.message || early.text), /before the lesson end/i);

    await shiftLessonIntoPast(bookingId);
    const complete1 = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/complete`, {
      token: coachToken,
      body: {},
    });
    assert.equal(complete1.status, 200, complete1.text);

    const complete2 = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/complete`, {
      token: coachToken,
      body: {},
    });
    assert.equal(complete2.status, 400, complete2.text);

    let booking = await Booking.findByPk(bookingId);
    assert.equal(booking.status, 'completed');
    let payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(payment.escrow_status, 'held');

    // Separate booking for no-show edges
    const noshow = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'qa_noshow',
    );
    await shiftLessonIntoPast(noshow.bookingId);

    const ns1 = await api(baseUrl, 'POST', `/api/bookings/${noshow.bookingId}/student-no-show`, {
      token: coachToken,
      body: {},
    });
    assert.equal(ns1.status, 200, ns1.text);
    const ns2 = await api(baseUrl, 'POST', `/api/bookings/${noshow.bookingId}/student-no-show`, {
      token: coachToken,
      body: {},
    });
    assert.ok([400, 409].includes(ns2.status), ns2.text);
    booking = await Booking.findByPk(noshow.bookingId);
    assert.equal(booking.status, 'student_no_show');
    payment = await Payment.findOne({ where: { booking_id: noshow.bookingId }, order: [['id', 'DESC']] });
    assert.equal(payment.escrow_status, 'held');
    const refundActions = await PaymentAction.findAll({ where: { booking_id: noshow.bookingId } });
    assert.equal(refundActions.length, 0);
  });

  it('complete ↔ auto-confirm race ends in completed once (attendance ≠ money)', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId } = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'qa_complete_race',
    );

    const durationMs = (Number((await Booking.findByPk(bookingId)).duration_minutes) || 60) * 60 * 1000;
    await Booking.update(
      {
        status: 'awaiting_verification',
        scheduled_at: new Date(Date.now() - FINANCIAL_REVIEW_WINDOW_MS - durationMs - 60_000),
      },
      { where: { id: bookingId } },
    );

    const [completeRes] = await Promise.all([
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/complete`, { token: coachToken, body: {} }),
      autoConfirmLessons(),
    ]);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.equal(booking.status, 'completed');
    assert.equal(booking.payout_status, 'pending');
    assert.equal(payment.escrow_status, 'held');
    assert.ok([200, 400].includes(completeRes.status), completeRes.text);
  });

  it('no-show ↔ auto-confirm race: one attendance outcome, escrow stays held', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId } = await createCapturedConfirmedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'qa_noshow_race',
    );

    const durationMs = (Number((await Booking.findByPk(bookingId)).duration_minutes) || 60) * 60 * 1000;
    await Booking.update(
      {
        status: 'awaiting_verification',
        scheduled_at: new Date(Date.now() - FINANCIAL_REVIEW_WINDOW_MS - durationMs - 60_000),
      },
      { where: { id: bookingId } },
    );

    const [noShowRes] = await Promise.all([
      api(baseUrl, 'POST', `/api/bookings/${bookingId}/student-no-show`, {
        token: coachToken,
        body: {},
      }),
      autoConfirmLessons(),
    ]);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
    assert.ok(
      ['completed', 'student_no_show'].includes(booking.status),
      `unexpected status ${booking.status}`,
    );
    assert.equal(payment.escrow_status, 'held');
    assert.ok([200, 400].includes(noShowRes.status), noShowRes.text);

    // Impossible contradiction: both completed payout path and no-show refund must not both fire
    const refundActions = await PaymentAction.findAll({ where: { booking_id: bookingId } });
    assert.equal(refundActions.length, 0);
  });
});

if (!RUN) {
  describe('HTTP integration booking QA remaining gaps (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
