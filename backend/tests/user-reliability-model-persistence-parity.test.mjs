/**
 * Static parity: columns written by `flattenCanonicalForPersistence` must exist on the Sequelize model.
 * Catches schema drift between migrations/models and the reliability engine without a live DB.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import UserReliability from '../models/UserReliability.js';
import {
  buildCanonicalReliabilityMetrics,
  flattenCanonicalForPersistence,
} from '../services/reliabilityEngine.js';
import { SCORE_FORMULA_VERSION } from '../services/reliabilityConstants.js';

describe('UserReliability model vs persistence flatten', () => {
  it('every flattenCanonicalForPersistence key maps to a UserReliability attribute', () => {
    const canonical = buildCanonicalReliabilityMetrics({
      booking_baseline_recent: 1,
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
    });
    const flatCoach = flattenCanonicalForPersistence('coach', canonical, 99.12, {
      scoreVersion: SCORE_FORMULA_VERSION,
    });
    for (const key of Object.keys(flatCoach)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(UserReliability.rawAttributes, key),
        `flatten key "${key}" missing from UserReliability model`,
      );
    }

    const flatStudent = flattenCanonicalForPersistence('student', canonical, 88.5, {
      scoreVersion: SCORE_FORMULA_VERSION,
    });
    for (const key of Object.keys(flatStudent)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(UserReliability.rawAttributes, key),
        `flatten key "${key}" (student) missing from UserReliability model`,
      );
    }
  });
});
