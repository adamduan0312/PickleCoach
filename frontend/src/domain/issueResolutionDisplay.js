/**
 * Customer-facing labels for resolved in-app issues.
 * Prefers structured resolve fields over legacy resolutionAction names / seed notes.
 */

import { formatMoney } from '../utils/format.js';
import {
  isCoachPayoutNotDue,
  isCoachPayoutReleased,
} from './bookingStatus.js';

const ATTENDANCE_TYPE_CODES = new Set(['coach_no_show_claim', 'student_no_show_claim']);

const RESOLUTION_ACTION_TO_FINANCIAL = {
  approved_refund: 'refund_student',
  partial_refund: 'refund_student_partial',
  no_action: 'no_change',
};

/** @param {string|null|undefined} code */
export function isAttendanceIssueType(code) {
  return ATTENDANCE_TYPE_CODES.has(String(code || ''));
}

/**
 * Resolve financial_action from structured field or (fallback) resolution action code.
 * Never infers full vs partial from refund_amount alone.
 */
export function resolveFinancialAction(issue) {
  const direct = String(issue?.financial_action || '').toLowerCase();
  if (direct === 'no_change' || direct === 'refund_student' || direct === 'refund_student_partial') {
    return direct;
  }
  const actionCode = String(
    issue?.resolutionAction?.code
      || issue?.resolution_action?.code
      || '',
  ).toLowerCase();
  return RESOLUTION_ACTION_TO_FINANCIAL[actionCode] || null;
}

export function decisionLabel(decision) {
  const d = String(decision || '').toLowerCase();
  if (d === 'upheld') return 'Upheld';
  if (d === 'rejected') return 'Not upheld';
  return null;
}

/**
 * @param {object} issue
 * @returns {string|null}
 */
export function financialOutcomeLabel(issue) {
  const action = resolveFinancialAction(issue);
  const amount = issue?.refund_amount != null ? Number(issue.refund_amount) : null;
  const hasAmount = Number.isFinite(amount) && amount > 0;

  if (action === 'refund_student_partial') {
    return hasAmount ? `Partial refund of ${formatMoney(amount)}` : 'Partial refund';
  }
  if (action === 'refund_student') {
    return 'Full refund';
  }
  if (action === 'no_change') {
    return 'No refund';
  }

  // Structured action missing: never call a positive amount a "Full refund".
  if (hasAmount) return `Partial refund of ${formatMoney(amount)}`;
  return null;
}

export function attendanceFindingLabel(outcome) {
  const o = String(outcome || '').toLowerCase();
  if (o === 'coach_no_show') return 'Coach no-show';
  if (o === 'student_no_show') return 'Student no-show';
  if (o === 'lesson_occurred') return 'Lesson occurred';
  return null;
}

/**
 * Behavior / catchall disputes: explicit `penalize_role` picker.
 * Do not use this for attendance disputes — those use booking status instead.
 */
export function reliabilityLabel(penalizeRole) {
  const r = String(penalizeRole || 'none').toLowerCase();
  if (r === 'coach') return 'Coach penalized';
  if (r === 'student') return 'Student penalized';
  if (r === 'none' || !r) return 'No reliability penalty';
  return null;
}

/**
 * Attendance disputes: reliability follows the attendance finding / booking status
 * (`coach_no_show` / `student_no_show`), not `penalize_role` (always `none`).
 * Omit the line for lesson_occurred or unknown findings.
 */
export function attendanceReliabilityLabel(outcome) {
  const o = String(outcome || '').toLowerCase();
  if (o === 'coach_no_show') return 'Coach no-show recorded for reliability';
  if (o === 'student_no_show') return 'Student no-show recorded for reliability';
  return null;
}

/** Dispute type code from issue / resolved_issue payloads. */
export function issueTypeCode(issue) {
  return (
    issue?.dispute_type_code
    || issue?.disputeType?.code
    || issue?.dispute_type?.code
    || null
  );
}

/**
 * True when notes look like seed/debug fixture text (not customer-facing admin notes).
 */
export function isSeedOrDebugResolutionNotes(notes) {
  const s = String(notes || '').trim();
  if (!s) return true;
  if (/^seeded\b/i.test(s)) return true;
  if (/^qa\b/i.test(s)) return true;
  if (/\brefund_student(_partial)?\b/i.test(s) && /\b(upheld|rejected)\b/i.test(s)) return true;
  return false;
}

export function adminNotesText(issue) {
  const notes = typeof issue?.resolution_notes === 'string'
    ? issue.resolution_notes.trim()
    : '';
  if (!notes || isSeedOrDebugResolutionNotes(notes)) return null;
  return notes;
}

/**
 * Coach payout label for booking detail — separate from student refund wording.
 * @returns {'None due'|'Pending'|'Paid'|'Failed — manual review'|null}
 */
export function coachPayoutLabel(booking, payment) {
  const escrow = String(payment?.escrow_status || '').toLowerCase();
  if (escrow === 'manual_payout_required') return 'Failed — manual review';
  const ps = String(booking?.payout_status || '').toLowerCase();
  if (ps === 'paid') return 'Paid';
  if (ps === 'processing') return 'Pending';
  if (isCoachPayoutReleased(booking)) return 'Paid';
  if (isCoachPayoutNotDue(booking, payment)) return 'None due';
  if (ps === 'pending' || ps === 'awaiting_verification' || ps === 'none' || !ps) {
    return 'Pending';
  }
  return 'Pending';
}

/**
 * Labeled facts for Issue resolved panel / Issue resolution page.
 * @returns {{ decision: string|null, financial: string|null, reliability: string|null, attendance: string|null }}
 */
export function issueResolutionFacts(issue) {
  const typeCode = issueTypeCode(issue);
  const isAttendance = isAttendanceIssueType(typeCode);
  const attendance = isAttendance
    ? attendanceFindingLabel(issue?.outcome)
    : null;
  const reliability = isAttendance
    ? attendanceReliabilityLabel(issue?.outcome)
    : reliabilityLabel(issue?.penalize_role);
  return {
    decision: decisionLabel(issue?.decision),
    financial: financialOutcomeLabel(issue),
    reliability,
    attendance,
  };
}
