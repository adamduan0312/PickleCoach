import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adminNotesText,
  attendanceFindingLabel,
  attendanceReliabilityLabel,
  coachPayoutLabel,
  decisionLabel,
  financialOutcomeLabel,
  isAttendanceIssueType,
  isSeedOrDebugResolutionNotes,
  issueResolutionFacts,
  reliabilityLabel,
  resolveFinancialAction,
} from '../src/domain/issueResolutionDisplay.js';

describe('issueResolutionDisplay', () => {
  it('labels decisions as Upheld / Not upheld', () => {
    assert.equal(decisionLabel('upheld'), 'Upheld');
    assert.equal(decisionLabel('rejected'), 'Not upheld');
    assert.equal(decisionLabel('partial'), null);
  });

  it('uses financial_action for full vs partial (never treats amount alone as Full refund)', () => {
    assert.equal(
      financialOutcomeLabel({ financial_action: 'refund_student', refund_amount: '80.00' }),
      'Full refund',
    );
    assert.match(
      financialOutcomeLabel({
        financial_action: 'refund_student_partial',
        refund_amount: '40.00',
      }),
      /^Partial refund of/,
    );
    assert.ok(
      financialOutcomeLabel({
        financial_action: 'refund_student_partial',
        refund_amount: '40.00',
      }).includes('40'),
    );
    assert.equal(
      financialOutcomeLabel({ financial_action: 'no_change', refund_amount: null }),
      'No refund',
    );
    // Ambiguous positive amount without action must not say Full refund
    const ambiguous = financialOutcomeLabel({ refund_amount: '40.00' });
    assert.match(ambiguous, /^Partial refund of/);
    assert.ok(!ambiguous.toLowerCase().includes('full'));
  });

  it('maps resolution action codes when financial_action is absent', () => {
    assert.equal(
      resolveFinancialAction({ resolutionAction: { code: 'approved_refund' } }),
      'refund_student',
    );
    assert.equal(
      resolveFinancialAction({ resolutionAction: { code: 'partial_refund' } }),
      'refund_student_partial',
    );
    assert.equal(
      resolveFinancialAction({ resolution_action: { code: 'no_action' } }),
      'no_change',
    );
  });

  it('labels attendance findings only from outcome values', () => {
    assert.equal(attendanceFindingLabel('lesson_occurred'), 'Lesson occurred');
    assert.equal(attendanceFindingLabel('coach_no_show'), 'Coach no-show');
    assert.equal(attendanceFindingLabel('student_no_show'), 'Student no-show');
  });

  it('labels behavior reliability for coach, student, and none', () => {
    assert.equal(reliabilityLabel('coach'), 'Coach penalized');
    assert.equal(reliabilityLabel('student'), 'Student penalized');
    assert.equal(reliabilityLabel('none'), 'No reliability penalty');
    assert.equal(reliabilityLabel(null), 'No reliability penalty');
  });

  it('labels attendance reliability from finding, not penalize_role', () => {
    assert.equal(
      attendanceReliabilityLabel('coach_no_show'),
      'Coach no-show recorded for reliability',
    );
    assert.equal(
      attendanceReliabilityLabel('student_no_show'),
      'Student no-show recorded for reliability',
    );
    assert.equal(attendanceReliabilityLabel('lesson_occurred'), null);
    assert.equal(attendanceReliabilityLabel(null), null);
    assert.equal(attendanceReliabilityLabel('unknown'), null);
  });

  it('hides seed/debug notes from Admin notes', () => {
    assert.equal(isSeedOrDebugResolutionNotes('Seeded upheld / refund_student'), true);
    assert.equal(adminNotesText({ resolution_notes: 'Seeded upheld / refund_student' }), null);
    assert.equal(
      adminNotesText({ resolution_notes: 'Coach arrived 40 minutes late; partial refund applied.' }),
      'Coach arrived 40 minutes late; partial refund applied.',
    );
  });

  it('does not show attendance findings for behavior/other disputes', () => {
    const other = issueResolutionFacts({
      decision: 'upheld',
      financial_action: 'refund_student',
      penalize_role: 'none',
      outcome: 'coach_no_show',
      dispute_type_code: 'other',
    });
    assert.equal(other.decision, 'Upheld');
    assert.equal(other.financial, 'Full refund');
    assert.equal(other.reliability, 'No reliability penalty');
    assert.equal(other.attendance, null);
    assert.equal(isAttendanceIssueType('misconduct'), false);
    assert.equal(isAttendanceIssueType('coach_no_show_claim'), true);
  });

  it('coach no-show attendance resolution derives reliability from finding', () => {
    const facts = issueResolutionFacts({
      decision: 'upheld',
      financial_action: 'refund_student',
      penalize_role: 'none',
      outcome: 'coach_no_show',
      dispute_type_code: 'coach_no_show_claim',
    });
    assert.equal(facts.attendance, 'Coach no-show');
    assert.equal(facts.reliability, 'Coach no-show recorded for reliability');
    assert.ok(!/no reliability penalty/i.test(facts.reliability));
  });

  it('student no-show attendance resolution derives reliability from finding', () => {
    const facts = issueResolutionFacts({
      decision: 'upheld',
      financial_action: 'no_change',
      penalize_role: 'none',
      outcome: 'student_no_show',
      disputeType: { code: 'student_no_show_claim' },
    });
    assert.equal(facts.attendance, 'Student no-show');
    assert.equal(facts.reliability, 'Student no-show recorded for reliability');
  });

  it('omits reliability line when attendance finding is lesson_occurred or unknown', () => {
    const lessonOccurred = issueResolutionFacts({
      decision: 'rejected',
      financial_action: 'no_change',
      penalize_role: 'none',
      outcome: 'lesson_occurred',
      disputeType: { code: 'coach_no_show_claim' },
    });
    assert.equal(lessonOccurred.attendance, 'Lesson occurred');
    assert.equal(lessonOccurred.reliability, null);

    const missing = issueResolutionFacts({
      decision: 'upheld',
      financial_action: 'refund_student',
      penalize_role: 'none',
      outcome: null,
      dispute_type_code: 'coach_no_show_claim',
    });
    assert.equal(missing.attendance, null);
    assert.equal(missing.reliability, null);
  });

  it('behavior dispute reliability follows penalize_role', () => {
    const coach = issueResolutionFacts({
      decision: 'upheld',
      financial_action: 'no_change',
      penalize_role: 'coach',
      dispute_type_code: 'misconduct',
    });
    assert.equal(coach.reliability, 'Coach penalized');
    assert.equal(coach.attendance, null);

    const student = issueResolutionFacts({
      decision: 'upheld',
      financial_action: 'no_change',
      penalize_role: 'student',
      dispute_type_code: 'misconduct',
    });
    assert.equal(student.reliability, 'Student penalized');

    const neither = issueResolutionFacts({
      decision: 'rejected',
      financial_action: 'no_change',
      penalize_role: 'none',
      dispute_type_code: 'lesson_not_completed',
    });
    assert.equal(neither.reliability, 'No reliability penalty');
  });

  it('labels coach payout separately as None due / Pending / Paid / Failed', () => {
    assert.equal(
      coachPayoutLabel({ payout_status: 'none' }, { payment_status: 'refunded' }),
      'None due',
    );
    assert.equal(
      coachPayoutLabel(
        { payout_status: 'none' },
        { payment_status: 'partially_refunded', coach_payout_expected: '36.80' },
      ),
      'Pending',
    );
    assert.equal(
      coachPayoutLabel(
        { payout_status: 'none' },
        { payment_status: 'partially_refunded', coach_payout_expected: 0 },
      ),
      'None due',
    );
    assert.equal(
      coachPayoutLabel({ payout_status: 'pending' }, { payment_status: 'captured' }),
      'Pending',
    );
    assert.equal(
      coachPayoutLabel({ payout_status: 'paid' }, { payment_status: 'captured' }),
      'Paid',
    );
    assert.equal(
      coachPayoutLabel(
        { payout_status: 'none' },
        { payment_status: 'captured', escrow_status: 'manual_payout_required', coach_payout_expected: '73.60' },
      ),
      'Failed — manual review',
    );
  });
});
