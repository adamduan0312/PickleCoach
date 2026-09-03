/**
 * Admin dispute resolve — structural helpers only.
 * Does NOT encode the backend Layer 3 alignment matrix; the API remains authoritative.
 */

export const RESOLVE_DECISIONS = [
  { value: 'upheld', label: 'Uphold claim' },
  { value: 'partial', label: 'Partial' },
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

export function labelForOption(options, value) {
  const found = options.find((o) => o.value === value);
  return found?.label || value || '—';
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
    return { ok: false, message: 'Select who to penalize (or Neither).' };
  }
  if (financialAction === 'refund_student_partial') {
    const amount = Number(form?.refund_amount);
    if (!Number.isFinite(amount) || amount < 0.01) {
      return { ok: false, message: 'Enter a partial refund amount of at least $0.01.' };
    }
  }

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
export function resolveConfirmationLines(form, disputeTypeCodeValue) {
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
