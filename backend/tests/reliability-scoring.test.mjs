/**
 * Pure scoring tests (no DB). Run: npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateCoachReliabilityScore,
  calculateStudentReliabilityScore,
  BEHAVIOR_DISPUTE_PENALTY_WEIGHTS,
  COACH_ATTENDANCE_NO_SHOW_WEIGHT,
  STUDENT_ATTENDANCE_NO_SHOW_WEIGHT,
  RELIABILITY_SMOOTHING_K,
} from '../services/reliabilityScoring.js';

const baseCoachMetrics = (overrides = {}) => ({
  total_bookings: 10,
  _booking_baseline: 10,
  reschedules: 0,
  late_cancels: 0,
  late_arrival_penalties: 0,
  misconduct_penalties: 0,
  lesson_not_completed_penalties: 0,
  no_shows: 0,
  coach_cancels: 0,
  _decayed: {},
  ...overrides,
});

describe('reliability scoring (pure)', () => {
  it('coach: no_shows affects score; no separate attendance dispute metrics', () => {
    const denom = 10 + RELIABILITY_SMOOTHING_K;
    const withShow = calculateCoachReliabilityScore(baseCoachMetrics({ no_shows: 1 }));
    const expected = 100 - (1 / denom) * COACH_ATTENDANCE_NO_SHOW_WEIGHT;
    assert.equal(withShow, Math.max(0, Math.min(100, expected)));
  });

  it('coach: behavior penalties use BEHAVIOR_DISPUTE_PENALTY_WEIGHTS', () => {
    const denom = 10 + RELIABILITY_SMOOTHING_K;
    const score = calculateCoachReliabilityScore(
      baseCoachMetrics({ misconduct_penalties: 1 }),
    );
    const expected = 100 - (1 / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.misconduct;
    assert.equal(score, Math.max(0, Math.min(100, expected)));
  });

  it('student: no_shows use STUDENT_ATTENDANCE_NO_SHOW_WEIGHT', () => {
    const m = {
      total_bookings: 8,
      _booking_baseline: 8,
      reschedules: 0,
      late_cancels: 0,
      late_arrival_penalties: 0,
      misconduct_penalties: 0,
      lesson_not_completed_penalties: 0,
      no_shows: 2,
      student_cancels: 0,
      _decayed: {},
    };
    const denom = 8 + RELIABILITY_SMOOTHING_K;
    const score = calculateStudentReliabilityScore(m);
    const expected = 100 - (2 / denom) * STUDENT_ATTENDANCE_NO_SHOW_WEIGHT;
    assert.equal(score, Math.max(0, Math.min(100, expected)));
  });

  it('student: late_arrival_penalties use behavior late_arrival weight', () => {
    const m = {
      total_bookings: 10,
      _booking_baseline: 10,
      reschedules: 0,
      late_cancels: 0,
      late_arrival_penalties: 1,
      misconduct_penalties: 0,
      lesson_not_completed_penalties: 0,
      no_shows: 0,
      student_cancels: 0,
      _decayed: {},
    };
    const denom = 10 + RELIABILITY_SMOOTHING_K;
    const score = calculateStudentReliabilityScore(m);
    const expected = 100 - (1 / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.late_arrival;
    assert.equal(score, Math.max(0, Math.min(100, expected)));
  });
});
