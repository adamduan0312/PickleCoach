/**
 * Reliability engine: canonical metrics, scoring, admin breakdown parity, reconstructibility.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCanonicalReliabilityMetrics,
  calculatePenaltyBreakdown,
  calculateReliabilityDenominator,
  calculateReliabilityScoreFromCanonical,
  calculateReliabilityScoreFromPersistenceRow,
  defaultCanonicalReliabilityRow,
  flattenCanonicalForPersistence,
  persistenceRowToCanonical,
  roundReliabilityScoreValue,
} from '../services/reliabilityEngine.js';
import { RELIABILITY_SMOOTHING_K, SCORE_FORMULA_VERSION } from '../services/reliabilityConstants.js';

const coachRow = (overrides = {}) => {
  const canonical = buildCanonicalReliabilityMetrics({
    booking_baseline_recent: 10,
    booking_baseline_decayed: 2.5,
    penalized_reschedules_recent: 1,
    penalized_reschedules_decayed: 0.5,
    late_cancels_recent: 0,
    late_cancels_decayed: 0,
    coach_cancels_non_late_recent: 2,
    coach_cancels_non_late_decayed: 0,
    student_cancels_non_late_recent: 0,
    student_cancels_non_late_decayed: 0,
    no_shows_recent: 0,
    no_shows_decayed: 0,
    late_arrival_penalties_recent: 0,
    late_arrival_penalties_decayed: 0,
    misconduct_penalties_recent: 0,
    misconduct_penalties_decayed: 0,
    lesson_not_completed_penalties_recent: 0,
    lesson_not_completed_penalties_decayed: 0,
    paid_reschedules: 0,
  });
  const score = calculateReliabilityScoreFromCanonical('coach', canonical);
  const base = flattenCanonicalForPersistence(
    'coach',
    canonical,
    score,
    { scoreSource: 'computed', lastRecomputedAt: new Date('2026-01-15T12:00:00Z') },
  );
  return {
    user_id: 1,
    role: 'coach',
    ...base,
    ...overrides,
  };
};

const studentRow = (overrides = {}) => {
  const canonical = buildCanonicalReliabilityMetrics({
    booking_baseline_recent: 8,
    booking_baseline_decayed: 0,
    penalized_reschedules_recent: 0,
    penalized_reschedules_decayed: 0,
    late_cancels_recent: 0,
    late_cancels_decayed: 0,
    coach_cancels_non_late_recent: 0,
    coach_cancels_non_late_decayed: 0,
    student_cancels_non_late_recent: 3,
    student_cancels_non_late_decayed: 0.25,
    no_shows_recent: 0,
    no_shows_decayed: 0,
    late_arrival_penalties_recent: 0,
    late_arrival_penalties_decayed: 0,
    misconduct_penalties_recent: 0,
    misconduct_penalties_decayed: 0,
    lesson_not_completed_penalties_recent: 0,
    lesson_not_completed_penalties_decayed: 0,
    paid_reschedules: 0,
  });
  const score = calculateReliabilityScoreFromCanonical('student', canonical);
  const base = flattenCanonicalForPersistence(
    'student',
    canonical,
    score,
    { scoreSource: 'computed', lastRecomputedAt: new Date('2026-01-15T12:00:00Z') },
  );
  return {
    user_id: 2,
    role: 'student',
    ...base,
    ...overrides,
  };
};

describe('reliabilityEngine', () => {
  it('denominator uses booking_baseline_total + smoothing_k', () => {
    const c = buildCanonicalReliabilityMetrics({
      booking_baseline_recent: 4,
      booking_baseline_decayed: 1,
      penalized_reschedules_recent: 0,
      penalized_reschedules_decayed: 0,
      late_cancels_recent: 0,
      late_cancels_decayed: 0,
      coach_cancels_non_late_recent: 0,
      coach_cancels_non_late_decayed: 0,
      student_cancels_non_late_recent: 0,
      student_cancels_non_late_decayed: 0,
      no_shows_recent: 0,
      no_shows_decayed: 0,
      late_arrival_penalties_recent: 0,
      late_arrival_penalties_decayed: 0,
      misconduct_penalties_recent: 0,
      misconduct_penalties_decayed: 0,
      lesson_not_completed_penalties_recent: 0,
      lesson_not_completed_penalties_decayed: 0,
      paid_reschedules: 0,
    });
    const d = calculateReliabilityDenominator(c);
    assert.equal(d, 5 + RELIABILITY_SMOOTHING_K);
  });

  it('persisted totals match scoring inputs (coach)', () => {
    const row = coachRow();
    const c = persistenceRowToCanonical('coach', row);
    assert.equal(c.penalized_reschedules_total, 1.5);
    assert.equal(c.booking_baseline_total, 12.5);
    const score = calculateReliabilityScoreFromPersistenceRow('coach', row);
    const score2 = calculateReliabilityScoreFromCanonical('coach', c);
    assert.equal(score, score2);
  });

  it('student non-late cancels use student_* columns only', () => {
    const row = studentRow();
    const c = persistenceRowToCanonical('student', row);
    assert.equal(c.student_cancels_non_late_total, 3.25);
    assert.equal(c.coach_cancels_non_late_total, 0);
    const b = calculatePenaltyBreakdown('student', c);
    assert.ok(b.deductions.student_cancels_non_late > 0);
  });

  it('admin breakdown deductions sum to 100 - reconstructed score', () => {
    const row = coachRow();
    const c = persistenceRowToCanonical('coach', row);
    const breakdown = calculatePenaltyBreakdown('coach', c);
    const reconstructed = calculateReliabilityScoreFromCanonical('coach', c);
    const expected = roundReliabilityScoreValue(breakdown.raw_score);
    assert.equal(reconstructed, expected);
  });

  it('default canonical row reconstructs to 100', () => {
    const row = defaultCanonicalReliabilityRow(99, 'student');
    const s = calculateReliabilityScoreFromPersistenceRow('student', row);
    assert.equal(s, 100);
  });

  it('flatten then reconstruct matches score passed in', () => {
    const raw = {
      booking_baseline_recent: 10,
      booking_baseline_decayed: 0,
      penalized_reschedules_recent: 2,
      penalized_reschedules_decayed: 0,
      late_cancels_recent: 0,
      late_cancels_decayed: 0,
      coach_cancels_non_late_recent: 0,
      coach_cancels_non_late_decayed: 0,
      student_cancels_non_late_recent: 0,
      student_cancels_non_late_decayed: 0,
      no_shows_recent: 0,
      no_shows_decayed: 0,
      late_arrival_penalties_recent: 0,
      late_arrival_penalties_decayed: 0,
      misconduct_penalties_recent: 0,
      misconduct_penalties_decayed: 0,
      lesson_not_completed_penalties_recent: 0,
      lesson_not_completed_penalties_decayed: 0,
      paid_reschedules: 0,
    };
    const canonical = buildCanonicalReliabilityMetrics(raw);
    const score = calculateReliabilityScoreFromCanonical('coach', canonical);
    const flat = flattenCanonicalForPersistence('coach', canonical, score, { scoreSource: 'computed' });
    const again = calculateReliabilityScoreFromPersistenceRow('coach', flat);
    assert.equal(again, score);
  });

  it('idempotent: buildCanonical twice yields identical object', () => {
    const raw = {
      booking_baseline_recent: 3,
      booking_baseline_decayed: 0.123456789,
      penalized_reschedules_recent: 0,
      penalized_reschedules_decayed: 0.987654321,
      late_cancels_recent: 0,
      late_cancels_decayed: 0,
      coach_cancels_non_late_recent: 0,
      coach_cancels_non_late_decayed: 0,
      student_cancels_non_late_recent: 0,
      student_cancels_non_late_decayed: 0,
      no_shows_recent: 0,
      no_shows_decayed: 0,
      late_arrival_penalties_recent: 0,
      late_arrival_penalties_decayed: 0,
      misconduct_penalties_recent: 0,
      misconduct_penalties_decayed: 0,
      lesson_not_completed_penalties_recent: 0,
      lesson_not_completed_penalties_decayed: 0,
      paid_reschedules: 0,
    };
    const a = buildCanonicalReliabilityMetrics(raw);
    const b = buildCanonicalReliabilityMetrics(raw);
    assert.deepEqual(a, b);
  });

  it('full invariant: canonical → score → persist → MySQL-like strings → reconstruct', () => {
    const raw = {
      booking_baseline_recent: 12,
      booking_baseline_decayed: 1.234567,
      penalized_reschedules_recent: 1,
      penalized_reschedules_decayed: 0.2,
      late_cancels_recent: 0,
      late_cancels_decayed: 0,
      coach_cancels_non_late_recent: 0,
      coach_cancels_non_late_decayed: 0,
      student_cancels_non_late_recent: 0,
      student_cancels_non_late_decayed: 0,
      no_shows_recent: 1,
      no_shows_decayed: 0,
      late_arrival_penalties_recent: 0,
      late_arrival_penalties_decayed: 0,
      misconduct_penalties_recent: 0,
      misconduct_penalties_decayed: 0,
      lesson_not_completed_penalties_recent: 0,
      lesson_not_completed_penalties_decayed: 0,
      paid_reschedules: 0,
    };
    const canonical = buildCanonicalReliabilityMetrics(raw);
    const score = calculateReliabilityScoreFromCanonical('coach', canonical);
    const flat = flattenCanonicalForPersistence('coach', canonical, score, {
      scoreSource: 'computed',
      lastRecomputedAt: new Date('2026-06-01T00:00:00Z'),
    });
    assert.equal(flat.score_version, SCORE_FORMULA_VERSION);

    const dbLike = { ...flat, role: 'coach' };
    for (const k of Object.keys(dbLike)) {
      const v = dbLike[k];
      if (
        typeof v === 'number' &&
        !Number.isInteger(v) &&
        (k.endsWith('_decayed') ||
          k.endsWith('_total') ||
          k === 'booking_baseline_decayed' ||
          k === 'booking_baseline_total' ||
          k === 'smoothing_k' ||
          k === 'decay_lambda' ||
          k === 'reliability_score')
      ) {
        dbLike[k] = String(v);
      }
    }

    const score2 = calculateReliabilityScoreFromPersistenceRow('coach', dbLike);
    assert.equal(score2, score);
    const c2 = persistenceRowToCanonical('coach', dbLike);
    const score3 = calculateReliabilityScoreFromCanonical('coach', c2);
    assert.equal(score3, score);
  });
});
