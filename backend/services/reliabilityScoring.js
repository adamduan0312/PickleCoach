/**
 * Pure reliability scoring (no DB). Attendance penalties use booking-status metrics only;
 * behavior penalties use sustained dispute rollup fields.
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

export const metricTotalWithDecay = (metrics, key) =>
  (Number(metrics?.[key]) || 0) + (Number(metrics?._decayed?.[key]) || 0);

export const reliabilityDenominator = (metrics) =>
  Math.max(
    1,
    (Number(metrics?._booking_baseline) || Number(metrics?.total_bookings) || 0) + RELIABILITY_SMOOTHING_K,
  );

/**
 * @param {object} metrics — aggregation output from reliabilityService (coach)
 */
export const calculateCoachReliabilityScore = (metrics) => {
  const total_bookings = Number(metrics.total_bookings) || 0;
  if (total_bookings === 0 && (Number(metrics._booking_baseline) || 0) === 0) return 100.0;

  let score = 100.0;
  const denom = reliabilityDenominator(metrics);
  const penalized_reschedules = metricTotalWithDecay(metrics, 'reschedules');
  const late_cancels = metricTotalWithDecay(metrics, 'late_cancels');
  const late_arrival_penalties = metricTotalWithDecay(metrics, 'late_arrival_penalties');
  const no_shows = metricTotalWithDecay(metrics, 'no_shows');
  const misconduct_penalties = metricTotalWithDecay(metrics, 'misconduct_penalties');
  const lesson_not_completed_penalties = metricTotalWithDecay(metrics, 'lesson_not_completed_penalties');
  const coach_cancels_non_late = metricTotalWithDecay(metrics, 'coach_cancels');

  score -= (penalized_reschedules / denom) * 5;
  score -= (late_cancels / denom) * 20;
  score -= (late_arrival_penalties / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.late_arrival;
  score -= (no_shows / denom) * COACH_ATTENDANCE_NO_SHOW_WEIGHT;
  score -= (coach_cancels_non_late / denom) * 10;
  score -= (misconduct_penalties / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.misconduct;
  score -= (lesson_not_completed_penalties / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.lesson_not_completed;

  return Math.max(0, Math.min(100, score));
};

/**
 * @param {object} metrics — aggregation output from reliabilityService (student)
 */
export const calculateStudentReliabilityScore = (metrics) => {
  const total_bookings = Number(metrics.total_bookings) || 0;
  if (total_bookings === 0 && (Number(metrics._booking_baseline) || 0) === 0) return 100.0;

  let score = 100.0;
  const denom = reliabilityDenominator(metrics);
  const reschedules = metricTotalWithDecay(metrics, 'reschedules');
  const late_cancels = metricTotalWithDecay(metrics, 'late_cancels');
  const late_arrival_penalties = metricTotalWithDecay(metrics, 'late_arrival_penalties');
  const no_shows = metricTotalWithDecay(metrics, 'no_shows');
  const student_cancels = metricTotalWithDecay(metrics, 'student_cancels');
  const misconduct_penalties = metricTotalWithDecay(metrics, 'misconduct_penalties');
  const lesson_not_completed_penalties = metricTotalWithDecay(metrics, 'lesson_not_completed_penalties');

  score -= (reschedules / denom) * 8;
  score -= (late_cancels / denom) * 15;
  score -= (late_arrival_penalties / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.late_arrival;
  score -= (no_shows / denom) * STUDENT_ATTENDANCE_NO_SHOW_WEIGHT;
  score -= (student_cancels / denom) * 12;
  score -= (misconduct_penalties / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.misconduct;
  score -= (lesson_not_completed_penalties / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.lesson_not_completed;

  return Math.max(0, Math.min(100, score));
};
