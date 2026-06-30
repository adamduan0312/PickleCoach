/**
 * Pre-lesson cancel window (pure) — cancel blocked once lesson start time arrives.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  assertPreLessonCancelAllowed,
  assertBookingStatusAllowsPreLessonCancel,
  isPreLessonCancelAllowed,
  LESSON_STARTED_CANCEL_BLOCKED_CODE,
  POST_LESSON_CANCEL_BLOCKED_CODE,
} from '../utils/bookingCancelEligibility.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('isPreLessonCancelAllowed', () => {
  const start = new Date('2026-06-20T19:00:00.000Z');

  it('allows cancel before lesson start', () => {
    assert.equal(isPreLessonCancelAllowed(start, new Date('2026-06-20T18:55:00.000Z')), true);
    assert.equal(isPreLessonCancelAllowed(start, new Date('2026-06-19T19:00:00.000Z')), true);
  });

  it('blocks cancel at or after lesson start', () => {
    assert.equal(isPreLessonCancelAllowed(start, new Date('2026-06-20T19:00:00.000Z')), false);
    assert.equal(isPreLessonCancelAllowed(start, new Date('2026-06-20T19:05:00.000Z')), false);
  });
});

describe('assertPreLessonCancelAllowed', () => {
  it('throws with stable code when lesson has started', () => {
    const start = new Date('2026-06-20T19:00:00.000Z');
    assert.throws(
      () => assertPreLessonCancelAllowed(start, new Date('2026-06-20T19:00:00.000Z')),
      (err) => err.code === LESSON_STARTED_CANCEL_BLOCKED_CODE && err.statusCode === 400,
    );
  });
});

describe('assertBookingStatusAllowsPreLessonCancel', () => {
  it('throws booking_in_post_lesson_phase for awaiting_verification', () => {
    assert.throws(
      () => assertBookingStatusAllowsPreLessonCancel('awaiting_verification'),
      (err) =>
        err.code === POST_LESSON_CANCEL_BLOCKED_CODE &&
        err.statusCode === 400 &&
        err.booking_status === 'awaiting_verification',
    );
  });
});

describe('cancelBooking wiring', () => {
  it('uses assertPreLessonCancelAllowed inside cancel transaction', () => {
    const src = readFileSync(
      join(__dirname, '../controllers/bookingController.js'),
      'utf8',
    );
    assert.match(src, /assertPreLessonCancelAllowed\(booking\.scheduled_at/);
    assert.match(src, /assertBookingStatusAllowsPreLessonCancel/);
    assert.doesNotMatch(src, /awaiting_verification_use_dispute/);
  });
});
