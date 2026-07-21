/**
 * Authorization + pre-create validation for POST /api/reviews.
 * Based on booking participation (primary_student_id), not account roles.
 */

/**
 * @param {{ userId: number, booking: { primary_student_id?: number | null, coach_id: number, status: string } | null, hasExistingReview: boolean }} p
 * @returns {{ ok: true, targetUserId: number } | { ok: false, statusCode: number, message: string, code?: string }}
 */
export function validateReviewCreateAuthorization({ userId, booking, hasExistingReview }) {
  if (!booking) {
    return { ok: false, statusCode: 404, message: 'Booking not found' };
  }

  if (userId !== booking.primary_student_id) {
    return {
      ok: false,
      statusCode: 403,
      message: 'Only the student who booked can leave a review',
    };
  }

  if (booking.status !== 'completed') {
    return {
      ok: false,
      statusCode: 400,
      message: 'Can only review completed bookings',
    };
  }

  if (hasExistingReview) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Review already exists for this booking',
    };
  }

  const targetUserId = booking.coach_id;

  if (userId === targetUserId) {
    return {
      ok: false,
      statusCode: 400,
      message: 'You cannot review yourself.',
      code: 'cannot_review_self',
    };
  }

  return { ok: true, targetUserId };
}
