/**
 * Pure Stripe / payment pipeline contracts — webhook deduplication, refund mirror classification,
 * idempotency key shapes, and payment_action type sets. Keeps operational rules testable without DB/Stripe.
 *
 * Side-effecting flows remain in `webhookController.js` and `paymentService.js`.
 */

import { normalizeStripeCurrencyCents } from './paymentEngine.js';

// ---------------------------------------------------------------------------
// Webhook idempotency (Stripe retries same event.id)
// ---------------------------------------------------------------------------

/** When a prior `webhook_logs` row exists with success=true, processing must short-circuit. */
export const shouldStripeWebhookSkipAsDuplicate = (existingWebhookLog) =>
  Boolean(existingWebhookLog?.success);

// ---------------------------------------------------------------------------
// Stripe chargeback dispute → local escrow / payment_status reconciliation
// ---------------------------------------------------------------------------

/** Terminal outcomes from Stripe Dispute.status (charge.dispute.closed). */
export const TERMINAL_STRIPE_DISPUTE_STATUSES = Object.freeze(['won', 'lost', 'charge_refunded']);

export function isTerminalStripeDisputeStatus(stripeStatus) {
  return TERMINAL_STRIPE_DISPUTE_STATUSES.includes(stripeStatus);
}

/**
 * Non-terminal Stripe dispute — park payment escrow (money not releasable).
 * @returns {{ escrow_status: 'disputed', payment_status: null }}
 */
export function mapOpenStripeDisputeEscrowReconciliation() {
  return { escrow_status: 'disputed', payment_status: null };
}

/**
 * Terminal Stripe dispute — release escrow parking per outcome.
 * Traced against payout worker (`escrow_status: 'held'` only) and
 * `classifyStripeChargeRefundMirrorUpdate` (full refund → `refunded`).
 *
 * @param {string} stripeStatus — `won` | `lost` | `charge_refunded`
 * @returns {{ escrow_status: string, payment_status: string | null } | null}
 *   `payment_status: null` means leave the column unchanged.
 */
export function mapTerminalStripeDisputeEscrowReconciliation(stripeStatus) {
  switch (stripeStatus) {
    case 'won':
      // Merchant won — funds remain on the charge; coach payout may resume.
      return { escrow_status: 'held', payment_status: null };
    case 'lost':
    case 'charge_refunded':
      // Cardholder won or charge refunded — money left the charge.
      return { escrow_status: 'refunded', payment_status: 'refunded' };
    default:
      return null;
  }
}

/**
 * Pure payment patch for `syncStripeDisputeToDatabase` (idempotent on replay).
 * @param {{ id: string, status: string }} stripeDispute
 */
export function buildStripeDisputePaymentPatch(stripeDispute) {
  const stripeStatus = stripeDispute.status;
  const base = {
    stripe_dispute_id: stripeDispute.id,
    stripe_dispute_status: stripeStatus,
  };

  if (isTerminalStripeDisputeStatus(stripeStatus)) {
    const terminal = mapTerminalStripeDisputeEscrowReconciliation(stripeStatus);
    if (!terminal) return base;
    return {
      ...base,
      escrow_status: terminal.escrow_status,
      ...(terminal.payment_status != null ? { payment_status: terminal.payment_status } : {}),
    };
  }

  const open = mapOpenStripeDisputeEscrowReconciliation();
  return { ...base, escrow_status: open.escrow_status };
}

/**
 * Booking was parked by STRIPE_DISPUTE_OPEN — release on terminal Stripe outcome.
 * @param {string | null | undefined} bookingStatus
 * @param {string} stripeStatus
 */
export function shouldReleaseBookingFromStripeDisputeTerminal(bookingStatus, stripeStatus) {
  return bookingStatus === 'disputed' && isTerminalStripeDisputeStatus(stripeStatus);
}

// ---------------------------------------------------------------------------
// charge.refunded → local payment_status / escrow_status (mirror applyRefundStateFromStripeCharge)
// ---------------------------------------------------------------------------

/**
 * Maps Stripe charge gross + refunded cents to persisted payment_status / escrow_status.
 * Matches `applyRefundStateFromStripeCharge`: no DB update when refunded is 0.
 */
export const classifyStripeChargeRefundMirrorUpdate = (chargeAmountCents, refundedCents) => {
  const gross = normalizeStripeCurrencyCents(chargeAmountCents);
  const ref = normalizeStripeCurrencyCents(refundedCents);
  if (ref < 1) {
    return { shouldUpdate: false, payment_status: null, escrow_status: null };
  }
  if (gross > 0 && ref >= gross) {
    return { shouldUpdate: true, payment_status: 'refunded', escrow_status: 'refunded' };
  }
  return { shouldUpdate: true, payment_status: 'partially_refunded', escrow_status: 'held' };
};

// ---------------------------------------------------------------------------
// processRefund guard (duplicate API path while worker holds pending)
// ---------------------------------------------------------------------------

export const shouldSkipProcessRefundForPendingDuplicate = ({ refundStatus, paymentActionExecution }) =>
  refundStatus === 'pending' && !paymentActionExecution;

// ---------------------------------------------------------------------------
// Idempotency key shapes (Stripe + internal replay)
// ---------------------------------------------------------------------------

/** Persisted per `payment_actions` row for Stripe refund idempotency. */
export const buildPaymentActionRefundIdempotencyKey = ({ bookingId, paymentActionId }) =>
  `refund_${bookingId}_${paymentActionId}`;

/** Fallback when caller did not pass an explicit idempotency key (processRefund). */
export const buildProcessRefundFallbackIdempotencyKey = ({ paymentId, refundCents, stripeChargeId }) =>
  `refund-payment-${paymentId}-${refundCents}-${stripeChargeId}`;

// ---------------------------------------------------------------------------
// payment_actions reconciliation / worker typing
// ---------------------------------------------------------------------------

/** Full remaining balance is snapped from Stripe in worker before refund. */
export const HYDRATE_FULL_REMAINING_REFUND_ACTION_TYPES = Object.freeze(['dispute_refund_full']);

/** Refund cents fixed at enqueue time (not full snap). */
export const FIXED_CENTS_REFUND_ACTION_TYPES = Object.freeze([
  'dispute_refund_partial',
  'booking_cancel_refund',
  'booking_coach_no_show_refund',
  'booking_admin_refund',
]);

export const hydrateFullRemainingActionTypeSet = new Set(HYDRATE_FULL_REMAINING_REFUND_ACTION_TYPES);
export const fixedCentsRefundActionTypeSet = new Set(FIXED_CENTS_REFUND_ACTION_TYPES);

export const isHydrateFullRemainingRefundAction = (actionType) =>
  hydrateFullRemainingActionTypeSet.has(actionType);

export const isFixedCentsRefundAction = (actionType) => fixedCentsRefundActionTypeSet.has(actionType);

/** payment_actions row is terminal success (no further Stripe execution expected). */
export const isPaymentActionRefundSucceeded = (status, stripeRefundId) =>
  status === 'succeeded' && Boolean(stripeRefundId);

/** payment_actions row should not be sent to Stripe without cents + idempotency key. */
export const isPaymentActionRefundExecutionBlocked = (status, refundCents) =>
  (status === 'pending' || status === 'failed') && (refundCents == null || refundCents < 1);

/** After max failures, worker stops retrying. */
export const isPaymentActionRefundPermanentlyFailed = (attempts, maxAttempts) =>
  Number(attempts) >= Number(maxAttempts);
