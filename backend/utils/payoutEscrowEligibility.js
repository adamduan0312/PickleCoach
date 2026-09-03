/**
 * Payout eligibility gate on escrow state — the single source of truth for
 * "is this payment's money releasable to the coach".
 *
 * IMPORTANT: booking.status alone NEVER means a payment is payable. A booking
 * can be `completed` while payout is still `pending` / `processing`, or blocked
 * by dispute / failed Connect transfer. Do not show "Coach paid" from attendance status.
 *
 * `failed + released` (pre-capture void) is never payable — payoutWorker also
 * requires `captured` / `partially_refunded`.
 */

/** Only `held` escrow is releasable; every other state is parked money. */
export const PAYOUT_ELIGIBLE_ESCROW_STATUS = 'held';

/**
 * After this many failed Connect transfer attempts for one payment, park escrow
 * at `manual_payout_required` so the worker stops creating payout rows every tick.
 */
export const MAX_FAILED_CONNECT_PAYOUT_ATTEMPTS = 5;

/**
 * @param {{ escrow_status?: string | null } | null | undefined} payment
 * @returns {boolean}
 */
export function isPaymentEscrowPayable(payment) {
  return payment?.escrow_status === PAYOUT_ELIGIBLE_ESCROW_STATUS;
}

/**
 * @param {number} failedPayoutCount
 * @returns {boolean}
 */
export function shouldParkPayoutAfterFailedAttempts(failedPayoutCount) {
  const n = Number(failedPayoutCount);
  return Number.isFinite(n) && n >= MAX_FAILED_CONNECT_PAYOUT_ATTEMPTS;
}
