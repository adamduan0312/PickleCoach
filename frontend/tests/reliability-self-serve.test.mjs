import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatSelfReliabilityPercent,
  reliabilityActivityRows,
  reliabilityAffectsCopy,
  reliabilityBasedOnSummary,
  reliabilityImproveCopy,
  reliabilityVisibilityCopy,
  PUBLIC_COACH_RELIABILITY_HINT,
  RELIABILITY_BASED_ON_SUMMARY,
  RELIABILITY_AFFECTS_COPY,
} from '../src/domain/reliabilitySelfServe.js';
import { formatReliabilityHint } from '../src/utils/format.js';

describe('reliabilitySelfServe', () => {
  it('formats percent for display', () => {
    assert.equal(formatSelfReliabilityPercent(96), '96%');
    assert.equal(formatSelfReliabilityPercent(88.5), '88.5%');
    assert.equal(formatSelfReliabilityPercent(null), null);
  });

  it('student activity keeps bookings and drops zero-only penalty rows', () => {
    const rows = reliabilityActivityRows({
      total_bookings: 12,
      late_cancels: 1,
      no_shows: 0,
      misconduct_penalties: 0,
      lesson_not_completed_penalties: 0,
      coach_cancels: 0,
      student_cancels_non_late: 2,
    }, 'student');
    assert.deepEqual(rows.map((r) => r.key), [
      'total_bookings',
      'late_cancels',
      'student_cancels_non_late',
    ]);
    assert.equal(rows[0].label, 'Recent booking activity');
    assert.match(rows[0].detail, /last 90 days/i);
    assert.match(rows[0].detail, /completed, cancelled, and no-show/i);
  });

  it('coach activity uses coach cancel counters and shows non-zero events', () => {
    const rows = reliabilityActivityRows({
      total_bookings: 20,
      late_cancels: 2,
      no_shows: 1,
      misconduct_penalties: 0,
      lesson_not_completed_penalties: 0,
      coach_cancels: 3,
      student_cancels_non_late: 9,
    }, 'coach');
    assert.deepEqual(rows.map((r) => r.key), [
      'total_bookings',
      'late_cancels',
      'coach_cancels',
      'no_shows',
    ]);
  });

  it('education copy is identical for student and coach', () => {
    assert.equal(reliabilityBasedOnSummary('student'), RELIABILITY_BASED_ON_SUMMARY);
    assert.equal(reliabilityBasedOnSummary('coach'), RELIABILITY_BASED_ON_SUMMARY);
    assert.equal(reliabilityAffectsCopy('student'), RELIABILITY_AFFECTS_COPY);
    assert.equal(reliabilityAffectsCopy('coach'), RELIABILITY_AFFECTS_COPY);
    assert.equal(
      reliabilityImproveCopy(),
      'Complete your lessons as scheduled and avoid late cancellations and no-shows. Clean completed lessons help your score recover.',
    );
  });

  it('only visibility copy differs by role', () => {
    assert.match(reliabilityVisibilityCopy('student'), /Coaches don’t see it/i);
    assert.match(reliabilityVisibilityCopy('coach'), /Students can see your reliability/i);
  });

  it('public marketplace hint stays concise and matches format helper', () => {
    assert.equal(formatReliabilityHint(), PUBLIC_COACH_RELIABILITY_HINT);
    assert.match(formatReliabilityHint(), /attendance/i);
  });
});
