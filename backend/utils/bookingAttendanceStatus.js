/**
 * Single place for attendance-outcome statuses on bookings (coach/student no-show)
 * and the `attendance_finalized` guard used by admin mark-no-show endpoints.
 *
 * `bookings.attendance_finalized` (see Booking model) is set to `true` on
 * **every** successful `PUT /api/disputes/:id/resolve`, including behavior
 * disputes — not only attendance claims. That locks direct admin/coach
 * attendance mutations; further attendance changes go through a new dispute
 * + resolve. It does not freeze unrelated columns on the booking row.
 */

/** Admin may toggle no-show amongst these lessons (lesson must have ended; other guards elsewhere). */
export const ADMIN_MARK_NO_SHOW_SOURCE_STATUSES = [
  'confirmed',
  'awaiting_verification',
  'student_no_show',
  'coach_no_show',
];

/** Dispute resolve may set attendance outcome when booking started from these statuses. Includes `disputed` (blocked for direct admin marks). `completed` covers post-lesson corrections via resolve. */
export const DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES = [
  ...ADMIN_MARK_NO_SHOW_SOURCE_STATUSES,
  'disputed',
  'completed',
];

export const ATTENDANCE_OUTCOME_STATUSES = ['student_no_show', 'coach_no_show'];

/**
 * Hard-resolution guard for any code path that wants to mutate a booking's
 * attendance outcome outside of `PUT /api/disputes/:id/resolve`.
 *
 * When `attendance_finalized === true` (after **any** dispute type has been
 * resolved on this booking — attendance or behavior), direct admin no-show
 * mutations are blocked. The attendance outcome may still change only by
 * opening a **new** dispute on the same booking and resolving it (resolve
 * is the only path that clears/advances adjudication and re-affirms this flag).
 *
 * Wired into `adminMarkBookingNoShow`, `adminMarkCoachNoShow`, coach
 * `markBookingNoShow`, and coach `completeBooking`. Any post-resolve attendance
 * or completion mutation must fail with `attendance_finalized_locked`.
 *
 * @param {{ attendance_finalized?: boolean } | null | undefined} booking
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function checkAttendanceFinalized(booking) {
  if (booking && booking.attendance_finalized === true) {
    return {
      ok: false,
      code: 'attendance_finalized_locked',
      message:
        'Attendance outcome is finalized via dispute resolution. ' +
        'Open a new dispute to change it.',
    };
  }
  return { ok: true };
}

/**
 * @param {string} toStatus — must be attendance outcome
 * @param {Set<string>} allowedSources
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
export function validateAttendanceOutcomeTransition(fromStatus, toStatus, allowedSources) {
  if (!ATTENDANCE_OUTCOME_STATUSES.includes(toStatus)) {
    return {
      ok: false,
      code: 'invalid_attendance_outcome',
      message: `Invalid attendance outcome status: ${toStatus}`,
    };
  }
  if (fromStatus === toStatus) return { ok: true };
  if (!allowedSources.has(fromStatus)) {
    return {
      ok: false,
      code: 'invalid_attendance_status_transition',
      message:
        `Cannot set booking to ${toStatus} from status ${fromStatus}. ` +
        `Allowed source statuses: ${[...allowedSources].join(', ')}`,
    };
  }
  return { ok: true };
}
