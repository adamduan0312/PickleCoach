import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attendanceOutcomeOptions,
  buildResolveRequestBody,
  financialActionOptions,
  formatResolveApiError,
  isDisputeResolvable,
  penalizeRoleOptions,
  RESOLVE_DECISIONS,
  resolveConfirmationLines,
  resolveFieldVisibility,
  resolveFormHint,
  softValidateResolveCombination,
} from '../src/domain/adminDisputeResolve.js';

describe('admin dispute resolve helpers', () => {
  it('only marks open and under_review as resolvable', () => {
    assert.equal(isDisputeResolvable({ status: 'open', disputeType: { code: 'misconduct' } }), true);
    assert.equal(isDisputeResolvable({ status: 'under_review', disputeType: { code: 'other' } }), true);
    assert.equal(isDisputeResolvable({ status: 'resolved', disputeType: { code: 'misconduct' } }), false);
    assert.equal(isDisputeResolvable({ status: 'rejected', disputeType: { code: 'misconduct' } }), false);
  });

  it('shows structural fields by dispute type', () => {
    assert.deepEqual(resolveFieldVisibility('coach_no_show_claim'), {
      showOutcome: true,
      showPenalizeRole: false,
    });
    assert.deepEqual(resolveFieldVisibility('misconduct'), {
      showOutcome: false,
      showPenalizeRole: true,
    });
    assert.deepEqual(resolveFieldVisibility('other'), {
      showOutcome: false,
      showPenalizeRole: false,
    });
  });

  it('filters penalize options: no Neither on uphold; only Neither on reject', () => {
    assert.deepEqual(
      penalizeRoleOptions('upheld').map((o) => o.value),
      ['student', 'coach'],
    );
    assert.deepEqual(
      penalizeRoleOptions('rejected').map((o) => o.value),
      ['none'],
    );
    assert.deepEqual(
      RESOLVE_DECISIONS.map((o) => o.value),
      ['upheld', 'rejected'],
    );
  });

  it('filters financial options by attendance outcome, reject rules, and behavior penalize role', () => {
    assert.deepEqual(
      financialActionOptions({
        disputeTypeCode: 'coach_no_show_claim',
        outcome: 'coach_no_show',
      }).map((o) => o.value),
      ['refund_student', 'refund_student_partial'],
    );
    assert.deepEqual(
      financialActionOptions({
        disputeTypeCode: 'student_no_show_claim',
        outcome: 'student_no_show',
      }).map((o) => o.value),
      ['no_change'],
    );
    assert.deepEqual(
      financialActionOptions({
        disputeTypeCode: 'misconduct',
        decision: 'rejected',
      }).map((o) => o.value),
      ['no_change'],
    );
    assert.deepEqual(
      financialActionOptions({
        disputeTypeCode: 'misconduct',
        decision: 'upheld',
        penalizeRole: 'student',
      }).map((o) => o.value),
      ['no_change'],
    );
    assert.deepEqual(
      financialActionOptions({
        disputeTypeCode: 'misconduct',
        decision: 'upheld',
        penalizeRole: 'coach',
      }).map((o) => o.value),
      ['no_change', 'refund_student', 'refund_student_partial'],
    );
    assert.deepEqual(
      financialActionOptions({
        disputeTypeCode: 'other',
        decision: 'upheld',
      }).map((o) => o.value),
      ['no_change', 'refund_student', 'refund_student_partial'],
    );
  });

  it('forces contradicting attendance outcome options when rejecting a claim, plus lesson_occurred', () => {
    assert.deepEqual(
      attendanceOutcomeOptions('coach_no_show_claim', 'rejected').map((o) => o.value),
      ['student_no_show', 'lesson_occurred'],
    );
    assert.deepEqual(
      attendanceOutcomeOptions('student_no_show_claim', 'rejected').map((o) => o.value),
      ['coach_no_show', 'lesson_occurred'],
    );
    assert.deepEqual(
      attendanceOutcomeOptions('coach_no_show_claim', 'upheld').map((o) => o.value),
      ['coach_no_show', 'student_no_show'],
    );
  });

  it('soft-blocks upheld behavior with Neither and coach no-show with no_change; allows lesson_occurred reject', () => {
    assert.match(
      softValidateResolveCombination(
        { decision: 'upheld', penalize_role: 'none', financial_action: 'no_change' },
        'misconduct',
      ),
      /Neither/i,
    );
    assert.match(
      softValidateResolveCombination(
        { decision: 'upheld', outcome: 'coach_no_show', financial_action: 'no_change' },
        'coach_no_show_claim',
      ),
      /refund/i,
    );
    assert.equal(
      softValidateResolveCombination(
        { decision: 'upheld', financial_action: 'no_change' },
        'other',
      ),
      null,
    );
    assert.equal(
      softValidateResolveCombination(
        {
          decision: 'rejected',
          outcome: 'lesson_occurred',
          financial_action: 'no_change',
        },
        'coach_no_show_claim',
      ),
      null,
    );
    assert.match(
      softValidateResolveCombination(
        {
          decision: 'rejected',
          outcome: 'lesson_occurred',
          financial_action: 'refund_student',
        },
        'coach_no_show_claim',
      ),
      /no financial action/i,
    );
  });

  it('builds attendance payload without penalize_role and rejects invalid money combo', () => {
    const bad = buildResolveRequestBody(
      {
        decision: 'upheld',
        outcome: 'coach_no_show',
        financial_action: 'no_change',
        resolution_notes: 'Coach never arrived.',
      },
      'coach_no_show_claim',
    );
    assert.equal(bad.ok, false);

    const result = buildResolveRequestBody(
      {
        decision: 'upheld',
        outcome: 'coach_no_show',
        financial_action: 'refund_student',
        resolution_notes: 'Coach never arrived.',
      },
      'coach_no_show_claim',
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.body, {
      decision: 'upheld',
      financial_action: 'refund_student',
      resolution_notes: 'Coach never arrived.',
      outcome: 'coach_no_show',
    });
    assert.equal('penalize_role' in result.body, false);
  });

  it('builds behavior payload without outcome; blocks Neither on uphold', () => {
    const neither = buildResolveRequestBody(
      {
        decision: 'upheld',
        penalize_role: 'none',
        financial_action: 'no_change',
        resolution_notes: 'Sustained.',
      },
      'misconduct',
    );
    assert.equal(neither.ok, false);

    const missingNotes = buildResolveRequestBody(
      {
        decision: 'upheld',
        penalize_role: 'coach',
        financial_action: 'no_change',
        resolution_notes: '   ',
      },
      'misconduct',
    );
    assert.equal(missingNotes.ok, false);

    const result = buildResolveRequestBody(
      {
        decision: 'upheld',
        penalize_role: 'coach',
        financial_action: 'no_change',
        resolution_notes: 'Sustained misconduct.',
      },
      'misconduct',
    );
    assert.equal(result.ok, true);
    assert.equal(result.body.penalize_role, 'coach');
    assert.equal(result.body.financial_action, 'no_change');
    assert.equal('outcome' in result.body, false);
  });

  it('builds neutral lesson_occurred reject payload for attendance claims', () => {
    const result = buildResolveRequestBody(
      {
        decision: 'rejected',
        outcome: 'lesson_occurred',
        financial_action: 'no_change',
        resolution_notes: 'Lesson happened; claim dismissed.',
      },
      'coach_no_show_claim',
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.body, {
      decision: 'rejected',
      financial_action: 'no_change',
      resolution_notes: 'Lesson happened; claim dismissed.',
      outcome: 'lesson_occurred',
    });

    const studentClaim = buildResolveRequestBody(
      {
        decision: 'rejected',
        outcome: 'lesson_occurred',
        financial_action: 'no_change',
        resolution_notes: 'Lesson happened; claim dismissed.',
      },
      'student_no_show_claim',
    );
    assert.equal(studentClaim.ok, true);
    assert.equal(studentClaim.body.outcome, 'lesson_occurred');
  });

  it('allows other uphold with no_change and no penalize_role', () => {
    const result = buildResolveRequestBody(
      {
        decision: 'upheld',
        financial_action: 'no_change',
        resolution_notes: 'Valid complaint, no money move.',
      },
      'other',
    );
    assert.equal(result.ok, true);
    assert.equal(result.body.financial_action, 'no_change');
    assert.equal('penalize_role' in result.body, false);
  });

  it('requires refund_amount only for partial refunds', () => {
    const missing = buildResolveRequestBody(
      {
        decision: 'upheld',
        financial_action: 'refund_student_partial',
        resolution_notes: 'Partial refund.',
      },
      'other',
    );
    assert.equal(missing.ok, false);

    const ok = buildResolveRequestBody(
      {
        decision: 'upheld',
        financial_action: 'refund_student_partial',
        refund_amount: '12.50',
        resolution_notes: 'Partial refund.',
      },
      'other',
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.body.refund_amount, 12.5);
  });

  it('builds confirmation lines, type hints, and formats API errors', () => {
    const lines = resolveConfirmationLines(
      {
        decision: 'rejected',
        outcome: 'student_no_show',
        financial_action: 'no_change',
        resolution_notes: 'Claim rejected.',
      },
      'coach_no_show_claim',
      { capturedAmount: 80 },
    );
    assert.ok(lines.some((l) => l.includes('Reject')));
    assert.ok(lines.some((l) => l.includes('Student no-show')));
    assert.ok(lines.some((l) => l.includes('No financial action')));
    assert.ok(lines.some((l) => l.includes('Coach payout: $73.60')));

    const partialLines = resolveConfirmationLines(
      {
        decision: 'upheld',
        outcome: 'coach_no_show',
        financial_action: 'refund_student_partial',
        refund_amount: 40,
      },
      'coach_no_show_claim',
      { capturedAmount: 80 },
    );
    assert.ok(partialLines.some((l) => l.includes('Student refund: $40.00')));
    assert.ok(partialLines.some((l) => l.includes('Coach payout: $36.80')));
    assert.ok(partialLines.some((l) => /not automatically refunded again/i.test(l)));

    assert.match(resolveFormHint('misconduct'), /Uphold must penalize/i);
    assert.match(resolveFormHint('misconduct'), /Financial action depends on which party is penalized/i);
    assert.doesNotMatch(resolveFormHint('misconduct'), /No financial action is allowed when a role is penalized/i);
    assert.match(resolveFormHint('other'), /no reliability penalty/i);
    assert.match(resolveFormHint('coach_no_show_claim'), /refund/i);

    assert.match(
      formatResolveApiError({ status: 409, code: 'refund_path_already_used', message: 'used' }),
      /refund path/i,
    );
    assert.match(
      formatResolveApiError({ status: 400, code: 'behavior_penalize_required', message: 'x' }),
      /Neither/i,
    );
    assert.match(
      formatResolveApiError({ status: 400, code: 'behavior_financial_penalize_mismatch', message: 'x' }),
      /penalizing the student/i,
    );
    assert.match(
      formatResolveApiError({ status: 400, code: 'attendance_rejected_outcome_aligns_with_claim', message: 'backend said' }),
      /backend said/,
    );
    assert.match(
      formatResolveApiError({ status: 400, code: 'catchall_rejected_financial', message: 'x' }),
      /no financial action/i,
    );
    assert.match(
      formatResolveApiError({ status: 400, code: 'unsupported_dispute_alignment_type', message: 'x' }),
      /cannot be resolved/i,
    );
    assert.equal(
      formatResolveApiError({ status: 400, payload: { current_status: 'resolved' }, message: 'x' }),
      'This dispute is already resolved.',
    );
  });
});
