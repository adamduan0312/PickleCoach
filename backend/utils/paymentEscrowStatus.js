/**
 * `payments.escrow_status` — captured-money hold, not Stripe authorization.
 *
 *   pending  = authorized (or capture initiated); no captured funds held yet
 *   held     = Stripe capture succeeded; PickleCoach is holding the charge
 *   pending_release / released / refunded / disputed / manual_payout_required
 *            = post-capture outcomes (unchanged)
 */

export const ESCROW_PENDING = 'pending';
export const ESCROW_HELD = 'held';
export const ESCROW_RELEASED = 'released';

/** Authorized / uncaptured PaymentIntent — not an escrow hold. */
export function escrowForUncapturedAuthorization() {
  return ESCROW_PENDING;
}

/** Capture succeeded (or capture API returned succeeded). */
export function escrowAfterSuccessfulCapture() {
  return ESCROW_HELD;
}

/**
 * Pre-capture void (decline / early cancel / expire / payment_intent.canceled).
 * Never captured, so must not remain `held`.
 */
export function escrowAfterUncapturedVoid() {
  return ESCROW_RELEASED;
}
