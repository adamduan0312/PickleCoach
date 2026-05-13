import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDisputeResolutionPayload } from '../utils/disputeResolutionAlignment.js';

const ok = (p) => {
  const r = validateDisputeResolutionPayload(p);
  assert.equal(r.ok, true, r.ok === false ? r.message : '');
};

const bad = (p, code) => {
  const r = validateDisputeResolutionPayload(p);
  assert.equal(r.ok, false);
  assert.equal(r.code, code);
};

test('unknown or empty dispute type is blocked', () => {
  bad({}, 'unsupported_dispute_alignment_type');
  bad({ disputeTypeCode: '' }, 'unsupported_dispute_alignment_type');
  bad({ disputeTypeCode: null }, 'unsupported_dispute_alignment_type');
  bad(
    { disputeTypeCode: 'other_type', decision: 'upheld', financialAction: 'no_change' },
    'unsupported_dispute_alignment_type',
  );
});

test('attendance rejected: outcome required and must contradict claim; financial rules match outcome', () => {
  bad(
    {
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'rejected',
      outcome: null,
      financialAction: 'no_change',
      penalizeRole: undefined,
      openedBy: 'student',
    },
    'attendance_outcome_required',
  );
  ok({
    disputeTypeCode: 'coach_no_show_claim',
    decision: 'rejected',
    outcome: 'student_no_show',
    financialAction: 'no_change',
    openedBy: 'student',
  });
  bad(
    {
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'rejected',
      outcome: 'student_no_show',
      financialAction: 'refund_student',
      openedBy: 'student',
    },
    'attendance_financial_mismatch',
  );
  bad(
    {
      disputeTypeCode: 'student_no_show_claim',
      decision: 'rejected',
      outcome: undefined,
      financialAction: 'no_change',
      openedBy: 'coach',
    },
    'attendance_outcome_required',
  );
  ok({
    disputeTypeCode: 'student_no_show_claim',
    decision: 'rejected',
    outcome: 'coach_no_show',
    financialAction: 'refund_student',
    openedBy: 'coach',
  });
  bad(
    {
      disputeTypeCode: 'student_no_show_claim',
      decision: 'rejected',
      outcome: 'coach_no_show',
      financialAction: 'no_change',
      openedBy: 'coach',
    },
    'attendance_financial_mismatch',
  );
  bad(
    {
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'rejected',
      outcome: 'coach_no_show',
      financialAction: 'no_change',
      openedBy: 'student',
    },
    'attendance_rejected_outcome_aligns_with_claim',
  );
  bad(
    {
      disputeTypeCode: 'student_no_show_claim',
      decision: 'rejected',
      outcome: 'student_no_show',
      financialAction: 'refund_student',
      openedBy: 'coach',
    },
    'attendance_rejected_outcome_aligns_with_claim',
  );
});

test('attendance sustained requires outcome', () => {
  bad(
    {
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'upheld',
      outcome: null,
      financialAction: 'refund_student',
      openedBy: 'student',
    },
    'attendance_outcome_required',
  );
});

test('coach_no_show_claim: outcome vs financial_action', () => {
  bad(
    {
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'upheld',
      outcome: 'coach_no_show',
      financialAction: 'no_change',
      openedBy: 'student',
    },
    'attendance_financial_mismatch',
  );
  ok({
    disputeTypeCode: 'coach_no_show_claim',
    decision: 'partial',
    outcome: 'coach_no_show',
    financialAction: 'refund_student',
    openedBy: 'admin',
  });
  bad(
    {
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'upheld',
      outcome: 'student_no_show',
      financialAction: 'refund_student',
      openedBy: 'student',
    },
    'attendance_financial_mismatch',
  );
  ok({
    disputeTypeCode: 'coach_no_show_claim',
    decision: 'upheld',
    outcome: 'student_no_show',
    financialAction: 'no_change',
    openedBy: 'student',
  });
});

test('student_no_show_claim: outcome vs financial_action', () => {
  bad(
    {
      disputeTypeCode: 'student_no_show_claim',
      decision: 'upheld',
      outcome: 'student_no_show',
      financialAction: 'refund_student_partial',
      openedBy: 'coach',
    },
    'attendance_financial_mismatch',
  );
  ok({
    disputeTypeCode: 'student_no_show_claim',
    decision: 'upheld',
    outcome: 'student_no_show',
    financialAction: 'no_change',
    openedBy: 'coach',
  });
  bad(
    {
      disputeTypeCode: 'student_no_show_claim',
      decision: 'partial',
      outcome: 'coach_no_show',
      financialAction: 'no_change',
      openedBy: 'admin',
    },
    'attendance_financial_mismatch',
  );
  ok({
    disputeTypeCode: 'student_no_show_claim',
    decision: 'upheld',
    outcome: 'coach_no_show',
    financialAction: 'refund_student',
    openedBy: 'coach',
  });
});

test('behavior rejected', () => {
  ok({
    disputeTypeCode: 'misconduct',
    decision: 'rejected',
    outcome: undefined,
    financialAction: 'no_change',
    penalizeRole: 'none',
    openedBy: 'student',
  });
  bad(
    {
      disputeTypeCode: 'misconduct',
      decision: 'rejected',
      financialAction: 'refund_student',
      penalizeRole: 'none',
      openedBy: 'student',
    },
    'behavior_rejected_financial',
  );
  bad(
    {
      disputeTypeCode: 'late_arrival',
      decision: 'rejected',
      financialAction: 'no_change',
      penalizeRole: 'coach',
      openedBy: 'coach',
    },
    'behavior_rejected_penalize',
  );
});

test('behavior sustained: penalize and refunds', () => {
  bad(
    {
      disputeTypeCode: 'lesson_not_completed',
      decision: 'upheld',
      financialAction: 'no_change',
      penalizeRole: 'none',
      openedBy: 'student',
    },
    'behavior_penalize_required',
  );
  bad(
    {
      disputeTypeCode: 'misconduct',
      decision: 'partial',
      financialAction: 'refund_student',
      penalizeRole: 'student',
      openedBy: 'admin',
    },
    'behavior_financial_penalize_mismatch',
  );
  ok({
    disputeTypeCode: 'misconduct',
    decision: 'upheld',
    financialAction: 'refund_student',
    penalizeRole: 'coach',
    openedBy: 'student',
  });
});

test('behavior sustained: claimant can be penalized (reversible model, advisory only)', () => {
  ok({
    disputeTypeCode: 'misconduct',
    decision: 'upheld',
    financialAction: 'no_change',
    penalizeRole: 'student',
    openedBy: 'student',
  });
  ok({
    disputeTypeCode: 'misconduct',
    decision: 'partial',
    financialAction: 'no_change',
    penalizeRole: 'coach',
    openedBy: 'coach',
  });
  ok({
    disputeTypeCode: 'misconduct',
    decision: 'upheld',
    financialAction: 'no_change',
    penalizeRole: 'coach',
    openedBy: 'student',
  });
  ok({
    disputeTypeCode: 'misconduct',
    decision: 'upheld',
    financialAction: 'no_change',
    penalizeRole: 'student',
    openedBy: 'coach',
  });
  ok({
    disputeTypeCode: 'misconduct',
    decision: 'upheld',
    financialAction: 'refund_student',
    penalizeRole: 'coach',
    openedBy: 'admin',
  });
});

test('openedBy undefined accepted (no longer drives errors)', () => {
  ok({
    disputeTypeCode: 'misconduct',
    decision: 'upheld',
    financialAction: 'no_change',
    penalizeRole: 'student',
    openedBy: undefined,
  });
});
