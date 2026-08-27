/**
 * Post-lesson financial review window.
 *
 * Attendance buttons (Complete, no-show) do not move money. Automatic post-lesson
 * settlement (coach payout, coach-no-show refund, admin refund) waits until
 * lesson end + 24 hours. Any open dispute continues to block those paths.
 *
 * After the window closes with no open dispute, the booking is normally
 * financially final. Exceptional post-settlement corrections may require
 * manual Stripe operations (this module does not claw back Connect transfers).
 *
 * Exceptions (not gated by this clock):
 * - Pre-lesson cancel/void/capture
 * - Late-cancel retained coach payout (pre-lesson)
 * - Admin dispute *resolve* refunds (adjudication after someone reported an issue)
 * - Stripe card chargebacks (external)
 */

export const FINANCIAL_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Booking statuses whose coach payout uses the post-lesson review clock. Late-cancel `cancelled` does not. */
export const POST_LESSON_PAYOUT_CLOCK_STATUSES = Object.freeze(['completed', 'student_no_show']);

/**
 * Automatic / admin-override refunds that must not execute until the post-lesson
 * window elapses (and must not execute while a dispute is open).
 * Cancel refunds are pre-lesson. Dispute-resolve refunds are explicit adjudication.
 */
export const POST_LESSON_WINDOW_GATED_REFUND_ACTION_TYPES = Object.freeze([
  'booking_coach_no_show_refund',
  'booking_admin_refund',
]);

/**
 * @param {{ scheduled_at?: Date | string, duration_minutes?: number | null } | null | undefined} booking
 * @returns {Date | null}
 */
export function getLessonEndAt(booking) {
  if (!booking?.scheduled_at) return null;
  const start = new Date(booking.scheduled_at);
  if (Number.isNaN(start.getTime())) return null;
  const durationMin = Number(booking.duration_minutes) || 0;
  return new Date(start.getTime() + durationMin * 60 * 1000);
}

/**
 * @param {{ scheduled_at?: Date | string, duration_minutes?: number | null } | null | undefined} booking
 * @returns {Date | null}
 */
export function getFinancialReviewUntil(booking) {
  const lessonEnd = getLessonEndAt(booking);
  if (!lessonEnd) return null;
  return new Date(lessonEnd.getTime() + FINANCIAL_REVIEW_WINDOW_MS);
}

/** True when lesson end + 24h has passed (payout/auto-refund clock may run). */
export function isPostLessonFinancialReviewElapsed(booking, now = new Date()) {
  const until = getFinancialReviewUntil(booking);
  if (!until) return false;
  return now.getTime() >= until.getTime();
}

/** True from lesson end until (not including) review_until. */
export function isPostLessonFinancialReviewOpen(booking, now = new Date()) {
  const lessonEnd = getLessonEndAt(booking);
  const until = getFinancialReviewUntil(booking);
  if (!lessonEnd || !until) return false;
  const t = now.getTime();
  return t >= lessonEnd.getTime() && t < until.getTime();
}

export function bookingStatusUsesPostLessonPayoutClock(status) {
  return POST_LESSON_PAYOUT_CLOCK_STATUSES.includes(status);
}

export function isPostLessonWindowGatedRefundAction(actionType) {
  return POST_LESSON_WINDOW_GATED_REFUND_ACTION_TYPES.includes(actionType);
}

/**
 * Hold gated refund types after the lesson until review_until.
 * Pre-lesson (now < lesson end): do not hold — cancel/admin pre-lesson refunds stay available.
 * Missing schedule on a gated type: fail closed (hold).
 */
export function shouldHoldPostLessonWindowGatedRefund(booking, actionType, now = new Date()) {
  if (!isPostLessonWindowGatedRefundAction(actionType)) return false;
  const lessonEnd = getLessonEndAt(booking);
  if (!lessonEnd) return true;
  if (now.getTime() < lessonEnd.getTime()) return false;
  return !isPostLessonFinancialReviewElapsed(booking, now);
}

/**
 * API DTO fragment for bookings. Clock is computed; not stored.
 * @returns {{ lesson_ended_at: string, review_until: string, window_open: boolean } | null}
 */
export function serializeFinancialReview(booking, now = new Date()) {
  const lessonEndedAt = getLessonEndAt(booking);
  const reviewUntil = getFinancialReviewUntil(booking);
  if (!lessonEndedAt || !reviewUntil) return null;
  return {
    lesson_ended_at: lessonEndedAt.toISOString(),
    review_until: reviewUntil.toISOString(),
    window_open: isPostLessonFinancialReviewOpen(booking, now),
  };
}
