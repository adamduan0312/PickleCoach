/**
 * DB-backed payment ↔ Stripe orchestration tests (no real Stripe API).
 *
 * Uses `setStripeTestDouble` + in-memory charge/refunds. Requires MySQL and
 * `RUN_PAYMENT_INTEGRATION=1`. Run: `npm run test:payment:integration`
 *
 * Out of scope here: Connect payout reversal webhooks (no product handler yet);
 * this suite focuses on refund mirror, `processRefund` ordering, idempotency,
 * and `payment_actions` reconciliation.
 */
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { afterEach, describe, it } from 'node:test';

import { sequelize, User, Lesson, Booking, Payment, PaymentAction } from '../models/index.js';
import { calculatePaymentAmounts, dollarsToCents } from '../services/paymentEngine.js';
import {
  applyRefundStateFromStripeCharge,
  assertStripePaymentConsistency,
  processRefund,
  reconcileRefundPaymentActionsWithStripe,
} from '../services/paymentService.js';
import * as stripeService from '../services/stripeService.js';
import { createInMemoryStripeChargeDouble } from './helpers/inMemoryStripeChargeDouble.mjs';

const RUN = process.env.RUN_PAYMENT_INTEGRATION === '1';
let dbOk = false;
let authErr = null;

if (RUN) {
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch (e) {
    authErr = e;
  }
}

if (RUN && !dbOk) {
  console.warn('[payment-stripe-integration] skipping: DB unavailable:', authErr?.message || authErr);
}

const describeIntegration = RUN && dbOk ? describe : describe.skip;

async function destroyCtx(ctx) {
  if (!ctx) return;
  const { paymentActionId, paymentId, bookingId, lessonId, studentId, coachId } = ctx;
  try {
    if (paymentActionId) await PaymentAction.destroy({ where: { id: paymentActionId } });
    if (paymentId) await Payment.destroy({ where: { id: paymentId } });
    if (bookingId) await Booking.destroy({ where: { id: bookingId } });
    if (lessonId) await Lesson.destroy({ where: { id: lessonId } });
    if (studentId) await User.destroy({ where: { id: studentId } });
    if (coachId) await User.destroy({ where: { id: coachId } });
  } catch {
    // best-effort cleanup
  }
}

async function createCapturedPaymentFixture() {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const passwordHash = bcrypt.hashSync('IntegrationTest1!', 8);

  const coach = await User.create({
    full_name: 'Integration Coach',
    email: `pc_pay_int_coach_${suffix}@example.com`,
    password_hash: passwordHash,
  });
  const student = await User.create({
    full_name: 'Integration Student',
    email: `pc_pay_int_student_${suffix}@example.com`,
    password_hash: passwordHash,
  });

  const lesson = await Lesson.create({
    coach_id: coach.id,
    title: 'Integration lesson',
    duration_minutes: 60,
    price: 100.0,
  });

  const booking = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: new Date(Date.now() - 86400000),
    duration_minutes: 60,
    price: 100.0,
    status: 'completed',
  });

  const amounts = calculatePaymentAmounts(100);
  const totalChargeCents = dollarsToCents(amounts.total_charge_to_student);
  const chargeId = `ch_int_${suffix}`;
  const paymentIntentId = `pi_int_${suffix}`;

  const payment = await Payment.create({
    booking_id: booking.id,
    coach_id: coach.id,
    student_id: student.id,
    lesson_price: amounts.lesson_price,
    platform_fee_percent: amounts.platform_fee_percent,
    platform_fee_amount: amounts.platform_fee_amount,
    total_charge_to_student: amounts.total_charge_to_student,
    coach_payout_expected: amounts.coach_payout_expected,
    escrow_status: 'released',
    payment_status: 'captured',
    refund_status: 'none',
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: paymentIntentId,
    charge_id: chargeId,
    refunded_amount: 0,
    metadata: {},
  });

  const double = createInMemoryStripeChargeDouble({
    chargeId,
    paymentIntentId,
    amountCents: totalChargeCents,
  });

  const ctx = {
    coachId: coach.id,
    studentId: student.id,
    lessonId: lesson.id,
    bookingId: booking.id,
    paymentId: payment.id,
    paymentActionId: null,
    chargeId,
    paymentIntentId,
    totalChargeCents,
  };

  return { payment, double, ctx };
}

describeIntegration('payment stripe integration (DB + mocked Stripe)', () => {
  let lastCtx = null;

  afterEach(async () => {
    stripeService.clearStripeTestDouble();
    await destroyCtx(lastCtx);
    lastCtx = null;
  });

  it('multi-step partial → full refund, webhook mirror, consistency, exhausted refunds', async () => {
    const { payment, double, ctx } = await createCapturedPaymentFixture();
    lastCtx = ctx;
    stripeService.setStripeTestDouble(double);

    const partialCents = 3000;
    const r1 = await processRefund(payment.id, { refundCents: partialCents });
    assert.equal(r1.payment.refund_status, 'pending');
    assert.ok(r1.refund?.id);

    const dup = await processRefund(payment.id, { refundCents: partialCents });
    assert.equal(dup.payment.refund_status, 'pending');
    assert.equal(dup.refund?.id, r1.refund.id);

    let pay = await Payment.findByPk(payment.id);
    const chargeAfterApi = await stripeService.retrieveCharge(ctx.chargeId);
    await applyRefundStateFromStripeCharge(pay, chargeAfterApi, {});
    pay = await Payment.findByPk(payment.id);
    assert.equal(pay.payment_status, 'partially_refunded');
    assert.equal(pay.refund_status, 'succeeded');
    assert.equal(dollarsToCents(pay.refunded_amount), partialCents);

    let c = await assertStripePaymentConsistency(pay, { autoHeal: false, context: 'after_partial' });
    assert.equal(c.ok, true);

    const remaining = ctx.totalChargeCents - partialCents;
    const r2 = await processRefund(payment.id, { refundCents: remaining });
    assert.ok(r2.refund?.id);
    pay = await Payment.findByPk(payment.id);
    assert.equal(pay.refund_status, 'pending');

    const chargeFull = await stripeService.retrieveCharge(ctx.chargeId);
    await applyRefundStateFromStripeCharge(pay, chargeFull, {});
    pay = await Payment.findByPk(payment.id);
    assert.equal(pay.payment_status, 'refunded');
    assert.equal(dollarsToCents(pay.refunded_amount), ctx.totalChargeCents);

    c = await assertStripePaymentConsistency(pay, { autoHeal: false, context: 'after_full' });
    assert.equal(c.ok, true);

    await assert.rejects(
      () => processRefund(payment.id, { refundCents: 1 }),
      /No refundable balance remaining/,
    );

    const charge3 = await stripeService.retrieveCharge(ctx.chargeId);
    await applyRefundStateFromStripeCharge(pay, charge3, {});
    pay = await Payment.findByPk(payment.id);
    assert.equal(dollarsToCents(pay.refunded_amount), ctx.totalChargeCents);
  });

  it('Stripe refunds.create idempotency replay does not double-charge the in-memory charge', async () => {
    const { double, ctx } = await createCapturedPaymentFixture();
    lastCtx = ctx;
    stripeService.setStripeTestDouble(double);

    const key = `idem_replay_${ctx.paymentId}`;
    await stripeService.createRefund(ctx.chargeId, {
      amountCents: 4000,
      idempotencyKey: key,
      metadata: { payment_id: String(ctx.paymentId) },
    });
    await stripeService.createRefund(ctx.chargeId, {
      amountCents: 4000,
      idempotencyKey: key,
      metadata: { payment_id: String(ctx.paymentId) },
    });
    assert.equal(double.state.amountRefunded, 4000);
    assert.equal(double.state.refunds.length, 1);
  });

  it('reconcileRefundPaymentActionsWithStripe heals pending row when Stripe already has refund metadata', async () => {
    const { payment, double, ctx } = await createCapturedPaymentFixture();
    lastCtx = ctx;
    stripeService.setStripeTestDouble(double);

    const pa = await PaymentAction.create({
      booking_id: ctx.bookingId,
      payment_id: ctx.paymentId,
      dispute_id: null,
      action_type: 'booking_cancel_refund',
      status: 'pending',
      refund_cents: 2500,
      idempotency_key: null,
      stripe_idempotency_key: null,
      stripe_refund_id: null,
      attempts: 0,
    });
    lastCtx.paymentActionId = pa.id;

    double.state.refunds.push({
      id: 're_preseed_meta',
      amount: 2500,
      metadata: { payment_action_id: String(pa.id), booking_id: String(ctx.bookingId) },
    });
    double.state.amountRefunded += 2500;

    await reconcileRefundPaymentActionsWithStripe({
      batchLimit: 50,
      autoHeal: true,
      bookingId: ctx.bookingId,
    });

    const reloaded = await PaymentAction.findByPk(pa.id);
    assert.equal(reloaded.status, 'succeeded');
    assert.equal(reloaded.stripe_refund_id, 're_preseed_meta');
  });

  it('reconcileRefundPaymentActionsWithStripe idempotent replay creates refund once', async () => {
    const { payment, double, ctx } = await createCapturedPaymentFixture();
    lastCtx = ctx;
    stripeService.setStripeTestDouble(double);

    const pa = await PaymentAction.create({
      booking_id: ctx.bookingId,
      payment_id: ctx.paymentId,
      dispute_id: null,
      action_type: 'booking_cancel_refund',
      status: 'pending',
      refund_cents: 1800,
      idempotency_key: null,
      stripe_idempotency_key: null,
      stripe_refund_id: null,
      attempts: 0,
    });
    lastCtx.paymentActionId = pa.id;

    await reconcileRefundPaymentActionsWithStripe({
      batchLimit: 50,
      autoHeal: true,
      bookingId: ctx.bookingId,
    });
    const mid = await PaymentAction.findByPk(pa.id);
    assert.equal(mid.status, 'succeeded');
    assert.ok(mid.stripe_refund_id);

    await reconcileRefundPaymentActionsWithStripe({
      batchLimit: 50,
      autoHeal: true,
      bookingId: ctx.bookingId,
    });
    const after = await PaymentAction.findByPk(pa.id);
    assert.equal(after.status, 'succeeded');
    assert.equal(after.stripe_refund_id, mid.stripe_refund_id);
    assert.equal(double.state.refunds.length, 1);
    assert.equal(double.state.amountRefunded, 1800);
  });
});
