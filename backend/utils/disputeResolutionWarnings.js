const BEHAVIOR_DISPUTE_CODES = new Set(['late_arrival', 'misconduct', 'lesson_not_completed']);
const SUSTAINED_DECISIONS = new Set(['upheld', 'partial']);

/**
 * Attendance outcomes where the factual outcome contradicts the party who opened the claim
 * (sustained or rejected-with-outcome — audit / admin confirmation only; does not block).
 */
export const getAttendanceClaimReversalWarning = ({
  disputeTypeCode,
  decision,
  outcome,
  openedBy,
}) => {
  if ((!SUSTAINED_DECISIONS.has(decision) && decision !== 'rejected') || outcome == null) return null;

  if (
    disputeTypeCode === 'coach_no_show_claim' &&
    openedBy === 'student' &&
    outcome === 'student_no_show'
  ) {
    return {
      code: 'attendance_claim_reversal',
      severity: 'warning',
      advisory: true,
      message:
        'The student opened a coach no-show claim, but the resolved outcome is student no-show. Confirm this reversal matches the evidence.',
      dispute_type_code: disputeTypeCode,
      decision,
      outcome,
      opened_by: openedBy,
    };
  }

  if (
    disputeTypeCode === 'student_no_show_claim' &&
    openedBy === 'coach' &&
    outcome === 'coach_no_show'
  ) {
    return {
      code: 'attendance_claim_reversal',
      severity: 'warning',
      advisory: true,
      message:
        'The coach opened a student no-show claim, but the resolved outcome is coach no-show. Confirm this reversal matches the evidence.',
      dispute_type_code: disputeTypeCode,
      decision,
      outcome,
      opened_by: openedBy,
    };
  }

  return null;
};

export const isBehaviorDisputeCode = (disputeTypeCode) => BEHAVIOR_DISPUTE_CODES.has(disputeTypeCode);

/**
 * Advisory when an admin opened the behavior dispute: penalize_role is not auto-inferred from claimant.
 * Does not block — admins resolving their own intake should consciously pick a side.
 */
export const getBehaviorResolutionDirectionWarning = ({
  disputeTypeCode,
  decision,
  penalizeRole,
  openedBy,
}) => {
  if (
    isBehaviorDisputeCode(disputeTypeCode) &&
    SUSTAINED_DECISIONS.has(decision) &&
    (penalizeRole === 'coach' || penalizeRole === 'student') &&
    openedBy === 'admin'
  ) {
    return {
      code: 'behavior_resolution_direction_ambiguous',
      severity: 'warning',
      advisory: true,
      message:
        'This behavior dispute was opened by admin, so claimant-vs-accused direction is not inferred automatically. Confirm penalize_role intentionally. Continue?',
      dispute_type_code: disputeTypeCode,
      decision,
      opener_role: null,
      accused_role: null,
      penalize_role: penalizeRole,
    };
  }

  return null;
};

/**
 * Advisory when a sustained behavior dispute penalizes the very party that opened it
 * (e.g. student-opened misconduct resolved against the student). The result is allowed —
 * claimants can lose if the investigation reverses their accusation — but it should be
 * surfaced for audit and admin confirmation.
 */
export const getBehaviorClaimReversalWarning = ({
  disputeTypeCode,
  decision,
  penalizeRole,
  openedBy,
}) => {
  if (!isBehaviorDisputeCode(disputeTypeCode)) return null;
  if (!SUSTAINED_DECISIONS.has(decision)) return null;
  if (penalizeRole !== 'coach' && penalizeRole !== 'student') return null;
  if (openedBy !== 'coach' && openedBy !== 'student') return null;
  if (penalizeRole !== openedBy) return null;

  return {
    code: 'behavior_claim_reversal',
    severity: 'warning',
    advisory: true,
    message: `Behavior resolution penalizes the dispute claimant (${openedBy} opened, ${penalizeRole} penalized). Confirm this reversal matches the evidence.`,
    dispute_type_code: disputeTypeCode,
    decision,
    opened_by: openedBy,
    penalize_role: penalizeRole,
  };
};
