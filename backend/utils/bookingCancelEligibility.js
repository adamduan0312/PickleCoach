/**
 * Pre-lesson cancel eligibility and post-lesson cancel rejection copy/codes.
 */

export const LESSON_STARTED_CANCEL_BLOCKED_CODE = 'lesson_started_cancellation_unavailable';

export const LESSON_STARTED_CANCEL_BLOCKED_MESSAGE =
  'Lesson has already started. Cancellation is no longer available. Use completion, attendance (no-show), or dispute workflows as appropriate.';

export const POST_LESSON_CANCEL_BLOCKED_CODE = 'booking_in_post_lesson_phase';

export const POST_LESSON_CANCEL_BLOCKED_MESSAGE =
  'This booking is in the post-lesson verification phase. Cancellation is no longer available. Use completion, attendance (no-show), or dispute workflows instead.';

/**
 * @param {Date | string | number} scheduledAt
 * @param {Date} [now]
 */
export function isPreLessonCancelAllowed(scheduledAt, now = new Date()) {
  return new Date(scheduledAt).getTime() > now.getTime();
}

/**
 * @param {Date | string | number} scheduledAt
 * @param {Date} [now]
 */
export function assertPreLessonCancelAllowed(scheduledAt, now = new Date()) {
  if (isPreLessonCancelAllowed(scheduledAt, now)) return;
  const err = new Error(LESSON_STARTED_CANCEL_BLOCKED_MESSAGE);
  err.statusCode = 400;
  err.code = LESSON_STARTED_CANCEL_BLOCKED_CODE;
  throw err;
}

/**
 * @param {string} bookingStatus
 */
export function assertBookingStatusAllowsPreLessonCancel(bookingStatus) {
  if (bookingStatus === 'awaiting_verification') {
    const err = new Error(POST_LESSON_CANCEL_BLOCKED_MESSAGE);
    err.statusCode = 400;
    err.code = POST_LESSON_CANCEL_BLOCKED_CODE;
    err.booking_status = bookingStatus;
    throw err;
  }
}
