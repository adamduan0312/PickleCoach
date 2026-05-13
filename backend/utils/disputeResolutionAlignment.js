/**
 * Hard validation for `PUT /api/disputes/:id/resolve` so decision, outcome,
 * financial_action, and penalize_role stay logically consistent.
 *
 * Reversible philosophy: behavior and attendance claimants can both lose. Claimant-vs-accused
 * direction is NOT enforced here; it is surfaced as an advisory warning in disputeResolutionWarnings
 * (see `behavior_claim_reversal` and `attendance_claim_reversal`). `openedBy` is accepted for
 * symmetry / future rules but no longer drives 400 errors.
 *
 * --------------------------------------------------------------------------
 * Dispute resolution system boundaries (where this module fits)
 * --------------------------------------------------------------------------
 * Layer 1 — Authorization (pre-alignment)
 *   Owners: auth middleware (`requireAuth`, role checks in `disputeController.resolveDispute`).
 *   Responsibility: "Can this user even attempt this action?"
 *   Examples: non-admin → 403; missing/invalid JWT → 401.
 *
 * Layer 2 — State + domain guards (pre-alignment)
 *   Owners: `disputeController.resolveDispute` lookups, `bookingAttendanceStatus.js`,
 *           `paymentService.getLatestBookingRefundState`, `loadResolveDisputeTypeForValidation`.
 *   Responsibility: "Is this action valid given current system state?"
 *   Examples: dispute not found → 404; dispute already `resolved`/`rejected` → 400;
 *             invalid attendance status transition → 400 `invalid_attendance_status_transition`;
 *             refund already used on booking → 409 `refund_path_already_used`.
 *
 * Layer 3 — Alignment (this module + `disputeResolutionWarnings.js`)
 *   Owners: `validateDisputeResolutionPayload` (hard 400s) and the warning helpers
 *           (advisory `warnings[]` entries in the 200 response).
 *   Responsibility: "Is the resolution logically consistent with itself?"
 *   Examples: attendance outcome ↔ financial_action (400 `attendance_financial_mismatch`);
 *             missing attendance outcome (400 `attendance_outcome_required`); rejected
 *             attendance outcome that confirms the claim (400
 *             `attendance_rejected_outcome_aligns_with_claim`); penalize_role required for
 *             sustained behavior (400); unsupported dispute type (400
 *             `unsupported_dispute_alignment_type`).
 *
 * Layer 4 — Side-effect execution (post-alignment)
 *   Owners: `paymentService`, `stripeService`, payout/refund/reconciliation workers,
 *           `updateUserReliability`, booking row updates inside the resolve transaction.
 *   Responsibility: "Actually move money + update system state."
 *   Examples: Stripe refund execution (succeeded/failed/retried via `payment_actions`);
 *             payout worker decisions; reliability recomputation; booking status persist.
 *
 * Do NOT push Layer 1/2/4 concerns into this module — keep alignment focused on payload
 * shape consistency so the boundaries above stay clean and testable.
 */

const ATTENDANCE_TYPES = new Set(['coach_no_show_claim', 'student_no_show_claim']);
const BEHAVIOR_TYPES = new Set(['late_arrival', 'misconduct', 'lesson_not_completed']);
const SUSTAINED = new Set(['upheld', 'partial']);

const SUPPORTED_DISPUTE_TYPES = [...ATTENDANCE_TYPES, ...BEHAVIOR_TYPES];

const isRefund = (financialAction) =>
  financialAction === 'refund_student' || financialAction === 'refund_student_partial';

/**
 * @param {object} p
 * @param {string} p.disputeTypeCode
 * @param {string} p.decision
 * @param {string|undefined|null} p.outcome
 * @param {string} p.financialAction
 * @param {string|undefined|null} p.penalizeRole
 * @param {string|undefined|null} [p.openedBy] — accepted for symmetry; no longer drives 400 errors.
 * @returns {{ ok: true } | { ok: false, message: string, code: string }}
 */
export function validateDisputeResolutionPayload({
  disputeTypeCode,
  decision,
  outcome,
  financialAction,
  penalizeRole,
  // openedBy intentionally accepted but unused — see module header.
  // eslint-disable-next-line no-unused-vars
  openedBy,
}) {
  if (!disputeTypeCode || (!ATTENDANCE_TYPES.has(disputeTypeCode) && !BEHAVIOR_TYPES.has(disputeTypeCode))) {
    return {
      ok: false,
      code: 'unsupported_dispute_alignment_type',
      message: `Unsupported dispute_type_code${disputeTypeCode ? ` "${disputeTypeCode}"` : ''}. Resolution alignment is only defined for: ${SUPPORTED_DISPUTE_TYPES.join(', ')}.`,
    };
  }

  if (ATTENDANCE_TYPES.has(disputeTypeCode)) {
    if (outcome == null || outcome === '') {
      return {
        ok: false,
        code: 'attendance_outcome_required',
        message:
          'outcome is required for all attendance dispute resolutions (upheld, partial, or rejected).',
      };
    }

    if (decision === 'rejected') {
      if (disputeTypeCode === 'coach_no_show_claim' && outcome !== 'student_no_show') {
        return {
          ok: false,
          code: 'attendance_rejected_outcome_aligns_with_claim',
          message:
            'When rejecting a coach_no_show_claim, outcome must be student_no_show (rejecting the student\'s allegation records that the student did not attend). outcome cannot be coach_no_show — that would confirm the claim.',
        };
      }
      if (disputeTypeCode === 'student_no_show_claim' && outcome !== 'coach_no_show') {
        return {
          ok: false,
          code: 'attendance_rejected_outcome_aligns_with_claim',
          message:
            'When rejecting a student_no_show_claim, outcome must be coach_no_show (rejecting the coach\'s allegation records that the coach did not attend). outcome cannot be student_no_show — that would confirm the claim.',
        };
      }
    }

    // Factual attendance outcome drives money the same way for upheld, partial, and rejected.
    const refund = isRefund(financialAction);
    const noChange = financialAction === 'no_change';

    if (outcome === 'coach_no_show' && noChange) {
      return {
        ok: false,
        code: 'attendance_financial_mismatch',
        message:
          'When outcome is coach_no_show, financial_action must be refund_student or refund_student_partial so the student can be compensated.',
      };
    }
    if (outcome === 'student_no_show' && refund) {
      return {
        ok: false,
        code: 'attendance_financial_mismatch',
        message:
          'When outcome is student_no_show, financial_action must be no_change (the student is the at-fault party for attendance).',
      };
    }

    return { ok: true };
  }

  if (BEHAVIOR_TYPES.has(disputeTypeCode)) {
    if (decision === 'rejected') {
      if (financialAction !== 'no_change') {
        return {
          ok: false,
          code: 'behavior_rejected_financial',
          message: 'When decision is rejected, financial_action must be no_change.',
        };
      }
      if (penalizeRole != null && penalizeRole !== 'none') {
        return {
          ok: false,
          code: 'behavior_rejected_penalize',
          message: 'penalize_role must be none when rejecting a behavior dispute',
        };
      }
      return { ok: true };
    }

    if (SUSTAINED.has(decision)) {
      if (penalizeRole !== 'coach' && penalizeRole !== 'student') {
        return {
          ok: false,
          code: 'behavior_penalize_required',
          message: 'penalize_role must be coach or student when decision is upheld or partial for behavior disputes',
        };
      }

      if (penalizeRole === 'student' && isRefund(financialAction)) {
        return {
          ok: false,
          code: 'behavior_financial_penalize_mismatch',
          message:
            'When penalize_role is student, financial_action must be no_change (do not refund the at-fault student via this resolution).',
        };
      }
    }

    return { ok: true };
  }

  // Unreachable: dispute type is in one of the supported sets above.
  return { ok: true };
}
