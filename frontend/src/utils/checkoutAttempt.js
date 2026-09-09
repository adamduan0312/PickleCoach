/**
 * Checkout booking-attempt helpers.
 *
 * Stripe PaymentIntent creation must be scoped to a **booking attempt**, not only
 * student+lesson+time+court. Same attempt → stable key (refresh / double-submit).
 * New intentional checkout (decline → pick same slot again) → new attempt id.
 */

const ATTEMPT_PARAM = 'attempt';

/**
 * @param {URLSearchParams} params
 * @returns {string | null}
 */
export function getCheckoutAttemptId(params) {
  const raw = params?.get?.(ATTEMPT_PARAM);
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.length >= 8 ? trimmed : null;
}

/**
 * Ensure checkout URL carries a stable attempt id for this page session.
 * @param {URLSearchParams} params
 * @param {() => string} [createId]
 * @returns {{ attemptId: string, params: URLSearchParams, created: boolean }}
 */
export function ensureCheckoutAttemptParams(params, createId = () => crypto.randomUUID()) {
  const existing = getCheckoutAttemptId(params);
  if (existing) {
    return { attemptId: existing, params, created: false };
  }
  const attemptId = createId();
  const next = new URLSearchParams(params);
  next.set(ATTEMPT_PARAM, attemptId);
  return { attemptId, params: next, created: true };
}
