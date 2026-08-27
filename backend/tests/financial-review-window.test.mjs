import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FINANCIAL_REVIEW_WINDOW_MS,
  POST_LESSON_WINDOW_GATED_REFUND_ACTION_TYPES,
  bookingStatusUsesPostLessonPayoutClock,
  getFinancialReviewUntil,
  getLessonEndAt,
  isPostLessonFinancialReviewElapsed,
  isPostLessonFinancialReviewOpen,
  isPostLessonWindowGatedRefundAction,
  serializeFinancialReview,
  shouldHoldPostLessonWindowGatedRefund,
} from '../utils/financialReviewWindow.js';

const lessonStart = new Date('2026-08-18T18:00:00.000Z');
const booking = { scheduled_at: lessonStart, duration_minutes: 60 };
const lessonEnd = new Date('2026-08-18T19:00:00.000Z');
const reviewUntil = new Date(lessonEnd.getTime() + FINANCIAL_REVIEW_WINDOW_MS);

describe('financialReviewWindow', () => {
  it('lesson end is scheduled_at + duration', () => {
    assert.equal(getLessonEndAt(booking).toISOString(), lessonEnd.toISOString());
  });

  it('review_until is 24h after lesson end, not button-click time', () => {
    assert.equal(getFinancialReviewUntil(booking).toISOString(), reviewUntil.toISOString());
    assert.equal(FINANCIAL_REVIEW_WINDOW_MS, 24 * 60 * 60 * 1000);
  });

  it('window is open only between lesson end and review_until', () => {
    assert.equal(isPostLessonFinancialReviewOpen(booking, new Date('2026-08-18T18:30:00.000Z')), false);
    assert.equal(isPostLessonFinancialReviewOpen(booking, lessonEnd), true);
    assert.equal(isPostLessonFinancialReviewOpen(booking, new Date('2026-08-19T18:00:00.000Z')), true);
    assert.equal(isPostLessonFinancialReviewOpen(booking, reviewUntil), false);
  });

  it('elapsed is true at and after review_until', () => {
    assert.equal(isPostLessonFinancialReviewElapsed(booking, new Date('2026-08-19T18:59:59.000Z')), false);
    assert.equal(isPostLessonFinancialReviewElapsed(booking, reviewUntil), true);
    assert.equal(isPostLessonFinancialReviewElapsed(booking, new Date('2026-08-20T19:00:00.000Z')), true);
  });

  it('at the exact 24h boundary, dispute window is closed and payout clock is open (no overlap, no gap after lesson end)', () => {
    const justBefore = new Date(reviewUntil.getTime() - 1);
    assert.equal(isPostLessonFinancialReviewOpen(booking, justBefore), true);
    assert.equal(isPostLessonFinancialReviewElapsed(booking, justBefore), false);

    assert.equal(isPostLessonFinancialReviewOpen(booking, reviewUntil), false);
    assert.equal(isPostLessonFinancialReviewElapsed(booking, reviewUntil), true);

    const duringLesson = new Date('2026-08-18T18:30:00.000Z');
    assert.equal(isPostLessonFinancialReviewOpen(booking, duringLesson), false);
    assert.equal(isPostLessonFinancialReviewElapsed(booking, duringLesson), false);
  });

  it('23:59:59 vs 24:00:00 after lesson end partitions every automatic settlement gate', () => {
    const at235959 = new Date('2026-08-19T18:59:59.000Z');
    const at240000 = new Date('2026-08-19T19:00:00.000Z');

    assert.equal(isPostLessonFinancialReviewOpen(booking, at235959), true);
    assert.equal(isPostLessonFinancialReviewElapsed(booking, at235959), false);
    assert.equal(shouldHoldPostLessonWindowGatedRefund(booking, 'booking_admin_refund', at235959), true);
    assert.equal(shouldHoldPostLessonWindowGatedRefund(booking, 'booking_coach_no_show_refund', at235959), true);

    assert.equal(isPostLessonFinancialReviewOpen(booking, at240000), false);
    assert.equal(isPostLessonFinancialReviewElapsed(booking, at240000), true);
    assert.equal(shouldHoldPostLessonWindowGatedRefund(booking, 'booking_admin_refund', at240000), false);
    assert.equal(shouldHoldPostLessonWindowGatedRefund(booking, 'booking_coach_no_show_refund', at240000), false);

    assert.equal(shouldHoldPostLessonWindowGatedRefund(booking, 'dispute_refund_full', at235959), false);
    assert.equal(shouldHoldPostLessonWindowGatedRefund(booking, 'booking_cancel_refund', at235959), false);
  });

  it('gates automatic/admin post-lesson refunds, not cancel or dispute-resolve refunds', () => {
    assert.deepEqual(
      [...POST_LESSON_WINDOW_GATED_REFUND_ACTION_TYPES],
      ['booking_coach_no_show_refund', 'booking_admin_refund'],
    );
    assert.equal(isPostLessonWindowGatedRefundAction('booking_cancel_refund'), false);
    assert.equal(isPostLessonWindowGatedRefundAction('dispute_refund_full'), false);
    assert.equal(isPostLessonWindowGatedRefundAction('dispute_refund_partial'), false);

    const duringWindow = new Date('2026-08-18T20:00:00.000Z');
    const afterWindow = reviewUntil;
    assert.equal(
      shouldHoldPostLessonWindowGatedRefund(booking, 'booking_admin_refund', duringWindow),
      true,
    );
    assert.equal(
      shouldHoldPostLessonWindowGatedRefund(booking, 'booking_coach_no_show_refund', duringWindow),
      true,
    );
    assert.equal(
      shouldHoldPostLessonWindowGatedRefund(booking, 'booking_admin_refund', afterWindow),
      false,
    );
    assert.equal(
      shouldHoldPostLessonWindowGatedRefund(booking, 'dispute_refund_full', duringWindow),
      false,
    );
    assert.equal(
      shouldHoldPostLessonWindowGatedRefund(booking, 'booking_cancel_refund', duringWindow),
      false,
    );
    const beforeLesson = new Date('2026-08-18T18:30:00.000Z');
    assert.equal(
      shouldHoldPostLessonWindowGatedRefund(booking, 'booking_admin_refund', beforeLesson),
      false,
    );
  });

  it('completed and student_no_show use the payout clock; cancelled does not', () => {
    assert.equal(bookingStatusUsesPostLessonPayoutClock('completed'), true);
    assert.equal(bookingStatusUsesPostLessonPayoutClock('student_no_show'), true);
    assert.equal(bookingStatusUsesPostLessonPayoutClock('cancelled'), false);
    assert.equal(bookingStatusUsesPostLessonPayoutClock('coach_no_show'), false);
    assert.equal(bookingStatusUsesPostLessonPayoutClock('awaiting_verification'), false);
  });

  it('serializeFinancialReview exposes ISO timestamps', () => {
    const dto = serializeFinancialReview(booking, new Date('2026-08-18T20:00:00.000Z'));
    assert.equal(dto.lesson_ended_at, lessonEnd.toISOString());
    assert.equal(dto.review_until, reviewUntil.toISOString());
    assert.equal(dto.window_open, true);
  });

  it('missing scheduled_at is not elapsed (fail closed)', () => {
    assert.equal(isPostLessonFinancialReviewElapsed({}, new Date()), false);
    assert.equal(serializeFinancialReview({}), null);
    assert.equal(shouldHoldPostLessonWindowGatedRefund({}, 'booking_admin_refund'), true);
  });
});
