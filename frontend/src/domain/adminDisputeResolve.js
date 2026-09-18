/**
 * Admin dispute resolve helpers.
 *
 * Field visibility + soft client guards mirror the backend Layer 3 alignment
 * matrix so the UI does not imply every dispute type supports the same choices.
 * The API remains the final authority.
 */

import { previewFinancialAllocation } from './bookingSettlementDisplay.js';

export const RESOLVE_DECISIONS = [
  { value: 'upheld', label: 'Uphold claim' },
  { value: 'rejected', label: 'Reject / dismiss' },
];

export const RESOLVE_FINANCIAL_ACTIONS = [
  { value: 'no_change', label: 'No financial action' },
  { value: 'refund_student', label: 'Refund student in full' },
  { value: 'refund_student_partial', label: 'Refund student (partial)' },
];

export const RESOLVE_OUTCOMES = [
  { value: 'coach_no_show', label: 'Coach no-show' },
  { value: 'student_no_show', label: 'Student no-show' },
  {
    value: 'lesson_occurred',
    label: 'Neither / lesson occurred',
  },
];

export const RESOLVE_PENALIZE_ROLES = [
  { value: 'student', label: 'Student' },
  { value: 'coach', label: 'Coach' },
  { value: 'none', label: 'Neither' },
];

const ATTENDANCE_TYPES = new Set(['coach_no_show_claim', 'student_no_show_claim']);
const BEHAVIOR_TYPES = new Set(['misconduct', 'lesson_not_completed']);
const CATCHALL_TYPES = new Set(['other']);
const RESOLVABLE_TYPES = new Set([...ATTENDANCE_TYPES, ...BEHAVIOR_TYPES, ...CATCHALL_TYPES]);
const SUSTAINED_DECISIONS = new Set(['upheld']);

export function disputeTypeCode(dispute) {
  return (
    dispute?.disputeType?.code
    || dispute?.dispute_type?.code
    || null
  );
}

export function isAttendanceDisputeType(code) {
  return ATTENDANCE_TYPES.has(code);
}

export function isBehaviorDisputeType(code) {
  return BEHAVIOR_TYPES.has(code);
}

export function isCatchallDisputeType(code) {
  return CATCHALL_TYPES.has(code);
}

export function isSustainedDecision(decision) {
  return SUSTAINED_DECISIONS.has(decision);
}

/** Match backend resolveDispute: open | under_review only. */
export function isDisputeResolvable(dispute) {
  const status = dispute?.status;
  if (status !== 'open' && status !== 'under_review') return false;
  const code = disputeTypeCode(dispute);
  // Unknown type still shows the form; API will reject unsupported alignment types.
  if (code && !RESOLVABLE_TYPES.has(code)) return false;
  return true;
}

export function resolveFieldVisibility(disputeTypeCodeValue) {
  return {
    showOutcome: isAttendanceDisputeType(disputeTypeCodeValue),
    showPenalizeRole: isBehaviorDisputeType(disputeTypeCodeValue),
  };
}

/**
 * Type-aware intro copy so admins do not assume a universal choice set.
 */
export function resolveFormHint(disputeTypeCodeValue) {
  if (isAttendanceDisputeType(disputeTypeCodeValue)) {
    return 'Attendance outcome sets booking status and reliability. Coach no-show requires a refund; student no-show requires no financial action. When rejecting a claim because the lesson happened, choose Neither / lesson occurred (booking Completed, no refund). The API remains the final authority.';
  }
  if (isBehaviorDisputeType(disputeTypeCodeValue)) {
    return 'Uphold must penalize coach or student (Neither is not allowed). No financial action is allowed when a role is penalized. Refund size is chosen separately. The API remains the final authority.';
  }
  if (isCatchallDisputeType(disputeTypeCodeValue)) {
    return 'Other disputes have no reliability penalty. You may uphold with no refund and no reliability penalty. Rejected decisions require no financial action. The API remains the final authority.';
  }
  return 'Choose decision and financial action separately. Available options depend on dispute type. The backend validates that the combination is allowed.';
}

/**
 * Attendance outcomes by decision.
 * Rejected: contradicting no-show (other party at fault) OR lesson_occurred (neutral).
 * Sustained: coach/student no-show only (not lesson_occurred).
 */
export function attendanceOutcomeOptions(disputeTypeCodeValue, decision) {
  if (!isAttendanceDisputeType(disputeTypeCodeValue)) return [];
  const noShows = RESOLVE_OUTCOMES.filter((o) => o.value !== 'lesson_occurred');
  const neutral = RESOLVE_OUTCOMES.filter((o) => o.value === 'lesson_occurred');
  if (decision === 'rejected') {
    if (disputeTypeCodeValue === 'coach_no_show_claim') {
      return [
        ...noShows.filter((o) => o.value === 'student_no_show'),
        ...neutral,
      ];
    }
    if (disputeTypeCodeValue === 'student_no_show_claim') {
      return [
        ...noShows.filter((o) => o.value === 'coach_no_show'),
        ...neutral,
      ];
    }
    return [...noShows, ...neutral];
  }
  return noShows;
}

/**
 * Behavior only: sustained decisions require coach|student; rejected forces Neither.
 */
export function penalizeRoleOptions(decision) {
  if (isSustainedDecision(decision)) {
    return RESOLVE_PENALIZE_ROLES.filter((o) => o.value !== 'none');
  }
  if (decision === 'rejected') {
    return RESOLVE_PENALIZE_ROLES.filter((o) => o.value === 'none');
  }
  return RESOLVE_PENALIZE_ROLES;
}

/**
 * Soft option filter mirroring attendance / reject financial alignment.
 */
export function financialActionOptions({ disputeTypeCode: typeCode, decision, outcome } = {}) {
  if ((isBehaviorDisputeType(typeCode) || isCatchallDisputeType(typeCode)) && decision === 'rejected') {
    return RESOLVE_FINANCIAL_ACTIONS.filter((o) => o.value === 'no_change');
  }
  if (isAttendanceDisputeType(typeCode)) {
    if (outcome === 'coach_no_show') {
      return RESOLVE_FINANCIAL_ACTIONS.filter((o) => o.value !== 'no_change');
    }
    if (outcome === 'student_no_show' || outcome === 'lesson_occurred') {
      return RESOLVE_FINANCIAL_ACTIONS.filter((o) => o.value === 'no_change');
    }
  }
  return RESOLVE_FINANCIAL_ACTIONS;
}

export function labelForOption(options, value) {
  const found = options.find((o) => o.value === value);
  return found?.label || value || '—';
}

/**
 * Soft Layer-3 guards (UX). API still validates.
 * @returns {null | string} error message
 */
export function softValidateResolveCombination(form, disputeTypeCodeValue) {
  const decision = form?.decision;
  const financialAction = form?.financial_action;
  const outcome = form?.outcome;
  const penalizeRole = form?.penalize_role;

  if (isBehaviorDisputeType(disputeTypeCodeValue)) {
    if (isSustainedDecision(decision) && penalizeRole === 'none') {
      return 'Uphold for this dispute type requires penalizing coach or student (Neither is not allowed).';
    }
    if (decision === 'rejected' && penalizeRole && penalizeRole !== 'none') {
      return 'Rejecting a behavior dispute requires reliability penalty Neither.';
    }
    if (decision === 'rejected' && financialAction && financialAction !== 'no_change') {
      return 'Rejecting a behavior dispute requires no financial action.';
    }
    if (penalizeRole === 'student' && (financialAction === 'refund_student' || financialAction === 'refund_student_partial')) {
      return 'When penalizing the student, financial action must be no change.';
    }
  }

  if (isCatchallDisputeType(disputeTypeCodeValue)) {
    if (decision === 'rejected' && financialAction && financialAction !== 'no_change') {
      return 'Rejecting an other dispute requires no financial action.';
    }
  }

  if (isAttendanceDisputeType(disputeTypeCodeValue)) {
    if (isSustainedDecision(decision) && outcome === 'lesson_occurred') {
      return 'Neither / lesson occurred is only available when rejecting a claim.';
    }
    if (decision === 'rejected' && disputeTypeCodeValue === 'coach_no_show_claim' && outcome === 'coach_no_show') {
      return 'Rejecting a coach no-show claim cannot confirm coach no-show. Choose student no-show or Neither / lesson occurred.';
    }
    if (decision === 'rejected' && disputeTypeCodeValue === 'student_no_show_claim' && outcome === 'student_no_show') {
      return 'Rejecting a student no-show claim cannot confirm student no-show. Choose coach no-show or Neither / lesson occurred.';
    }
    if (outcome === 'coach_no_show' && financialAction === 'no_change') {
      return 'Coach no-show requires a full or partial student refund.';
    }
    if (
      (outcome === 'student_no_show' || outcome === 'lesson_occurred')
      && (financialAction === 'refund_student' || financialAction === 'refund_student_partial')
    ) {
      return outcome === 'lesson_occurred'
        ? 'Neither / lesson occurred requires no financial action.'
        : 'Student no-show requires no financial action.';
    }
  }

  return null;
}

/**
 * Build API body from form state. Omits fields forbidden for the dispute type.
 * @returns {{ ok: true, body: object } | { ok: false, message: string }}
 */
export function buildResolveRequestBody(form, disputeTypeCodeValue) {
  const decision = form?.decision;
  const financialAction = form?.financial_action;
  const notes = String(form?.resolution_notes || '').trim();

  if (!decision) return { ok: false, message: 'Select a decision.' };
  if (!financialAction) return { ok: false, message: 'Select a financial action.' };
  if (!notes) return { ok: false, message: 'Resolution notes are required.' };

  const visibility = resolveFieldVisibility(disputeTypeCodeValue);

  if (visibility.showOutcome && !form?.outcome) {
    return { ok: false, message: 'Select an attendance outcome.' };
  }
  if (visibility.showPenalizeRole && !form?.penalize_role) {
    return {
      ok: false,
      message: isSustainedDecision(decision)
        ? 'Select who to penalize (coach or student).'
        : 'Select a reliability penalty option.',
    };
  }
  if (financialAction === 'refund_student_partial') {
    const amount = Number(form?.refund_amount);
    if (!Number.isFinite(amount) || amount < 0.01) {
      return { ok: false, message: 'Enter a partial refund amount of at least $0.01.' };
    }
  }

  const softError = softValidateResolveCombination(form, disputeTypeCodeValue);
  if (softError) return { ok: false, message: softError };

  const body = {
    decision,
    financial_action: financialAction,
    resolution_notes: notes,
  };

  if (visibility.showOutcome) {
    body.outcome = form.outcome;
  }
  if (visibility.showPenalizeRole) {
    body.penalize_role = form.penalize_role;
  }
  if (financialAction === 'refund_student_partial') {
    body.refund_amount = Number(form.refund_amount);
  }

  return { ok: true, body };
}

/** Human summary lines for confirmation dialog / review panel. */
export function resolveConfirmationLines(form, disputeTypeCodeValue, { capturedAmount } = {}) {
  const visibility = resolveFieldVisibility(disputeTypeCodeValue);
  const lines = [
    `Decision: ${labelForOption(RESOLVE_DECISIONS, form.decision)}`,
  ];
  if (visibility.showOutcome) {
    lines.push(`Attendance outcome: ${labelForOption(RESOLVE_OUTCOMES, form.outcome)}`);
  }
  if (visibility.showPenalizeRole) {
    lines.push(`Reliability: ${labelForOption(RESOLVE_PENALIZE_ROLES, form.penalize_role)}`);
  }
  lines.push(`Financial action: ${labelForOption(RESOLVE_FINANCIAL_ACTIONS, form.financial_action)}`);
  if (form.financial_action === 'refund_student_partial' && form.refund_amount != null && form.refund_amount !== '') {
    lines.push(`Partial refund amount: $${Number(form.refund_amount).toFixed(2)}`);
  }
  const preview = previewFinancialAllocation({
    capturedAmount,
    financialAction: form.financial_action,
    refundAmount: form.refund_amount,
  });
  if (preview) {
    lines.push(...preview.lines);
    if (form.financial_action === 'refund_student_partial') {
      lines.push(
        'Note: A partial refund returns only the specified amount to the student. The remaining captured amount is split between platform fee and coach payout — it is not automatically refunded again.',
      );
    }
  }
  if (form.resolution_notes?.trim()) {
    lines.push(`Notes: ${String(form.resolution_notes).trim()}`);
  }
  return lines;
}

export function formatResolveApiError(err) {
  if (!err) return 'Failed to resolve dispute.';
  const status = err.status;
  const code = err.code || err.payload?.code;
  const current = err.payload?.current_status;
  if (status === 409 && code === 'refund_path_already_used') {
    return 'A refund path was already used for this booking. Resolve with no financial action, or finish refunds through a single path.';
  }
  if (status === 400 && code === 'behavior_penalize_required') {
    return 'Uphold for this dispute requires penalizing coach or student (Neither is not allowed).';
  }
  if (status === 400 && code === 'attendance_financial_mismatch') {
    return err.message || 'Attendance outcome and financial action do not match.';
  }
  if (status === 400 && code === 'attendance_neutral_requires_rejected') {
    return 'Neither / lesson occurred is only allowed when rejecting an attendance claim.';
  }
  if (status === 400 && current === 'resolved') {
    return 'This dispute is already resolved.';
  }
  if (status === 400 && current === 'rejected') {
    return 'This dispute was rejected and cannot be resolved.';
  }
  if (status === 400 && code) {
    return `${err.message || 'Invalid resolution'}${code ? ` (${code})` : ''}`;
  }
  return err.message || 'Failed to resolve dispute.';
}
