/**
 * Reliability scoring — re-exports constants and legacy metric-shape adapters.
 *
 * New code should prefer `reliabilityEngine.js` + persisted canonical rows.
 */

export {
  RELIABILITY_WINDOW_DAYS,
  RELIABILITY_DECAY_LAMBDA,
  RELIABILITY_SMOOTHING_K,
  RELIABILITY_METRIC_DECIMAL_PLACES,
  SCORE_FORMULA_VERSION,
  getReliabilityConfig,
  getScoringFormulaSnapshot,
  BEHAVIOR_DISPUTE_PENALTY_WEIGHTS,
  COACH_ATTENDANCE_NO_SHOW_WEIGHT,
  STUDENT_ATTENDANCE_NO_SHOW_WEIGHT,
} from './reliabilityConstants.js';

import {
  buildCanonicalReliabilityMetrics,
  calculateReliabilityDenominator,
  calculateReliabilityScoreFromCanonical,
} from './reliabilityEngine.js';

/** @deprecated Prefer canonical metrics; used by tests and transitional callers. */
export const metricTotalWithDecay = (metrics, key) =>
  (Number(metrics?.[key]) || 0) + (Number(metrics?._decayed?.[key]) || 0);

/** @deprecated Prefer calculateReliabilityDenominator(buildCanonicalReliabilityMetrics(...)). */
export const reliabilityDenominator = (metrics) =>
  calculateReliabilityDenominator(
    buildCanonicalReliabilityMetrics({
      booking_baseline_recent: Number(metrics?.total_bookings) || 0,
      booking_baseline_decayed:
        Math.max(0, (Number(metrics?._booking_baseline) || 0) - (Number(metrics?.total_bookings) || 0)),
      late_cancels_recent: Number(metrics?.late_cancels) || 0,
      late_cancels_decayed: Number(metrics?._decayed?.late_cancels) || 0,
      coach_cancels_non_late_recent: Number(metrics?.coach_cancels) || 0,
      coach_cancels_non_late_decayed: Number(metrics?._decayed?.coach_cancels) || 0,
      student_cancels_non_late_recent: Number(metrics?.student_cancels) || 0,
      student_cancels_non_late_decayed: Number(metrics?._decayed?.student_cancels) || 0,
      no_shows_recent: Number(metrics?.no_shows) || 0,
      no_shows_decayed: Number(metrics?._decayed?.no_shows) || 0,
      late_arrival_penalties_recent: Number(metrics?.late_arrival_penalties) || 0,
      late_arrival_penalties_decayed: Number(metrics?._decayed?.late_arrival_penalties) || 0,
      misconduct_penalties_recent: Number(metrics?.misconduct_penalties) || 0,
      misconduct_penalties_decayed: Number(metrics?._decayed?.misconduct_penalties) || 0,
      lesson_not_completed_penalties_recent: Number(metrics?.lesson_not_completed_penalties) || 0,
      lesson_not_completed_penalties_decayed:
        Number(metrics?._decayed?.lesson_not_completed_penalties) || 0,
    }),
  );

/**
 * Legacy coach aggregate shape from reliabilityService aggregation.
 * @deprecated Prefer reliabilityEngine.calculateReliabilityScoreFromCanonical('coach', canonical).
 */
export const calculateCoachReliabilityScore = (metrics) => {
  const total_bookings = Number(metrics.total_bookings) || 0;
  if (total_bookings === 0 && (Number(metrics._booking_baseline) || 0) === 0) return 100.0;

  const canonical = buildCanonicalReliabilityMetrics({
    booking_baseline_recent: total_bookings,
    booking_baseline_decayed: Math.max(
      0,
      (Number(metrics._booking_baseline) || 0) - total_bookings,
    ),
    late_cancels_recent: Number(metrics.late_cancels) || 0,
    late_cancels_decayed: Number(metrics._decayed?.late_cancels) || 0,
    coach_cancels_non_late_recent: Number(metrics.coach_cancels) || 0,
    coach_cancels_non_late_decayed: Number(metrics._decayed?.coach_cancels) || 0,
    student_cancels_non_late_recent: 0,
    student_cancels_non_late_decayed: 0,
    no_shows_recent: Number(metrics.no_shows) || 0,
    no_shows_decayed: Number(metrics._decayed?.no_shows) || 0,
    late_arrival_penalties_recent: Number(metrics.late_arrival_penalties) || 0,
    late_arrival_penalties_decayed: Number(metrics._decayed?.late_arrival_penalties) || 0,
    misconduct_penalties_recent: Number(metrics.misconduct_penalties) || 0,
    misconduct_penalties_decayed: Number(metrics._decayed?.misconduct_penalties) || 0,
    lesson_not_completed_penalties_recent: Number(metrics.lesson_not_completed_penalties) || 0,
    lesson_not_completed_penalties_decayed:
      Number(metrics._decayed?.lesson_not_completed_penalties) || 0,
  });
  return calculateReliabilityScoreFromCanonical('coach', canonical);
};

/**
 * Legacy student aggregate shape from reliabilityService aggregation.
 * @deprecated Prefer reliabilityEngine.calculateReliabilityScoreFromCanonical('student', canonical).
 */
export const calculateStudentReliabilityScore = (metrics) => {
  const total_bookings = Number(metrics.total_bookings) || 0;
  if (total_bookings === 0 && (Number(metrics._booking_baseline) || 0) === 0) return 100.0;

  const canonical = buildCanonicalReliabilityMetrics({
    booking_baseline_recent: total_bookings,
    booking_baseline_decayed: Math.max(
      0,
      (Number(metrics._booking_baseline) || 0) - total_bookings,
    ),
    late_cancels_recent: Number(metrics.late_cancels) || 0,
    late_cancels_decayed: Number(metrics._decayed?.late_cancels) || 0,
    coach_cancels_non_late_recent: 0,
    coach_cancels_non_late_decayed: 0,
    student_cancels_non_late_recent: Number(metrics.student_cancels) || 0,
    student_cancels_non_late_decayed: Number(metrics._decayed?.student_cancels) || 0,
    no_shows_recent: Number(metrics.no_shows) || 0,
    no_shows_decayed: Number(metrics._decayed?.no_shows) || 0,
    late_arrival_penalties_recent: Number(metrics.late_arrival_penalties) || 0,
    late_arrival_penalties_decayed: Number(metrics._decayed?.late_arrival_penalties) || 0,
    misconduct_penalties_recent: Number(metrics.misconduct_penalties) || 0,
    misconduct_penalties_decayed: Number(metrics._decayed?.misconduct_penalties) || 0,
    lesson_not_completed_penalties_recent: Number(metrics.lesson_not_completed_penalties) || 0,
    lesson_not_completed_penalties_decayed:
      Number(metrics._decayed?.lesson_not_completed_penalties) || 0,
  });
  return calculateReliabilityScoreFromCanonical('student', canonical);
};
