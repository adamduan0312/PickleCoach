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

/** Platform fee as percent of lesson price (student pays lesson + this fee). */
export const PLATFORM_FEE_PERCENT = 8.0;

/** Coach share of lesson price only (not of total charge); platform keeps fee + absorbs Stripe in MVP). */
export const COACH_COMMISSION_PERCENT = 92.0;

/** Stripe minimum charge (USD) for a PaymentIntent. */
export const MIN_CHARGE_USD = 0.5;
