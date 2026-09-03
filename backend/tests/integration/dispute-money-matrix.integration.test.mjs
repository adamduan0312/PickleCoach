/**
 * Dispute money matrix — HTTP integration.
 *
 * Core invariant: a dispute must never result in both a full student refund
 * and a coach Connect payout for the same charge.
 *
 * Covers:
 *   - open dispute blocks payout
 *   - resolve for student (refund) → refund executes → escrow not payable
 *   - resolve for coach (no_change) → payout proceeds after review window
 *   - near-cutoff open dispute
 *   - duplicate resolve / duplicate open
 *   - wrong-user authz
 *   - student contests student_no_show → admin overturns to coach_no_show + refund
 *   - Stripe refund failure then retry
 *   - resolve-refund ↔ payout worker race
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
  Dispute,
  DisputeType,
  User,
  UserRole,
  CoachProfile,
} from '../../models/index.js';
import { Op } from 'sequelize';
import * as stripeService from '../../services/stripeService.js';
import * as paymentService from '../../services/paymentService.js';
import { processHeldEscrowPayment } from '../../workers/payoutWorker.js';
import {
  FINANCIAL_REVIEW_WINDOW_MS,
  getFinancialReviewUntil,
  isPostLessonFinancialReviewElapsed,
} from '../../utils/financialReviewWindow.js';
import { isPaymentEscrowPayable } from '../../utils/payoutEscrowEligibility.js';
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

function assertNeverRefundAndPayoutSameMoney({ booking, payment, actions, payouts, openDisputes }) {
  const refundish =
    actions.some(
      (a) =>
        ['dispute_refund_full', 'dispute_refund_partial', 'booking_coach_no_show_refund', 'booking_admin_refund'].includes(
          a.action_type,
        ) && ['pending', 'succeeded'].includes(a.status),
    )
    || Number(payment.refunded_amount) > 0
    || payment.escrow_status === 'refunded';

  const paidish = isPaidish(booking, payment) || payouts.some((p) => ['pending', 'paid'].includes(p.status));

  if (openDisputes.length) {
    assert.equal(paidish, false, 'open dispute must never coincide with paidish money state');
  }
  if (payment.escrow_status === 'refunded') {
    assert.equal(paidish, false, 'fully refunded escrow must never be paid to coach');
  }
  if (refundish && Number(payment.refunded_amount) > 0) {
    const totalCents = Math.round(Number(payment.total_charge_to_student) * 100);
    const refundedCents = Math.round(Number(payment.refunded_amount) * 100);
    if (refundedCents >= totalCents - 1) {
      assert.equal(paidish, false, 'full refund must not allow coach payout');
    }
  }
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

async function createAdminUser(password) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
  const admin = await User.create({
    full_name: 'HTTP Int Dispute Admin',
    email: `http.int.dispute.admin.${suffix}@picklecoach.example.org`,
    password_hash: bcrypt.hashSync(password, 8),
    is_active: true,
    email_verified_at: new Date(),
    timezone: 'America/New_York',
  });
  await UserRole.create({ user_id: admin.id, role: 'admin' });
  return {
    admin,
    cleanup: async () => {
      await UserRole.destroy({ where: { user_id: admin.id } });
      await User.destroy({ where: { id: admin.id } });
    },
  };
}

async function disputeTypeId(code) {
  const row = await DisputeType.findOne({ where: { code } });
  assert.ok(row, `dispute_types.${code} must exist (run migrations)`);
  return row.id;
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

async function createCapturedCompletedBooking(baseUrl, fixture, studentToken, coachToken, keyPrefix) {
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

  const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
    token: coachToken,
  });
  assert.equal(acceptRes.status, 200, acceptRes.text);

  const booking = await Booking.findByPk(bookingId);
  const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
  await booking.update({ scheduled_at: new Date(Date.now() - durationMs - 1000) });

  const completeRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/complete`, {
    token: coachToken,
    body: {},
  });
  assert.equal(completeRes.status, 200, completeRes.text);

  const completed = await Booking.findByPk(bookingId);
  const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
  assert.equal(completed.status, 'completed');
  assert.equal(payment.escrow_status, 'held');
  return { bookingId, paymentId: payment.id, paymentIntentId };
}

async function createStudentNoShowBooking(baseUrl, fixture, studentToken, coachToken, keyPrefix) {
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
  const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
    token: studentToken,
    body: { payment_intent_id: intentRes.json.data.payment_intent_id },
  });
  assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
  const bookingId = confirmRes.json?.data?.booking?.id;

  const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
    token: coachToken,
  });
  assert.equal(acceptRes.status, 200, acceptRes.text);

  const booking = await Booking.findByPk(bookingId);
  const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
  await booking.update({ scheduled_at: new Date(Date.now() - durationMs - 1000) });

  const noShowRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/student-no-show`, {
    token: coachToken,
    body: {},
  });
  assert.equal(noShowRes.status, 200, noShowRes.text);
  const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
  assert.equal((await Booking.findByPk(bookingId)).status, 'student_no_show');
  return { bookingId, paymentId: payment.id };
}

async function openStudentDispute(baseUrl, studentToken, bookingId, typeCode, notes) {
  const typeId = await disputeTypeId(typeCode);
  const res = await api(baseUrl, 'POST', '/api/disputes', {
    token: studentToken,
    body: { booking_id: bookingId, dispute_type_id: typeId, notes },
  });
  return res;
}

async function moneySnapshot(bookingId, paymentId) {
  const booking = await Booking.findByPk(bookingId);
  const payment = await Payment.findByPk(paymentId);
  const actions = await PaymentAction.findAll({ where: { booking_id: bookingId } });
  const payouts = await Payout.findAll({ where: { payment_id: paymentId } });
  const openDisputes = await Dispute.findAll({
    where: { booking_id: bookingId, status: ['open', 'under_review'] },
  });
  return { booking, payment, actions, payouts, openDisputes };
}

async function elapseReviewWindow(bookingId) {
  const booking = await Booking.findByPk(bookingId);
  const durationMs = (Number(booking.duration_minutes) || 60) * 60 * 1000;
  await booking.update({
    scheduled_at: new Date(Date.now() - FINANCIAL_REVIEW_WINDOW_MS - durationMs - 60_000),
  });
  assert.equal(isPostLessonFinancialReviewElapsed(await Booking.findByPk(bookingId)), true);
}

/**
 * payment_actions mark Stripe refunds as initiated (`refund_status=pending`);
 * escrow / refunded_amount settle when charge.refunded is mirrored.
 */
async function settleRefundFromStripeCharge(paymentId) {
  const payment = await Payment.findByPk(paymentId);
  assert.ok(payment?.charge_id, 'payment must have charge_id');
  const charge = await stripeService.retrieveCharge(payment.charge_id);
  assert.ok(
    Number(charge.amount_refunded) > 0,
    'Stripe charge must already show amount_refunded before webhook settle',
  );
  await paymentService.applyRefundStateFromStripeCharge(payment, charge, {
    stripeRefundId: payment.stripe_refund_id,
  });
  return Payment.findByPk(paymentId);
}

async function executeDisputeRefundAndSettle(bookingId, paymentId) {
  const batch = await paymentService.processPendingRefundPaymentActions({ batchLimit: 20 });
  const action = await PaymentAction.findOne({
    where: {
      booking_id: bookingId,
      action_type: { [Op.in]: ['dispute_refund_full', 'dispute_refund_partial'] },
    },
    order: [['id', 'DESC']],
  });
  assert.ok(action, 'expected dispute refund payment_action');
  assert.equal(action.status, 'succeeded', JSON.stringify({ batch, action: action.toJSON() }));
  const pending = await Payment.findByPk(paymentId);
  assert.equal(pending.refund_status, 'pending');
  return settleRefundFromStripeCharge(paymentId);
}

describeHttp('HTTP integration: dispute money matrix', () => {
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

  async function resetFixture() {
    if (fixture?.cleanup) await fixture.cleanup();
    if (adminBundle?.cleanup) await adminBundle.cleanup();
    fixture = await createBookingJourneyFixture({ studentCount: 2 });
    adminBundle = await createAdminUser(fixture.password);
  }

  async function adminToken(baseUrl) {
    const login = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: adminBundle.admin.email, password: fixture.password },
    });
    assert.equal(login.status, 200, login.text);
    return login.json.data.token;
  }

  it('open dispute blocks payout; resolve for coach allows payout after window', async () => {
    await resetFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const tokenAdmin = await adminToken(baseUrl);

    const { bookingId, paymentId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'dm_coach_win',
    );

    const openRes = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'lesson_not_completed',
      'lesson incomplete claim',
    );
    assert.equal(openRes.status, 201, openRes.text);
    const disputeId = openRes.json.data.id;

    await elapseReviewWindow(bookingId);
    let payoutResult = await processHeldEscrowPayment(await loadPayablePayment(paymentId));
    assert.equal(payoutResult.skipped, true);
    assert.equal(payoutResult.reason, 'open_dispute');

    const resolveRes = await api(baseUrl, 'PUT', `/api/disputes/${disputeId}/resolve`, {
      token: tokenAdmin,
      body: {
        decision: 'rejected',
        penalize_role: 'none',
        financial_action: 'no_change',
        resolution_notes: 'Coach fulfilled lesson',
      },
    });
    assert.equal(resolveRes.status, 200, resolveRes.text);

    const dupResolve = await api(baseUrl, 'PUT', `/api/disputes/${disputeId}/resolve`, {
      token: tokenAdmin,
      body: {
        decision: 'rejected',
        penalize_role: 'none',
        financial_action: 'no_change',
      },
    });
    assert.equal(dupResolve.status, 400, dupResolve.text);
    assert.match(String(dupResolve.json?.message || ''), /already resolved/i);

    payoutResult = await processHeldEscrowPayment(await loadPayablePayment(paymentId));
    assert.ok(!payoutResult?.skipped, JSON.stringify(payoutResult));

    const snap = await moneySnapshot(bookingId, paymentId);
    assert.equal(snap.openDisputes.length, 0);
    assert.equal(snap.actions.filter((a) => a.action_type.startsWith('dispute_refund')).length, 0);
    assert.ok(isPaidish(snap.booking, snap.payment));
    assertNeverRefundAndPayoutSameMoney(snap);
  });

  it('resolve for student queues full refund, executes it, and blocks coach payout', async () => {
    await resetFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const tokenAdmin = await adminToken(baseUrl);

    const { bookingId, paymentId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'dm_student_win',
    );

    const openRes = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'lesson_not_completed',
      'student wants refund',
    );
    assert.equal(openRes.status, 201, openRes.text);
    const disputeId = openRes.json.data.id;

    const resolveRes = await api(baseUrl, 'PUT', `/api/disputes/${disputeId}/resolve`, {
      token: tokenAdmin,
      body: {
        decision: 'upheld',
        penalize_role: 'coach',
        financial_action: 'refund_student',
        resolution_notes: 'Lesson not delivered',
      },
    });
    assert.equal(resolveRes.status, 200, resolveRes.text);
    assert.equal(resolveRes.json?.data?.refund?.queued, true);

    let actions = await PaymentAction.findAll({
      where: { booking_id: bookingId, action_type: 'dispute_refund_full', status: 'pending' },
    });
    assert.equal(actions.length, 1);

    await elapseReviewWindow(bookingId);
    let payoutResult = await processHeldEscrowPayment(await loadPayablePayment(paymentId));
    assert.equal(payoutResult.skipped, true);
    assert.ok(
      ['refund_action_pending', 'open_dispute', 'refund_pending'].includes(payoutResult.reason),
      payoutResult.reason,
    );

    const payment = await executeDisputeRefundAndSettle(bookingId, paymentId);
    assert.ok(Number(payment.refunded_amount) > 0);
    assert.equal(payment.escrow_status, 'refunded');
    assert.equal(payment.refund_status, 'succeeded');
    assert.equal(isPaymentEscrowPayable(payment), false);

    payoutResult = await processHeldEscrowPayment(await loadPayablePayment(paymentId));
    assert.equal(payoutResult.skipped, true);
    assert.equal(payoutResult.reason, 'escrow_not_payable');

    const snap = await moneySnapshot(bookingId, paymentId);
    assert.equal(isPaidish(snap.booking, snap.payment), false);
    assert.equal(snap.payment.transfer_id, null);
    assertNeverRefundAndPayoutSameMoney(snap);
  });

  it('dispute near financial cutoff still blocks payout after window elapses', async () => {
    await resetFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);

    const { bookingId, paymentId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'dm_near_cutoff',
    );

    const booking = await Booking.findByPk(bookingId);
    const leadMs = 1200;
    await booking.update({
      scheduled_at: scheduledAtForReviewUntil(booking, new Date(Date.now() + leadMs)),
    });
    const until = getFinancialReviewUntil(await Booking.findByPk(bookingId));
    const waitOpen = until.getTime() - Date.now() - 250;
    if (waitOpen > 0) await sleep(waitOpen);

    const openRes = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'lesson_not_completed',
      'near cutoff',
    );
    assert.equal(openRes.status, 201, openRes.text);

    const waitCutoff = until.getTime() - Date.now();
    if (waitCutoff > 0) await sleep(waitCutoff + 30);
    assert.equal(isPostLessonFinancialReviewElapsed(await Booking.findByPk(bookingId)), true);

    const payoutResult = await processHeldEscrowPayment(await loadPayablePayment(paymentId));
    assert.equal(payoutResult.skipped, true);
    assert.equal(payoutResult.reason, 'open_dispute');

    const snap = await moneySnapshot(bookingId, paymentId);
    assertNeverRefundAndPayoutSameMoney(snap);
  });

  it('wrong user cannot open/resolve/get another booking dispute; duplicate open 409', async () => {
    await resetFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const tokenAdmin = await adminToken(baseUrl);

    const strangerLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.students[1].email, password: fixture.password },
    });
    assert.equal(strangerLogin.status, 200);
    const strangerToken = strangerLogin.json.data.token;

    const { bookingId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'dm_authz',
    );

    const strangerOpen = await openStudentDispute(
      baseUrl,
      strangerToken,
      bookingId,
      'lesson_not_completed',
      'not my booking',
    );
    assert.equal(strangerOpen.status, 403, strangerOpen.text);

    const openRes = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'lesson_not_completed',
      'valid open',
    );
    assert.equal(openRes.status, 201, openRes.text);
    const disputeId = openRes.json.data.id;

    const dupOpen = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'lesson_not_completed',
      'duplicate',
    );
    assert.equal(dupOpen.status, 409, dupOpen.text);

    const strangerGet = await api(baseUrl, 'GET', `/api/disputes/${disputeId}`, {
      token: strangerToken,
    });
    assert.equal(strangerGet.status, 403, strangerGet.text);

    const studentResolve = await api(baseUrl, 'PUT', `/api/disputes/${disputeId}/resolve`, {
      token: studentToken,
      body: {
        decision: 'upheld',
        penalize_role: 'coach',
        financial_action: 'refund_student',
      },
    });
    assert.equal(studentResolve.status, 403, studentResolve.text);

    const coachResolve = await api(baseUrl, 'PUT', `/api/disputes/${disputeId}/resolve`, {
      token: coachToken,
      body: {
        decision: 'rejected',
        penalize_role: 'none',
        financial_action: 'no_change',
      },
    });
    assert.equal(coachResolve.status, 403, coachResolve.text);

    // Admin can still resolve
    const ok = await api(baseUrl, 'PUT', `/api/disputes/${disputeId}/resolve`, {
      token: tokenAdmin,
      body: {
        decision: 'rejected',
        penalize_role: 'none',
        financial_action: 'no_change',
      },
    });
    assert.equal(ok.status, 200, ok.text);
  });

  it('student contests student_no_show; admin overturns to coach_no_show + refund (no payout)', async () => {
    await resetFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const tokenAdmin = await adminToken(baseUrl);

    const { bookingId, paymentId } = await createStudentNoShowBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'dm_overturn',
    );

    const openRes = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'coach_no_show_claim',
      'I was there; coach marked me no-show wrongly',
    );
    assert.equal(openRes.status, 201, openRes.text);
    const disputeId = openRes.json.data.id;

    await elapseReviewWindow(bookingId);
    let payoutResult = await processHeldEscrowPayment(await loadPayablePayment(paymentId));
    assert.equal(payoutResult.skipped, true);
    assert.equal(payoutResult.reason, 'open_dispute');

    const resolveRes = await api(baseUrl, 'PUT', `/api/disputes/${disputeId}/resolve`, {
      token: tokenAdmin,
      body: {
        decision: 'upheld',
        outcome: 'coach_no_show',
        financial_action: 'refund_student',
        resolution_notes: 'Overturn student_no_show; coach did not attend',
      },
    });
    assert.equal(resolveRes.status, 200, resolveRes.text);

    const booking = await Booking.findByPk(bookingId);
    assert.equal(booking.status, 'coach_no_show');
    assert.equal(booking.attendance_finalized, true);

    const actions = await PaymentAction.findAll({
      where: { booking_id: bookingId, action_type: 'dispute_refund_full', status: 'pending' },
    });
    assert.equal(actions.length, 1);

    await executeDisputeRefundAndSettle(bookingId, paymentId);
    const payment = await Payment.findByPk(paymentId);
    assert.equal(payment.escrow_status, 'refunded');

    payoutResult = await processHeldEscrowPayment(await loadPayablePayment(paymentId));
    assert.equal(payoutResult.skipped, true);

    const snap = await moneySnapshot(bookingId, paymentId);
    assert.equal(isPaidish(snap.booking, snap.payment), false);
    assertNeverRefundAndPayoutSameMoney(snap);
  });

  it('dispute refund Stripe failure keeps captured; retry succeeds; still no payout', async () => {
    await resetFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const tokenAdmin = await adminToken(baseUrl);

    const { bookingId, paymentId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'dm_refund_fail',
    );

    const openRes = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'lesson_not_completed',
      'refund fail path',
    );
    assert.equal(openRes.status, 201, openRes.text);

    const resolveRes = await api(baseUrl, 'PUT', `/api/disputes/${openRes.json.data.id}/resolve`, {
      token: tokenAdmin,
      body: {
        decision: 'upheld',
        penalize_role: 'coach',
        financial_action: 'refund_student',
      },
    });
    assert.equal(resolveRes.status, 200, resolveRes.text);

    stripeDouble.failNextCreateRefund = new Error('simulated Stripe refund failure');
    await paymentService.processPendingRefundPaymentActions({ batchLimit: 20 });

    let action = await PaymentAction.findOne({
      where: { booking_id: bookingId, action_type: 'dispute_refund_full' },
    });
    assert.equal(action.status, 'pending');
    assert.ok(Number(action.attempts) >= 1);
    assert.ok(action.error_message);

    let payment = await Payment.findByPk(paymentId);
    assert.equal(payment.payment_status, 'captured');
    assert.equal(payment.escrow_status, 'held');
    assert.notEqual(payment.refund_status, 'succeeded');

    assert.equal(stripeDouble.failNextCreateRefund, null);
    payment = await executeDisputeRefundAndSettle(bookingId, paymentId);
    assert.equal(payment.escrow_status, 'refunded');
    assert.equal(payment.refund_status, 'succeeded');

    action = await PaymentAction.findOne({
      where: { booking_id: bookingId, action_type: 'dispute_refund_full' },
    });
    assert.equal(action.status, 'succeeded');

    await elapseReviewWindow(bookingId);
    const payoutResult = await processHeldEscrowPayment(await loadPayablePayment(paymentId));
    assert.equal(payoutResult.skipped, true);
    assert.equal(payoutResult.reason, 'escrow_not_payable');
  });

  it('resolve-refund ↔ payout race never ends refunded+paid', async () => {
    await resetFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const tokenAdmin = await adminToken(baseUrl);

    const { bookingId, paymentId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'dm_race',
    );

    const openRes = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'lesson_not_completed',
      'race resolve vs payout',
    );
    assert.equal(openRes.status, 201, openRes.text);
    const disputeId = openRes.json.data.id;

    await elapseReviewWindow(bookingId);

    const [resolveRes] = await Promise.all([
      api(baseUrl, 'PUT', `/api/disputes/${disputeId}/resolve`, {
        token: tokenAdmin,
        body: {
          decision: 'upheld',
          penalize_role: 'coach',
          financial_action: 'refund_student',
        },
      }),
      processHeldEscrowPayment(await loadPayablePayment(paymentId)),
    ]);

    assert.ok([200, 400, 409].includes(resolveRes.status), resolveRes.text);

    // Drain any queued refund and settle charge.refunded mirror
    await paymentService.processPendingRefundPaymentActions({ batchLimit: 20 });
    const midPayment = await Payment.findByPk(paymentId);
    if (midPayment?.charge_id) {
      const charge = await stripeService.retrieveCharge(midPayment.charge_id);
      if (Number(charge.amount_refunded) > 0) {
        await paymentService.applyRefundStateFromStripeCharge(midPayment, charge, {
          stripeRefundId: midPayment.stripe_refund_id,
        });
      }
    }

    const snap = await moneySnapshot(bookingId, paymentId);
    const refundSucceeded = snap.actions.some(
      (a) => a.action_type.startsWith('dispute_refund') && a.status === 'succeeded',
    );
    const refundPending = snap.actions.some(
      (a) => a.action_type.startsWith('dispute_refund') && a.status === 'pending',
    );

    if (refundSucceeded || snap.payment.escrow_status === 'refunded') {
      assert.equal(isPaidish(snap.booking, snap.payment), false);
      assert.equal(snap.payment.transfer_id, null);
    }
    if (isPaidish(snap.booking, snap.payment)) {
      assert.equal(snap.payment.escrow_status !== 'refunded', true);
      assert.ok(Number(snap.payment.refunded_amount || 0) === 0);
      assert.ok(!refundPending || snap.openDisputes.length === 0);
    }
    assertNeverRefundAndPayoutSameMoney(snap);
  });

  it('second refund resolve after successful dispute refund returns refund_path_already_used', async () => {
    await resetFixture();
    const { baseUrl } = server;
    const { studentToken, coachToken } = await loginPair(baseUrl, fixture);
    const tokenAdmin = await adminToken(baseUrl);

    const { bookingId } = await createCapturedCompletedBooking(
      baseUrl,
      fixture,
      studentToken,
      coachToken,
      'dm_double_refund',
    );

    const open1 = await openStudentDispute(
      baseUrl,
      studentToken,
      bookingId,
      'lesson_not_completed',
      'first dispute',
    );
    assert.equal(open1.status, 201, open1.text);

    const resolve1 = await api(baseUrl, 'PUT', `/api/disputes/${open1.json.data.id}/resolve`, {
      token: tokenAdmin,
      body: {
        decision: 'upheld',
        penalize_role: 'coach',
        financial_action: 'refund_student',
      },
    });
    assert.equal(resolve1.status, 200, resolve1.text);
    await executeDisputeRefundAndSettle(bookingId, (await Payment.findOne({ where: { booking_id: bookingId } })).id);

    // New dispute after finalization (admin can open after window)
    await elapseReviewWindow(bookingId);
    const open2 = await api(baseUrl, 'POST', '/api/admin/disputes', {
      token: tokenAdmin,
      body: {
        booking_id: bookingId,
        dispute_type_id: await disputeTypeId('other'),
        notes: 'second dispute attempt for money',
      },
    });
    assert.equal(open2.status, 201, open2.text);

    const resolve2 = await api(baseUrl, 'PUT', `/api/disputes/${open2.json.data.id}/resolve`, {
      token: tokenAdmin,
      body: {
        decision: 'upheld',
        financial_action: 'refund_student',
        resolution_notes: 'should block double refund',
      },
    });
    assert.equal(resolve2.status, 409, resolve2.text);
    assert.equal(resolve2.json?.code, 'refund_path_already_used');
  });
});

if (!RUN) {
  describe('HTTP integration dispute money matrix (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
