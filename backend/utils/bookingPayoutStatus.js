/**
 * Orthogonal `bookings.payout_status` machine (not `bookings.status`).
 *
 *   pending → processing → paid
 *
 * - pending: payout owed/eligible; payoutWorker has not sent it yet
 * - processing: Stripe Connect transfer initiated; waiting for confirmation
 * - paid: Stripe confirmed the transfer (or zero-amount path with nothing to send)
 * - forfeited: reserved for a future “coach gets $0” mark (e.g. coach no-show).
 *   Live runtime does not assign it; those bookings stay `none`. Never overwrite if set.
 * - none / awaiting_verification: pre-eligible labels (`none` is the live default)
 */

export const TERMINAL_BOOKING_PAYOUT_STATUSES = Object.freeze(['paid', 'forfeited']);

/**
 * After a successful `releaseEscrow` call.
 * If escrow is already released (zero-amount, or webhook won the race), skip
 * to `paid`. Otherwise the transfer is in flight → `processing`.
 * Never overwrite `paid` or `forfeited`.
 *
 * @param {{ currentPayoutStatus?: string | null, escrowStatus?: string | null }} [args]
 * @returns {string}
 */
export function nextBookingPayoutStatusAfterReleaseEscrow({
  currentPayoutStatus,
  escrowStatus,
} = {}) {
  const current = String(currentPayoutStatus || '');
  if (TERMINAL_BOOKING_PAYOUT_STATUSES.includes(current)) return current;
  if (String(escrowStatus || '') === 'released') return 'paid';
  return 'processing';
}

/**
 * Stripe `transfer.created` / `transfer.paid` confirmed, or zero-amount payout
 * with no transfer. Advances to `paid` unless the booking is `forfeited`.
 *
 * @param {string | null | undefined} currentPayoutStatus
 * @returns {string}
 */
export function nextBookingPayoutStatusAfterTransferConfirmed(currentPayoutStatus) {
  const current = String(currentPayoutStatus || '');
  if (current === 'forfeited') return current;
  return 'paid';
}
