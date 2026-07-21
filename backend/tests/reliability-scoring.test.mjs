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
import { roundReliabilityScoreValue } from '../services/reliabilityEngine.js';

const baseCoachMetrics = (overrides = {}) => ({
  total_bookings: 10,
  _booking_baseline: 10,
  late_cancels: 0,
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
    const raw = 100 - (1 / denom) * COACH_ATTENDANCE_NO_SHOW_WEIGHT;
    assert.equal(withShow, roundReliabilityScoreValue(raw));
  });

  it('coach: behavior penalties use BEHAVIOR_DISPUTE_PENALTY_WEIGHTS', () => {
    const denom = 10 + RELIABILITY_SMOOTHING_K;
    const score = calculateCoachReliabilityScore(
      baseCoachMetrics({ misconduct_penalties: 1 }),
    );
    const raw = 100 - (1 / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.misconduct;
    assert.equal(score, roundReliabilityScoreValue(raw));
  });

  it('student: no_shows use STUDENT_ATTENDANCE_NO_SHOW_WEIGHT', () => {
    const m = {
      total_bookings: 8,
      _booking_baseline: 8,
      late_cancels: 0,
      misconduct_penalties: 0,
      lesson_not_completed_penalties: 0,
      no_shows: 2,
      student_cancels: 0,
      _decayed: {},
    };
    const denom = 8 + RELIABILITY_SMOOTHING_K;
    const score = calculateStudentReliabilityScore(m);
    const raw = 100 - (2 / denom) * STUDENT_ATTENDANCE_NO_SHOW_WEIGHT;
    assert.equal(score, roundReliabilityScoreValue(raw));
  });

  it('student: lesson_not_completed penalties use behavior weight', () => {
    const denom = 10 + RELIABILITY_SMOOTHING_K;
    const score = calculateStudentReliabilityScore({
      total_bookings: 10,
      _booking_baseline: 10,
      late_cancels: 0,
      misconduct_penalties: 0,
      lesson_not_completed_penalties: 1,
      no_shows: 0,
      student_cancels: 0,
      _decayed: {},
    });
    const raw = 100 - (1 / denom) * BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.lesson_not_completed;
    assert.equal(score, roundReliabilityScoreValue(raw));
  });
});
