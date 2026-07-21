import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBehaviorDisputeCode,
  getBehaviorResolutionDirectionWarning,
  getAttendanceClaimReversalWarning,
  getBehaviorClaimReversalWarning,
} from '../utils/disputeResolutionWarnings.js';

test('isBehaviorDisputeCode', () => {
  assert.equal(isBehaviorDisputeCode('misconduct'), true);
  assert.equal(isBehaviorDisputeCode('coach_no_show_claim'), false);
});

test('returns ambiguity warning for admin-opened sustained behavior disputes', () => {
  const warning = getBehaviorResolutionDirectionWarning({
    disputeTypeCode: 'lesson_not_completed',
    decision: 'upheld',
    penalizeRole: 'coach',
    openedBy: 'admin',
  });

  assert.equal(warning?.code, 'behavior_resolution_direction_ambiguous');
  assert.equal(warning?.advisory, true);
  assert.match(warning?.message ?? '', /opened by admin/i);
});

test('no ambiguity warning for student/coach opener (only admin opener triggers it)', () => {
  assert.equal(
    getBehaviorResolutionDirectionWarning({
      disputeTypeCode: 'misconduct',
      decision: 'upheld',
      penalizeRole: 'coach',
      openedBy: 'student',
    }),
    null,
  );
  assert.equal(
    getBehaviorResolutionDirectionWarning({
      disputeTypeCode: 'misconduct',
      decision: 'upheld',
      penalizeRole: 'student',
      openedBy: 'coach',
    }),
    null,
  );
});

test('behavior claim reversal advisory (student opener penalized as student)', () => {
  const w = getBehaviorClaimReversalWarning({
    disputeTypeCode: 'misconduct',
    decision: 'upheld',
    penalizeRole: 'student',
    openedBy: 'student',
  });
  assert.equal(w?.code, 'behavior_claim_reversal');
  assert.equal(w?.advisory, true);
  assert.match(w?.message ?? '', /penalizes the dispute claimant/i);
});

test('behavior claim reversal advisory (coach opener penalized as coach)', () => {
  const w = getBehaviorClaimReversalWarning({
    disputeTypeCode: 'lesson_not_completed',
    decision: 'partial',
    penalizeRole: 'coach',
    openedBy: 'coach',
  });
  assert.equal(w?.code, 'behavior_claim_reversal');
});

test('no behavior reversal warning when opener and penalize differ, or for admin/rejected', () => {
  assert.equal(
    getBehaviorClaimReversalWarning({
      disputeTypeCode: 'misconduct',
      decision: 'upheld',
      penalizeRole: 'coach',
      openedBy: 'student',
    }),
    null,
  );
  assert.equal(
    getBehaviorClaimReversalWarning({
      disputeTypeCode: 'misconduct',
      decision: 'upheld',
      penalizeRole: 'student',
      openedBy: 'admin',
    }),
    null,
  );
  assert.equal(
    getBehaviorClaimReversalWarning({
      disputeTypeCode: 'misconduct',
      decision: 'rejected',
      penalizeRole: 'none',
      openedBy: 'student',
    }),
    null,
  );
  assert.equal(
    getBehaviorClaimReversalWarning({
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'upheld',
      penalizeRole: 'student',
      openedBy: 'student',
    }),
    null,
  );
});

test('no warning for rejected, non-behavior, or invalid penalize', () => {
  assert.equal(
    getBehaviorResolutionDirectionWarning({
      disputeTypeCode: 'lesson_not_completed',
      decision: 'rejected',
      penalizeRole: 'none',
      openedBy: 'admin',
    }),
    null,
  );
  assert.equal(
    getBehaviorResolutionDirectionWarning({
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'upheld',
      penalizeRole: 'coach',
      openedBy: 'admin',
    }),
    null,
  );
});

test('attendance claim reversal advisory (student + student_no_show on coach_no_show_claim)', () => {
  const w = getAttendanceClaimReversalWarning({
    disputeTypeCode: 'coach_no_show_claim',
    decision: 'upheld',
    outcome: 'student_no_show',
    openedBy: 'student',
  });
  assert.equal(w?.code, 'attendance_claim_reversal');
  assert.equal(w?.advisory, true);
  assert.match(w?.message ?? '', /student opened a coach no-show claim/i);
});

test('attendance claim reversal advisory (coach + coach_no_show on student_no_show_claim)', () => {
  const w = getAttendanceClaimReversalWarning({
    disputeTypeCode: 'student_no_show_claim',
    decision: 'partial',
    outcome: 'coach_no_show',
    openedBy: 'coach',
  });
  assert.equal(w?.code, 'attendance_claim_reversal');
  assert.match(w?.message ?? '', /coach opened a student no-show claim/i);
});

test('attendance claim reversal advisory (rejected + contradicting outcome)', () => {
  const w = getAttendanceClaimReversalWarning({
    disputeTypeCode: 'coach_no_show_claim',
    decision: 'rejected',
    outcome: 'student_no_show',
    openedBy: 'student',
  });
  assert.equal(w?.code, 'attendance_claim_reversal');
  assert.match(w?.message ?? '', /student opened a coach no-show claim/i);
});

test('attendance claim reversal advisory (rejected + coach_no_show on student_no_show_claim)', () => {
  const w = getAttendanceClaimReversalWarning({
    disputeTypeCode: 'student_no_show_claim',
    decision: 'rejected',
    outcome: 'coach_no_show',
    openedBy: 'coach',
  });
  assert.equal(w?.code, 'attendance_claim_reversal');
  assert.match(w?.message ?? '', /coach opened a student no-show claim/i);
});

test('no attendance reversal warning when outcome aligns with claim or opener is admin', () => {
  assert.equal(
    getAttendanceClaimReversalWarning({
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'upheld',
      outcome: 'coach_no_show',
      openedBy: 'student',
    }),
    null,
  );
  assert.equal(
    getAttendanceClaimReversalWarning({
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'upheld',
      outcome: 'student_no_show',
      openedBy: 'admin',
    }),
    null,
  );
  assert.equal(
    getAttendanceClaimReversalWarning({
      disputeTypeCode: 'coach_no_show_claim',
      decision: 'rejected',
      outcome: null,
      openedBy: 'student',
    }),
    null,
  );
});
