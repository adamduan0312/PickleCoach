/**
 * Canonical QA matrix for booking-detail ↔ issue-resolution settlement parity.
 * Used by seed:resolved-issues-qa and automated settlement audits.
 *
 * Money modes map to payment row snapshots (not live Stripe).
 */
import { calculatePaymentAmounts, dollarsToCents } from '../services/paymentEngine.js';

/** @typedef {'full_refund'|'partial_refund'|'none'|'manual_payout'} SettlementMoneyMode */

/**
 * @returns {Array<{
 *   key: string,
 *   title: string,
 *   type: string,
 *   opened_by: 'student'|'coach',
 *   decision: 'upheld'|'rejected',
 *   outcome: string|null,
 *   financial: 'refund_student'|'refund_student_partial'|'no_change',
 *   penalize_role: 'none'|'coach'|'student',
 *   bookingStatus: string,
 *   money: SettlementMoneyMode,
 *   refund_cents?: number|null,
 *   cancelled_by?: string|null,
 *   expectList: string,
 * }>}
 */
export function buildResolvedIssuesQaSpecs() {
  return [
    {
      key: 'coach_no_show_upheld_full_refund',
      title: 'Coach no-show · upheld · full refund',
      type: 'coach_no_show_claim',
      opened_by: 'student',
      decision: 'upheld',
      outcome: 'coach_no_show',
      financial: 'refund_student',
      penalize_role: 'none',
      bookingStatus: 'coach_no_show',
      money: 'full_refund',
      expectList: 'Coach no-show',
    },
    {
      key: 'coach_no_show_partial_refund',
      title: 'Coach no-show · upheld · partial refund',
      type: 'coach_no_show_claim',
      opened_by: 'student',
      decision: 'upheld',
      outcome: 'coach_no_show',
      financial: 'refund_student_partial',
      penalize_role: 'none',
      bookingStatus: 'coach_no_show',
      money: 'partial_refund',
      refund_cents: 4000,
      expectList: 'Coach no-show',
    },
    {
      key: 'coach_no_show_claim_rejected',
      title: 'Coach no-show claim · rejected → student no-show',
      type: 'coach_no_show_claim',
      opened_by: 'student',
      decision: 'rejected',
      outcome: 'student_no_show',
      financial: 'no_change',
      penalize_role: 'none',
      bookingStatus: 'student_no_show',
      money: 'none',
      expectList: 'Student no-show',
    },
    {
      key: 'student_no_show_upheld',
      title: 'Student no-show · upheld · no refund',
      type: 'student_no_show_claim',
      opened_by: 'coach',
      decision: 'upheld',
      outcome: 'student_no_show',
      financial: 'no_change',
      penalize_role: 'none',
      bookingStatus: 'student_no_show',
      money: 'none',
      expectList: 'Student no-show',
    },
    {
      key: 'student_no_show_manual_payout',
      title: 'Student no-show · upheld · manual payout required',
      type: 'student_no_show_claim',
      opened_by: 'coach',
      decision: 'upheld',
      outcome: 'student_no_show',
      financial: 'no_change',
      penalize_role: 'none',
      bookingStatus: 'student_no_show',
      money: 'manual_payout',
      expectList: 'Student no-show',
    },
    {
      key: 'student_no_show_claim_rejected',
      title: 'Student no-show claim · rejected → coach no-show',
      type: 'student_no_show_claim',
      opened_by: 'coach',
      decision: 'rejected',
      outcome: 'coach_no_show',
      financial: 'refund_student',
      penalize_role: 'none',
      bookingStatus: 'coach_no_show',
      money: 'full_refund',
      expectList: 'Coach no-show',
    },
    {
      key: 'misconduct_upheld_penalize_coach',
      title: 'Misconduct · upheld · penalize coach',
      type: 'misconduct',
      opened_by: 'student',
      decision: 'upheld',
      outcome: null,
      financial: 'no_change',
      penalize_role: 'coach',
      bookingStatus: 'completed',
      money: 'none',
      expectList: 'Completed',
    },
    {
      key: 'misconduct_upheld_refund',
      title: 'Misconduct · upheld · full refund',
      type: 'misconduct',
      opened_by: 'student',
      decision: 'upheld',
      outcome: null,
      financial: 'refund_student',
      penalize_role: 'coach',
      bookingStatus: 'completed',
      money: 'full_refund',
      expectList: 'Completed',
    },
    {
      key: 'misconduct_rejected',
      title: 'Misconduct · rejected',
      type: 'misconduct',
      opened_by: 'student',
      decision: 'rejected',
      outcome: null,
      financial: 'no_change',
      penalize_role: 'none',
      bookingStatus: 'completed',
      money: 'none',
      expectList: 'Completed',
    },
    {
      key: 'lesson_not_completed_partial',
      title: 'Lesson not completed · upheld · partial refund',
      type: 'lesson_not_completed',
      opened_by: 'student',
      decision: 'upheld',
      outcome: null,
      financial: 'refund_student_partial',
      penalize_role: 'coach',
      bookingStatus: 'completed',
      money: 'partial_refund',
      refund_cents: 2500,
      expectList: 'Completed',
    },
    {
      key: 'lesson_not_completed_rejected',
      title: 'Lesson not completed · rejected',
      type: 'lesson_not_completed',
      opened_by: 'student',
      decision: 'rejected',
      outcome: null,
      financial: 'no_change',
      penalize_role: 'none',
      bookingStatus: 'completed',
      money: 'none',
      expectList: 'Completed',
    },
    {
      key: 'other_upheld_refund',
      title: 'Other · upheld · full refund',
      type: 'other',
      opened_by: 'student',
      decision: 'upheld',
      outcome: null,
      financial: 'refund_student',
      penalize_role: 'none',
      bookingStatus: 'completed',
      money: 'full_refund',
      expectList: 'Completed',
    },
    {
      key: 'other_rejected',
      title: 'Other · rejected',
      type: 'other',
      opened_by: 'student',
      decision: 'rejected',
      outcome: null,
      financial: 'no_change',
      penalize_role: 'none',
      bookingStatus: 'completed',
      money: 'none',
      expectList: 'Completed',
    },
    {
      key: 'other_on_cancelled',
      title: 'Other · resolved · booking stays Cancelled',
      type: 'other',
      opened_by: 'student',
      decision: 'upheld',
      outcome: null,
      financial: 'refund_student',
      penalize_role: 'none',
      bookingStatus: 'cancelled',
      cancelled_by: 'student',
      money: 'full_refund',
      expectList: 'Cancelled',
    },
  ];
}

/**
 * Build payment attrs for a booking + money mode (mirrors seed:resolved-issues-qa).
 * @param {{ id?: number, coach_id?: number, primary_student_id?: number, price: number|string }} booking
 * @param {SettlementMoneyMode} money
 * @param {{
 *   paymentIntentId?: string,
 *   chargeId?: string,
 *   stripeRefundId?: string,
 *   refundCents?: number|null,
 * }} [ids]
 */
export function buildSettlementQaPaymentAttrs(booking, money, ids = {}) {
  const amounts = calculatePaymentAmounts(Number(booking.price));
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  const bookingId = booking.id != null ? booking.id : 'qa';

  const base = {
    booking_id: booking.id ?? null,
    coach_id: booking.coach_id ?? null,
    student_id: booking.primary_student_id ?? null,
    lesson_price: amounts.lesson_price,
    platform_fee_percent: amounts.platform_fee_percent,
    platform_fee_amount: amounts.platform_fee_amount,
    total_charge_to_student: amounts.total_charge_to_student,
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: ids.paymentIntentId ?? `pi_seed_dev_qa_${bookingId}`,
    charge_id: ids.chargeId ?? `ch_seed_dev_qa_${bookingId}`,
    metadata: { qa_fixture: true, seed_skip_payout_worker: true },
  };

  if (money === 'full_refund') {
    return {
      ...base,
      coach_payout_expected: '0.00',
      platform_fee_amount: '0.00',
      escrow_status: 'refunded',
      payment_status: 'refunded',
      refund_status: 'succeeded',
      refunded_amount: amounts.total_charge_to_student,
      stripe_refund_id: ids.stripeRefundId ?? `re_seed_dev_qa_${bookingId}`,
    };
  }

  if (money === 'partial_refund') {
    const totalCents = Math.round(totalCharge * 100);
    const explicit = ids.refundCents != null ? Math.round(Number(ids.refundCents)) : null;
    const refundCents = Math.max(
      1,
      Math.min(
        totalCents - 1,
        Number.isFinite(explicit) && explicit > 0
          ? explicit
          : Math.round(totalCents * 0.5),
      ),
    );
    const retainedCents = Math.max(0, totalCents - refundCents);
    const coachCents = Math.min(
      retainedCents,
      Math.max(0, Math.round(retainedCents * 0.92)),
    );
    const platformCents = retainedCents - coachCents;
    return {
      ...base,
      coach_payout_expected: (coachCents / 100).toFixed(2),
      platform_fee_amount: (platformCents / 100).toFixed(2),
      escrow_status: 'held',
      payment_status: 'partially_refunded',
      refund_status: 'succeeded',
      refunded_amount: (refundCents / 100).toFixed(2),
      stripe_refund_id: ids.stripeRefundId ?? `re_seed_dev_qa_${bookingId}`,
      // Avoid live payout workers treating seed rows as transferable Stripe charges.
      charge_id: null,
    };
  }

  if (money === 'manual_payout') {
    return {
      ...base,
      coach_payout_expected: amounts.coach_payout_expected,
      escrow_status: 'manual_payout_required',
      payment_status: 'captured',
      refund_status: 'none',
      refunded_amount: '0.00',
      charge_id: null,
    };
  }

  // no money move — still captured / held (post-resolve escrow may later release).
  // Omit Stripe charge_id so local payout workers do not attempt Connect transfers
  // against fake seed charges (which parks escrow at manual_payout_required).
  return {
    ...base,
    coach_payout_expected: amounts.coach_payout_expected,
    escrow_status: 'held',
    payment_status: 'captured',
    refund_status: 'none',
    refunded_amount: '0.00',
    charge_id: null,
  };
}

/**
 * Expected settlement amounts (cents) from charge + money mode.
 * Partial uses 50% of charge (same as seed payment attrs), not dispute refund_cents,
 * except when money is partial and refund_cents is provided for display-only initial refund.
 */
export function expectedSettlementCentsFromPayment(payment) {
  const capturedCents = dollarsToCents(payment.total_charge_to_student);
  const refundedCents = dollarsToCents(payment.refunded_amount ?? 0);
  const retainedCents = Math.max(0, capturedCents - refundedCents);
  const coachCents = Math.min(
    retainedCents,
    Math.max(0, Math.round(retainedCents * 0.92)),
  );
  const platformCents = retainedCents - coachCents;
  return {
    capturedCents,
    refundedCents,
    retainedCents,
    coachPayoutCents: coachCents,
    platformFeeCents: platformCents,
  };
}

/**
 * Compare two payment-like objects for settlement-critical fields.
 * @returns {string[]} mismatch messages
 */
export function diffSettlementPaymentFields(bookingPayment, disputePayment, { label = '' } = {}) {
  const keys = [
    'total_charge_to_student',
    'refunded_amount',
    'coach_payout_expected',
    'platform_fee_amount',
    'payment_status',
    'refund_status',
    'escrow_status',
  ];
  const mismatches = [];
  if (!bookingPayment) {
    mismatches.push(`${label}booking payment missing`);
    return mismatches;
  }
  if (!disputePayment) {
    mismatches.push(`${label}dispute payment missing (payments.dispute_id likely unset)`);
    return mismatches;
  }
  for (const key of keys) {
    const a = bookingPayment[key] == null ? null : String(bookingPayment[key]);
    const b = disputePayment[key] == null ? null : String(disputePayment[key]);
    if (a !== b) {
      mismatches.push(`${label}${key}: booking=${a} dispute=${b}`);
    }
  }
  return mismatches;
}
