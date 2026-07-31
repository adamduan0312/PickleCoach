import { dollarsToCents } from '../services/paymentEngine.js';

export const LATE_CANCELLATION_PENALTY_REASON = 'Late cancellation';

/** Coach-facing copy for cancellation policy UI / help screens. */
export const COACH_LATE_STUDENT_CANCEL_HELP_TEXT =
  'Student cancellations made within 24 hours of the lesson start time receive a 50% refund when payment was captured. The remaining amount is split between coach payout and the platform commission (same ratio as a completed lesson). If payment was only authorized and not yet captured (e.g. pending booking before coach accept), the authorization is released in full and no coach payout applies.';

/** Student late cancel with retained penalty — coach receives normal payout share of net retained. */
export const isLateCancelRetainedRevenueEligible = ({
  bookingStatus,
  cancelledBy,
  penaltyCents,
  penaltyReason,
}) =>
  bookingStatus === 'cancelled' &&
  cancelledBy === 'student' &&
  penaltyReason === LATE_CANCELLATION_PENALTY_REASON &&
  Math.round(Number(penaltyCents) || 0) > 0;

export const isLateCancelRetainedRevenueEligibleFromHistory = (historyRow) => {
  if (!historyRow) return false;
  return isLateCancelRetainedRevenueEligible({
    bookingStatus: 'cancelled',
    cancelledBy: historyRow.cancelled_by,
    penaltyCents: dollarsToCents(historyRow.penalty_amount),
    penaltyReason: historyRow.penalty_reason,
  });
};

/**
 * Late-cancel coach payout may run only after the partial refund is finalized on Stripe
 * (payment mirrored as partially_refunded + refund_status succeeded).
 */
export const isLateCancelRefundSettledForPayout = (payment) => {
  if (!payment) return false;
  const refundedCents = dollarsToCents(payment.refunded_amount);
  return (
    payment.payment_status === 'partially_refunded' &&
    payment.refund_status === 'succeeded' &&
    refundedCents > 0
  );
};

/**
 * Coach payout after student late cancel requires a captured charge (partial refund path).
 * Uncaptured authorize-only PaymentIntents are voided in full — no retained funds to split.
 */
export const shouldQueueLateCancelCoachPayout = ({
  bookingStatus,
  cancelledBy,
  penaltyCents,
  penaltyReason,
  refundPaymentId,
  voidedPaymentId,
}) =>
  isLateCancelRetainedRevenueEligible({
    bookingStatus,
    cancelledBy,
    penaltyCents,
    penaltyReason,
  }) &&
  Boolean(refundPaymentId) &&
  !voidedPaymentId;

/** Financial rows for cancellation_history when auth-only PI is voided (no capture, no split). */
export const cancellationFinancialsForHistory = ({
  voidedPaymentId,
  refund_amount,
  penalty_amount,
  penalty_reason,
}) =>
  voidedPaymentId
    ? { refund_amount: '0.00', penalty_amount: '0.00', penalty_reason: null }
    : { refund_amount, penalty_amount, penalty_reason };
