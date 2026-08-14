/**
 * Payout eligibility gate on escrow state — the single source of truth for
 * "is this payment's money releasable to the coach".
 *
 * IMPORTANT: booking.status alone NEVER means a payment is payable. A booking
 * can be `completed` while its payment sits in `escrow_status = 'disputed'`
 * until Stripe terminal reconciliation (`STRIPE_DISPUTE_TERMINAL`) or admin
 * paths reconcile escrow. The payout worker gates on escrow_status, not booking status.
 */

/** Only `held` escrow is releasable; every other state is parked money.
 * `failed + released` (pre-capture void) is never payable — payoutWorker also
 * requires `captured` / `partially_refunded`. */
export const PAYOUT_ELIGIBLE_ESCROW_STATUS = 'held';

/**
 * @param {{ escrow_status?: string | null } | null | undefined} payment
 * @returns {boolean}
 */
export function isPaymentEscrowPayable(payment) {
  return payment?.escrow_status === PAYOUT_ELIGIBLE_ESCROW_STATUS;
}
