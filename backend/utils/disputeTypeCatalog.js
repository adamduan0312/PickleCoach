/**
 * Canonical in-app dispute type catalog (product: five active types).
 * Refunds are resolution outcomes (`financial_action`), not dispute types.
 */

export const ATTENDANCE_DISPUTE_TYPE_CODES = ['coach_no_show_claim', 'student_no_show_claim'];

/** Lesson quality / conduct — reliability penalties when sustained. */
export const BEHAVIOR_DISPUTE_TYPE_CODES = ['misconduct', 'lesson_not_completed'];

export const CATCHALL_DISPUTE_TYPE_CODE = 'other';

/** Types callers may use when creating a dispute. */
export const ACTIVE_DISPUTE_TYPE_CODES = [
  ...ATTENDANCE_DISPUTE_TYPE_CODES,
  ...BEHAVIOR_DISPUTE_TYPE_CODES,
  CATCHALL_DISPUTE_TYPE_CODE,
];

export const ATTENDANCE_DISPUTE_TYPES = new Set(ATTENDANCE_DISPUTE_TYPE_CODES);
export const BEHAVIOR_DISPUTE_TYPES = new Set(BEHAVIOR_DISPUTE_TYPE_CODES);
export const CATCHALL_DISPUTE_TYPES = new Set([CATCHALL_DISPUTE_TYPE_CODE]);

/** Types admin resolve alignment supports. */
export const RESOLVABLE_DISPUTE_TYPE_CODES = [...ACTIVE_DISPUTE_TYPE_CODES];

export function isAttendanceDisputeType(code) {
  return ATTENDANCE_DISPUTE_TYPES.has(code);
}

export function isBehaviorDisputeType(code) {
  return BEHAVIOR_DISPUTE_TYPES.has(code);
}

export function isCatchallDisputeType(code) {
  return CATCHALL_DISPUTE_TYPES.has(code);
}

export function isActiveDisputeTypeCode(code) {
  return ACTIVE_DISPUTE_TYPE_CODES.includes(code);
}
