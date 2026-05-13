/**
 * Single place for attendance-outcome statuses on bookings (coach/student no-show).
 * Used by admin mark-no-show endpoints and attendance dispute resolve.
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
