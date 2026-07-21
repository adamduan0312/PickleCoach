/**
 * Single source of truth for reliability scoring, denominators, and penalty breakdowns.
 *
 * Recent vs decayed:
 * - "Recent" = full unit weight (1) for events inside the rolling scoring window.
 * - "Decayed" = fractional weight exp(-lambda * ageDays) for events before the window start.
 * - "Total" = recent + decayed (exactly what the score formula divides by the denominator).
 *
 * Denominator: max(1, booking_baseline_total + smoothing_k).
 * booking_baseline_total = booking_baseline_recent + booking_baseline_decayed (sum of booking weights).
 *
 * Reconstructibility: when score_source === 'computed', reliability_score must equal
 * calculateReliabilityScoreFromPersistenceRow(row) for the same role.
 */

import {
  RELIABILITY_WINDOW_DAYS,
  RELIABILITY_DECAY_LAMBDA,
  RELIABILITY_SMOOTHING_K,
  BEHAVIOR_DISPUTE_PENALTY_WEIGHTS,
  COACH_ATTENDANCE_NO_SHOW_WEIGHT,
  STUDENT_ATTENDANCE_NO_SHOW_WEIGHT,
  SCORE_FORMULA_VERSION,
  RELIABILITY_METRIC_DECIMAL_PLACES,
} from './reliabilityConstants.js';

const clampScore = (n) => Math.max(0, Math.min(100, n));

const METRIC_ROUND_SCALE = 10 ** RELIABILITY_METRIC_DECIMAL_PLACES;

/** Fixed-precision fractional metrics (decayed weights, totals, baseline decay) — stable across DB round-trip. */
export const roundReliabilityMetric = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * METRIC_ROUND_SCALE) / METRIC_ROUND_SCALE;
};

/** Integer-ish counters (recent-window unit counts). */
export const intReliabilityCount = (v) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? x : 0;
};

const num = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

/** Stored and API reliability_score (2 dp, matches DECIMAL(5,2)). */
export const roundReliabilityScoreValue = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return 100;
  return Math.round(clampScore(x) * 100) / 100;
};

/**
 * Raw split aggregates from DB queries (before totals / score).
 * @typedef {object} RawReliabilitySplits
 * @property {number} booking_baseline_recent
 * @property {number} booking_baseline_decayed
 * @property {number} late_cancels_recent
 * @property {number} late_cancels_decayed
 * @property {number} coach_cancels_non_late_recent
 * @property {number} coach_cancels_non_late_decayed
 * @property {number} student_cancels_non_late_recent
 * @property {number} student_cancels_non_late_decayed
 * @property {number} no_shows_recent
 * @property {number} no_shows_decayed
 * @property {number} misconduct_penalties_recent
 * @property {number} misconduct_penalties_decayed
 * @property {number} lesson_not_completed_penalties_recent
 * @property {number} lesson_not_completed_penalties_decayed
 */

/**
 * @param {RawReliabilitySplits} raw
 * @param {{ windowDays?: number, decayLambda?: number, smoothingK?: number }} [config]
 */
export const buildCanonicalReliabilityMetrics = (raw, config = {}) => {
  const windowDays = config.windowDays ?? RELIABILITY_WINDOW_DAYS;
  const decayLambda = config.decayLambda ?? RELIABILITY_DECAY_LAMBDA;
  const smoothingK = roundReliabilityMetric(config.smoothingK ?? RELIABILITY_SMOOTHING_K);

  const booking_baseline_recent = intReliabilityCount(raw.booking_baseline_recent);
  const booking_baseline_decayed = roundReliabilityMetric(raw.booking_baseline_decayed);
  const booking_baseline_total = roundReliabilityMetric(booking_baseline_recent + booking_baseline_decayed);

  const pairTotal = (rKey, dKey) =>
    roundReliabilityMetric(intReliabilityCount(raw[rKey]) + roundReliabilityMetric(raw[dKey]));

  return {
    booking_baseline_recent,
    booking_baseline_decayed,
    booking_baseline_total,
    total_bookings_recent: booking_baseline_recent,

    late_cancels_recent: intReliabilityCount(raw.late_cancels_recent),
    late_cancels_decayed: roundReliabilityMetric(raw.late_cancels_decayed),
    late_cancels_total: pairTotal('late_cancels_recent', 'late_cancels_decayed'),

    coach_cancels_non_late_recent: intReliabilityCount(raw.coach_cancels_non_late_recent),
    coach_cancels_non_late_decayed: roundReliabilityMetric(raw.coach_cancels_non_late_decayed),
    coach_cancels_non_late_total: pairTotal('coach_cancels_non_late_recent', 'coach_cancels_non_late_decayed'),

    student_cancels_non_late_recent: intReliabilityCount(raw.student_cancels_non_late_recent),
    student_cancels_non_late_decayed: roundReliabilityMetric(raw.student_cancels_non_late_decayed),
    student_cancels_non_late_total: pairTotal('student_cancels_non_late_recent', 'student_cancels_non_late_decayed'),

    no_shows_recent: intReliabilityCount(raw.no_shows_recent),
    no_shows_decayed: roundReliabilityMetric(raw.no_shows_decayed),
    no_shows_total: pairTotal('no_shows_recent', 'no_shows_decayed'),

    misconduct_penalties_recent: intReliabilityCount(raw.misconduct_penalties_recent),
    misconduct_penalties_decayed: roundReliabilityMetric(raw.misconduct_penalties_decayed),
    misconduct_penalties_total: pairTotal('misconduct_penalties_recent', 'misconduct_penalties_decayed'),

    lesson_not_completed_penalties_recent: intReliabilityCount(raw.lesson_not_completed_penalties_recent),
    lesson_not_completed_penalties_decayed: roundReliabilityMetric(raw.lesson_not_completed_penalties_decayed),
    lesson_not_completed_penalties_total: pairTotal(
      'lesson_not_completed_penalties_recent',
      'lesson_not_completed_penalties_decayed',
    ),

    scoring_window_days: windowDays,
    decay_lambda: roundReliabilityMetric(decayLambda),
    smoothing_k: smoothingK,
  };
};

/**
 * @param {ReturnType<typeof buildCanonicalReliabilityMetrics>} canonical
 */
export const calculateReliabilityDenominator = (canonical) =>
  Math.max(1, num(canonical.booking_baseline_total) + num(canonical.smoothing_k));

/**
 * @param {'coach'|'student'} role
 * @param {ReturnType<typeof buildCanonicalReliabilityMetrics>} canonical
 */
export const calculatePenaltyBreakdown = (role, canonical) => {
  const d = calculateReliabilityDenominator(canonical);
  const ratio = (total, weight) => (num(total) / d) * weight;

  if (role === 'coach') {
    const deductions = {
      late_cancels: ratio(canonical.late_cancels_total, 20),
      no_shows: ratio(canonical.no_shows_total, COACH_ATTENDANCE_NO_SHOW_WEIGHT),
      coach_cancels_non_late: ratio(canonical.coach_cancels_non_late_total, 10),
      misconduct_penalties: ratio(canonical.misconduct_penalties_total, BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.misconduct),
      lesson_not_completed_penalties: ratio(
        canonical.lesson_not_completed_penalties_total,
        BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.lesson_not_completed,
      ),
    };
    const totalDeduction = Object.values(deductions).reduce((a, b) => a + b, 0);
    return { role, denominator: d, deductions, total_deduction: totalDeduction, raw_score: 100 - totalDeduction };
  }

  const deductions = {
    late_cancels: ratio(canonical.late_cancels_total, 15),
    no_shows: ratio(canonical.no_shows_total, STUDENT_ATTENDANCE_NO_SHOW_WEIGHT),
    student_cancels_non_late: ratio(canonical.student_cancels_non_late_total, 12),
    misconduct_penalties: ratio(canonical.misconduct_penalties_total, BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.misconduct),
    lesson_not_completed_penalties: ratio(
      canonical.lesson_not_completed_penalties_total,
      BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.lesson_not_completed,
    ),
  };
  const totalDeduction = Object.values(deductions).reduce((a, b) => a + b, 0);
  return { role, denominator: d, deductions, total_deduction: totalDeduction, raw_score: 100 - totalDeduction };
};

/**
 * @param {'coach'|'student'} role
 * @param {ReturnType<typeof buildCanonicalReliabilityMetrics>} canonical
 */
export const calculateReliabilityScoreFromCanonical = (role, canonical) => {
  if (
    num(canonical.booking_baseline_total) === 0 &&
    num(canonical.total_bookings_recent) === 0
  ) {
    return 100.0;
  }
  const { raw_score } = calculatePenaltyBreakdown(role, canonical);
  return roundReliabilityScoreValue(raw_score);
};

/**
 * Map a persisted Sequelize row (plain object) to canonical metrics for scoring.
 * @param {'coach'|'student'} role
 * @param {object} row
 */
export const persistenceRowToCanonical = (role, row) =>
  buildCanonicalReliabilityMetrics(
    {
      booking_baseline_recent: intReliabilityCount(row.booking_baseline_recent),
      booking_baseline_decayed: row.booking_baseline_decayed,
      late_cancels_recent: intReliabilityCount(row.late_cancels_recent),
      late_cancels_decayed: row.late_cancels_decayed,
      coach_cancels_non_late_recent: intReliabilityCount(row.coach_cancels_non_late_recent),
      coach_cancels_non_late_decayed: row.coach_cancels_non_late_decayed,
      student_cancels_non_late_recent: intReliabilityCount(row.student_cancels_non_late_recent),
      student_cancels_non_late_decayed: row.student_cancels_non_late_decayed,
      no_shows_recent: intReliabilityCount(row.no_shows_recent),
      no_shows_decayed: row.no_shows_decayed,
      misconduct_penalties_recent: intReliabilityCount(row.misconduct_penalties_recent),
      misconduct_penalties_decayed: row.misconduct_penalties_decayed,
      lesson_not_completed_penalties_recent: intReliabilityCount(row.lesson_not_completed_penalties_recent),
      lesson_not_completed_penalties_decayed: row.lesson_not_completed_penalties_decayed,
    },
    {
      windowDays: row.scoring_window_days,
      decayLambda: row.decay_lambda != null ? Number(row.decay_lambda) : undefined,
      smoothingK: row.smoothing_k != null ? Number(row.smoothing_k) : undefined,
    },
  );

/**
 * Recompute score from persisted columns only (no booking queries).
 * @param {'coach'|'student'} role
 * @param {object} row
 */
export const calculateReliabilityScoreFromPersistenceRow = (role, row) => {
  const canonical = persistenceRowToCanonical(role, row);
  return calculateReliabilityScoreFromCanonical(role, canonical);
};

/**
 * Flat object for Sequelize create/update (snake_case DB columns).
 * @param {'coach'|'student'} role
 * @param {ReturnType<typeof buildCanonicalReliabilityMetrics>} canonical
 * @param {number} score
 * @param {{ scoreVersion?: number, scoreSource?: string, lastRecomputedAt?: Date }} meta
 */
export const flattenCanonicalForPersistence = (role, canonical, score, meta = {}) => {
  const now =
    meta.lastRecomputedAt === undefined ? new Date() : meta.lastRecomputedAt;
  const rs = roundReliabilityScoreValue(score);
  return {
    role,
    booking_baseline_recent: canonical.booking_baseline_recent,
    booking_baseline_decayed: roundReliabilityMetric(canonical.booking_baseline_decayed),
    booking_baseline_total: roundReliabilityMetric(canonical.booking_baseline_total),
    total_bookings_recent: canonical.total_bookings_recent,

    late_cancels_recent: canonical.late_cancels_recent,
    late_cancels_decayed: roundReliabilityMetric(canonical.late_cancels_decayed),
    late_cancels_total: roundReliabilityMetric(canonical.late_cancels_total),

    coach_cancels_non_late_recent: canonical.coach_cancels_non_late_recent,
    coach_cancels_non_late_decayed: roundReliabilityMetric(canonical.coach_cancels_non_late_decayed),
    coach_cancels_non_late_total: roundReliabilityMetric(canonical.coach_cancels_non_late_total),

    student_cancels_non_late_recent: canonical.student_cancels_non_late_recent,
    student_cancels_non_late_decayed: roundReliabilityMetric(canonical.student_cancels_non_late_decayed),
    student_cancels_non_late_total: roundReliabilityMetric(canonical.student_cancels_non_late_total),

    no_shows_recent: canonical.no_shows_recent,
    no_shows_decayed: roundReliabilityMetric(canonical.no_shows_decayed),
    no_shows_total: roundReliabilityMetric(canonical.no_shows_total),

    misconduct_penalties_recent: canonical.misconduct_penalties_recent,
    misconduct_penalties_decayed: roundReliabilityMetric(canonical.misconduct_penalties_decayed),
    misconduct_penalties_total: roundReliabilityMetric(canonical.misconduct_penalties_total),

    lesson_not_completed_penalties_recent: canonical.lesson_not_completed_penalties_recent,
    lesson_not_completed_penalties_decayed: roundReliabilityMetric(canonical.lesson_not_completed_penalties_decayed),
    lesson_not_completed_penalties_total: roundReliabilityMetric(canonical.lesson_not_completed_penalties_total),

    smoothing_k: roundReliabilityMetric(canonical.smoothing_k),
    decay_lambda: roundReliabilityMetric(canonical.decay_lambda),
    scoring_window_days: canonical.scoring_window_days,
    last_recomputed_at: now,
    score_version: meta.scoreVersion ?? SCORE_FORMULA_VERSION,
    reliability_score: rs,
    score_source: meta.scoreSource ?? 'computed',
  };
};

/** Empty persisted shape (defaults) for API responses before any row exists. */
export const defaultCanonicalReliabilityRow = (userId, role) => {
  const raw = {
    booking_baseline_recent: 0,
    booking_baseline_decayed: 0,
    late_cancels_recent: 0,
    late_cancels_decayed: 0,
    coach_cancels_non_late_recent: 0,
    coach_cancels_non_late_decayed: 0,
    student_cancels_non_late_recent: 0,
    student_cancels_non_late_decayed: 0,
    no_shows_recent: 0,
    no_shows_decayed: 0,
    misconduct_penalties_recent: 0,
    misconduct_penalties_decayed: 0,
    lesson_not_completed_penalties_recent: 0,
    lesson_not_completed_penalties_decayed: 0,
  };
  const canonical = buildCanonicalReliabilityMetrics(raw);
  const flat = flattenCanonicalForPersistence(role, canonical, 100.0, {
    scoreSource: 'computed',
    lastRecomputedAt: null,
    scoreVersion: SCORE_FORMULA_VERSION,
  });
  return {
    user_id: userId,
    role,
    ...flat,
    badges: null,
    last_updated: null,
    created_at: null,
    id: null,
  };
};

/** API backward compatibility: legacy flat names expected by older clients. */
export const attachLegacyReliabilityAliases = (row) => {
  if (!row || typeof row !== 'object') return row;
  const legacyCoachCancels =
    row.role === 'student'
      ? row.student_cancels_non_late_recent
      : row.coach_cancels_non_late_recent;
  return {
    ...row,
    total_bookings: row.total_bookings_recent,
    late_cancels: row.late_cancels_recent,
    misconduct_penalties: row.misconduct_penalties_recent,
    lesson_not_completed_penalties: row.lesson_not_completed_penalties_recent,
    no_shows: row.no_shows_recent,
    coach_cancels: legacyCoachCancels,
    student_cancels_non_late: row.student_cancels_non_late_recent,
  };
};

/** Alias: persisted row fields are produced by this same function in `updateUserReliability`. */
export const persistReliabilityMetrics = flattenCanonicalForPersistence;
