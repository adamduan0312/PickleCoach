/**
 * Environment-tunable payment constants (shared by paymentEngine + paymentService).
 * Financial formulas live in `paymentEngine.js` only.
 */

const parseEnvFloat = (key, defaultValue) => {
  const raw = process.env[key];
  if (raw == null || raw === '') return defaultValue;
  const n = Number.parseFloat(String(raw));
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
};

/**
 * Platform commission as percent of lesson price (internal accounting only).
 * Student pays the listed lesson price; platform retains this share before coach payout.
 * Platform absorbs Stripe processing fees from its commission (MVP).
 */
export const PLATFORM_FEE_PERCENT = 8.0;

/** Coach share of lesson price (student pays listed lesson; coach gets this % of lesson). */
export const COACH_COMMISSION_PERCENT = 92.0;

/** Stripe minimum charge (USD) for a PaymentIntent. */
export const MIN_CHARGE_USD = 0.5;
