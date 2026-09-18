/**
 * Booking financial settlement presentation (customer + admin resolve preview).
 * Prefer payment row fields as source of truth; preview uses the same 8%/92% ratio
 * as capture-time coach share for advisory UI only.
 */

import { formatMoney } from '../utils/format.js';
import {
  coachPayoutLabel,
  financialOutcomeLabel,
  issueResolutionFacts,
  resolveFinancialAction,
} from './issueResolutionDisplay.js';

/** Matches backend PLATFORM_FEE_PERCENT / coach share at capture. */
export const PLATFORM_FEE_RATIO = 0.08;
export const COACH_PAYOUT_RATIO = 0.92;

function toCents(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToDollars(cents) {
  return Number((cents / 100).toFixed(2));
}

/**
 * Allocate retained amount after a student refund (integer cents).
 * Coach = round(retained * 0.92); platform = retained − coach (absorbs rounding).
 */
export function allocateRetainedAfterRefundCents({
  capturedCents,
  studentRefundCents,
} = {}) {
  const captured = Math.max(0, Math.round(Number(capturedCents) || 0));
  const refund = Math.max(0, Math.min(captured, Math.round(Number(studentRefundCents) || 0)));
  const retained = Math.max(0, captured - refund);
  const coach = Math.min(retained, Math.max(0, Math.round(retained * COACH_PAYOUT_RATIO)));
  const platform = retained - coach;
  return {
    capturedCents: captured,
    studentRefundCents: refund,
    retainedCents: retained,
    platformFeeCents: platform,
    coachPayoutCents: coach,
  };
}

/**
 * Live admin resolve preview from captured charge + selected financial action.
 * @returns {null | { studentRefund, remaining, platformFee, coachPayout, lines: string[] }}
 */
export function previewFinancialAllocation({
  capturedAmount,
  financialAction,
  refundAmount,
} = {}) {
  const capturedCents = toCents(capturedAmount);
  if (capturedCents == null || capturedCents < 1) return null;

  const action = String(financialAction || '');
  let studentRefundCents = 0;
  if (action === 'refund_student') {
    studentRefundCents = capturedCents;
  } else if (action === 'refund_student_partial') {
    const partialCents = toCents(refundAmount);
    if (partialCents == null || partialCents < 1) return null;
    studentRefundCents = Math.min(capturedCents, partialCents);
  } else if (action === 'no_change') {
    studentRefundCents = 0;
  } else {
    return null;
  }

  const split = allocateRetainedAfterRefundCents({
    capturedCents,
    studentRefundCents,
  });

  return {
    studentRefund: centsToDollars(split.studentRefundCents),
    remaining: centsToDollars(split.retainedCents),
    platformFee: centsToDollars(split.platformFeeCents),
    coachPayout: centsToDollars(split.coachPayoutCents),
    lines: [
      `Student refund: ${formatMoney(centsToDollars(split.studentRefundCents))}`,
      `Amount remaining: ${formatMoney(centsToDollars(split.retainedCents))}`,
      `Platform fee: ${formatMoney(centsToDollars(split.platformFeeCents))}`,
      `Coach payout: ${formatMoney(centsToDollars(split.coachPayoutCents))}`,
    ],
  };
}

/**
 * Settlement facts from booking payment.
 * Expected coach/platform after refunds are derived from retained amount
 * (captured − refunded) using the same 92/8 split as payout — never trust
 * stale capture-time `platform_fee_amount` / mis-seeded `coach_payout_expected`.
 */
export function bookingSettlementFacts(booking, payment, resolvedIssue = null) {
  const captured = payment?.total_charge_to_student != null
    ? Number(payment.total_charge_to_student)
    : null;
  const refunded = payment?.refunded_amount != null ? Number(payment.refunded_amount) : 0;
  const remaining =
    Number.isFinite(captured) && Number.isFinite(refunded)
      ? Math.max(0, Number((captured - refunded).toFixed(2)))
      : null;

  const capturedCents = Number.isFinite(captured) ? toCents(captured) : null;
  const refundedCents = Number.isFinite(refunded) ? toCents(refunded) : 0;
  const derived =
    capturedCents != null && refundedCents != null
      ? allocateRetainedAfterRefundCents({
        capturedCents,
        studentRefundCents: refundedCents,
      })
      : null;

  // After any successful refund, expected allocation follows retained amount.
  // Before refunds, fall back to payment row capture snapshot.
  const useDerived = derived && refundedCents > 0;
  const platformFee = useDerived
    ? centsToDollars(derived.platformFeeCents)
    : (payment?.platform_fee_amount != null ? Number(payment.platform_fee_amount) : null);
  const coachExpected = useDerived
    ? centsToDollars(derived.coachPayoutCents)
    : (payment?.coach_payout_expected != null ? Number(payment.coach_payout_expected) : null);

  const payoutLabel = coachPayoutLabel(booking, payment);
  const ps = String(payment?.payment_status || '').toLowerCase();
  const rs = String(payment?.refund_status || '').toLowerCase();
  const escrow = String(payment?.escrow_status || '').toLowerCase();
  const payoutStatus = String(booking?.payout_status || '').toLowerCase();

  // Refund recorded on the charge (amount mirrored) vs Stripe refund still in flight.
  const refundRecorded =
    refunded > 0 && (ps === 'refunded' || ps === 'partially_refunded');
  const refundSucceeded =
    rs === 'succeeded' || rs === 'complete' || rs === 'completed';
  const refundPending = rs === 'pending' && !refundSucceeded;
  const refundComplete = refundRecorded && (refundSucceeded || (!refundPending && rs !== 'failed'));
  const payoutFailed = escrow === 'manual_payout_required' || payoutLabel === 'Failed — manual review';
  const payoutPending =
    !payoutFailed
    && (
      payoutLabel === 'Pending'
      || (['none', 'pending', 'awaiting_verification'].includes(payoutStatus)
        && payoutLabel !== 'None due'
        && payoutLabel !== 'Paid')
    );
  const payoutDone = payoutLabel === 'Paid' || payoutStatus === 'paid' || escrow === 'released';
  const fullRefundDone = ps === 'refunded' && (payoutLabel === 'None due' || coachExpected === 0);

  let settlementStatus = 'pending';
  let settlementHeadline = 'Settlement';
  if (payoutFailed || rs === 'failed') {
    settlementStatus = 'failed';
    settlementHeadline = 'Settlement failed — manual review required';
  } else if (fullRefundDone || (payoutDone && (refundComplete || !refundRecorded) && !payoutPending)) {
    settlementStatus = 'complete';
    settlementHeadline = 'Settlement complete';
  } else if (refundPending) {
    settlementStatus = 'pending';
    settlementHeadline = 'Student refund pending';
  } else if (refundComplete && payoutPending && ps === 'partially_refunded') {
    settlementStatus = 'pending';
    settlementHeadline = 'Partial refund complete — coach payout pending';
  } else if (refundComplete && payoutPending) {
    settlementStatus = 'pending';
    settlementHeadline = 'Student refund complete — coach payout pending';
  } else if (escrow === 'pending_release' || payoutPending) {
    settlementStatus = 'pending';
    settlementHeadline = 'Coach payout pending';
  } else if (ps === 'partially_refunded') {
    settlementStatus = 'pending';
    settlementHeadline = 'Partial refund recorded — settlement pending';
  }

  const financialAction = resolveFinancialAction(resolvedIssue);
  const disputeFinancial = financialOutcomeLabel(resolvedIssue);
  const issueFacts = resolvedIssue ? issueResolutionFacts(resolvedIssue) : null;

  // Only surface an "initial" refund line for partials (full refund is already clear
  // from dispute financial action + student refunded total).
  const initialStudentRefund =
    financialAction === 'refund_student_partial' && resolvedIssue?.refund_amount != null
      ? Number(resolvedIssue.refund_amount)
      : null;

  return {
    settlementStatus,
    settlementHeadline,
    disputeFinancialLabel: disputeFinancial,
    decisionLabel: issueFacts?.decision ?? null,
    initialStudentRefund,
    studentRefunded: Number.isFinite(refunded) ? refunded : null,
    coachPayoutExpected: Number.isFinite(coachExpected) ? coachExpected : null,
    platformFee: Number.isFinite(platformFee) ? platformFee : null,
    remaining,
    captured: Number.isFinite(captured) ? captured : null,
    coachPayoutStatusLabel: payoutLabel,
    refundStatus: rs || null,
    paymentStatus: ps || null,
    fullRefundDone,
    refundPending,
    refundComplete,
  };
}

/** Rows for booking-detail / issue-resolution settlement dl (money only). */
export function bookingSettlementDisplayRows(facts) {
  if (!facts) return [];
  const rows = [];
  if (facts.initialStudentRefund != null && Number(facts.initialStudentRefund) > 0) {
    rows.push({
      dt: 'Initial student refund',
      dd: formatMoney(facts.initialStudentRefund),
    });
  }
  if (facts.studentRefunded != null) {
    let refundDd = formatMoney(facts.studentRefunded);
    if (facts.refundPending && Number(facts.studentRefunded) > 0) {
      refundDd = `Pending — ${formatMoney(facts.studentRefunded)}`;
    } else if (facts.refundComplete && Number(facts.studentRefunded) > 0) {
      refundDd = `Complete — ${formatMoney(facts.studentRefunded)}`;
    }
    rows.push({ dt: 'Student refunded total', dd: refundDd });
  }
  if (facts.remaining != null) {
    rows.push({
      dt: 'Amount retained after student refund',
      dd: formatMoney(facts.remaining),
    });
  }
  if (facts.coachPayoutStatusLabel === 'Paid' && facts.coachPayoutExpected != null) {
    rows.push({
      dt: 'Coach payout',
      dd: `Complete — ${formatMoney(facts.coachPayoutExpected)}`,
    });
  } else if (facts.coachPayoutStatusLabel) {
    let coachDd;
    if (facts.coachPayoutStatusLabel === 'Failed — manual review') {
      coachDd = facts.coachPayoutExpected != null
        ? `Failed — manual review — ${formatMoney(facts.coachPayoutExpected)}`
        : 'Failed — manual review required';
    } else if (facts.coachPayoutStatusLabel === 'Pending' && facts.coachPayoutExpected != null) {
      coachDd = facts.refundPending
        ? `Not yet due until refund settlement — ${formatMoney(facts.coachPayoutExpected)} expected`
        : `Pending — ${formatMoney(facts.coachPayoutExpected)} expected`;
    } else if (facts.coachPayoutStatusLabel === 'None due') {
      coachDd = facts.fullRefundDone
        ? `${formatMoney(0)} — none due because the full charge was refunded`
        : `${formatMoney(0)} (none due)`;
    } else {
      coachDd = facts.coachPayoutStatusLabel;
    }
    rows.push({ dt: 'Coach payout', dd: coachDd });
  }
  if (facts.platformFee != null) {
    const feeFailed = facts.settlementStatus === 'failed' && Number(facts.platformFee) > 0;
    const feePending =
      facts.settlementStatus === 'pending'
      && facts.coachPayoutStatusLabel === 'Pending'
      && Number(facts.platformFee) > 0;
    let feeDd = formatMoney(facts.platformFee);
    if (feeFailed) {
      feeDd = `${formatMoney(facts.platformFee)} retained`;
    } else if (feePending) {
      feeDd = facts.refundPending
        ? 'Not yet settled'
        : `Pending — ${formatMoney(facts.platformFee)} expected`;
    }
    rows.push({
      dt: 'Platform fee',
      dd: feeDd,
    });
  }
  return rows;
}
