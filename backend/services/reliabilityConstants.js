/**
 * Environment-tunable reliability scoring constants (shared by engine + legacy adapters).
 */

const parseEnvInt = (key, defaultValue) => {
  const raw = process.env[key];
  if (raw == null || raw === '') return defaultValue;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
};

const parseEnvFloat = (key, defaultValue) => {
  const raw = process.env[key];
  if (raw == null || raw === '') return defaultValue;
  const n = Number.parseFloat(String(raw));
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
};

export const RELIABILITY_WINDOW_DAYS = parseEnvInt('RELIABILITY_WINDOW_DAYS', 90);
export const RELIABILITY_DECAY_LAMBDA = parseEnvFloat('RELIABILITY_DECAY_LAMBDA', 0.03);
export const RELIABILITY_SMOOTHING_K = parseEnvFloat('RELIABILITY_SMOOTHING_K', 5);

/**
 * Bump when penalty weights, decay model, smoothing, or window semantics change.
 * Persisted on each `user_reliability` row so historical rows stay interpretable.
 */
export const SCORE_FORMULA_VERSION = 3;

/** Decimal places for persisted fractional metrics (decayed weights, totals, baseline decay). */
export const RELIABILITY_METRIC_DECIMAL_PLACES = 6;

export const getReliabilityConfig = () => ({
  windowDays: RELIABILITY_WINDOW_DAYS,
  decayLambda: RELIABILITY_DECAY_LAMBDA,
  smoothingK: RELIABILITY_SMOOTHING_K,
});

/** Weights for behavior types only (sustained disputes: late_arrival, misconduct, lesson_not_completed). */
export const BEHAVIOR_DISPUTE_PENALTY_WEIGHTS = {
  late_arrival: 5,
  lesson_not_completed: 10,
  misconduct: 25,
};

/** Attendance no-show via `bookings.status` only (coach_no_show / student_no_show). */
export const COACH_ATTENDANCE_NO_SHOW_WEIGHT = 35;
export const STUDENT_ATTENDANCE_NO_SHOW_WEIGHT = 12;

/**
 * Immutable snapshot of active formula inputs (for audits / future JSON persistence).
 * Does not include per-user metrics.
 */
export const getScoringFormulaSnapshot = () => ({
  score_formula_version: SCORE_FORMULA_VERSION,
  window_days: RELIABILITY_WINDOW_DAYS,
  decay_lambda: RELIABILITY_DECAY_LAMBDA,
  smoothing_k: RELIABILITY_SMOOTHING_K,
  behavior_dispute_penalty_weights: { ...BEHAVIOR_DISPUTE_PENALTY_WEIGHTS },
  coach_attendance_no_show_weight: COACH_ATTENDANCE_NO_SHOW_WEIGHT,
  student_attendance_no_show_weight: STUDENT_ATTENDANCE_NO_SHOW_WEIGHT,
});
