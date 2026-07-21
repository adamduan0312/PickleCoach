/**
 * Guards for `POST /api/disputes` — disputes are post-lesson case records.
 * Resolve paths validate attendance transitions separately per dispute type.
 */

/** Statuses where a dispute may be opened without a lesson-end time check. */
export const DISPUTE_CREATE_ALLOWED_BOOKING_STATUSES = [
  'awaiting_verification',
  'completed',
  'student_no_show',
  'coach_no_show',
  'disputed',
];

/**
 * @param {{ scheduled_at: Date | string, duration_minutes?: number | null }} booking
 * @param {Date} [now]
 */
export function lessonHasEnded(booking, now = new Date()) {
  const lessonEndMs =
    new Date(booking.scheduled_at).getTime() + (booking.duration_minutes || 0) * 60 * 1000;
  return now.getTime() >= lessonEndMs;
}

/**
 * @param {{ status?: string, scheduled_at?: Date | string, duration_minutes?: number | null } | null | undefined} booking
 * @param {Date} [now]
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function checkDisputeCreateBookingEligibility(booking, now = new Date()) {
  const status = booking?.status;
  if (!status) {
    return {
      ok: false,
      code: 'dispute_create_booking_status_not_allowed',
      message: 'Booking status is not eligible for dispute creation.',
    };
  }

  if (DISPUTE_CREATE_ALLOWED_BOOKING_STATUSES.includes(status)) {
    return { ok: true };
  }

  if (status === 'confirmed' && lessonHasEnded(booking, now)) {
    return { ok: true };
  }

  if (status === 'pending') {
    return {
      ok: false,
      code: 'dispute_create_pre_lesson_booking',
      message:
        'Disputes can only be opened after the lesson has ended. Cancel or resolve scheduling issues through pre-lesson workflows.',
    };
  }

  if (status === 'confirmed') {
    return {
      ok: false,
      code: 'dispute_create_lesson_not_ended',
      message:
        'Disputes can only be opened after the lesson end time. Wait until the lesson has finished.',
    };
  }

  if (status === 'cancelled') {
    return {
      ok: false,
      code: 'dispute_create_cancelled_booking',
      message: 'Disputes cannot be opened on cancelled bookings.',
    };
  }

  return {
    ok: false,
    code: 'dispute_create_booking_status_not_allowed',
    message: `Booking status "${status}" is not eligible for dispute creation.`,
  };
}
