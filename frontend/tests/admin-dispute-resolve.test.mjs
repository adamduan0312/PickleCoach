import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildResolveRequestBody,
  formatResolveApiError,
  isDisputeResolvable,
  resolveConfirmationLines,
  resolveFieldVisibility,
} from '../src/domain/adminDisputeResolve.js';

describe('admin dispute resolve helpers', () => {
  it('only marks open and under_review as resolvable', () => {
    assert.equal(isDisputeResolvable({ status: 'open', disputeType: { code: 'misconduct' } }), true);
    assert.equal(isDisputeResolvable({ status: 'under_review', disputeType: { code: 'other' } }), true);
    assert.equal(isDisputeResolvable({ status: 'resolved', disputeType: { code: 'misconduct' } }), false);
    assert.equal(isDisputeResolvable({ status: 'rejected', disputeType: { code: 'misconduct' } }), false);
  });

  it('shows structural fields by dispute type without encoding money matrix', () => {
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

  it('builds attendance payload without penalize_role', () => {
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

  it('builds behavior payload without outcome and requires notes', () => {
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
        financial_action: 'refund_student',
        resolution_notes: 'Sustained misconduct.',
      },
      'misconduct',
    );
    assert.equal(result.ok, true);
    assert.equal(result.body.penalize_role, 'coach');
    assert.equal('outcome' in result.body, false);
  });

  it('requires refund_amount only for partial refunds', () => {
    const missing = buildResolveRequestBody(
      {
        decision: 'partial',
        financial_action: 'refund_student_partial',
        resolution_notes: 'Partial refund.',
      },
      'other',
    );
    assert.equal(missing.ok, false);

    const ok = buildResolveRequestBody(
      {
        decision: 'partial',
        financial_action: 'refund_student_partial',
        refund_amount: '12.50',
        resolution_notes: 'Partial refund.',
      },
      'other',
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.body.refund_amount, 12.5);
  });

  it('builds confirmation lines and formats API errors', () => {
    const lines = resolveConfirmationLines(
      {
        decision: 'rejected',
        outcome: 'student_no_show',
        financial_action: 'no_change',
        resolution_notes: 'Claim rejected.',
      },
      'coach_no_show_claim',
    );
    assert.ok(lines.some((l) => l.includes('Reject')));
    assert.ok(lines.some((l) => l.includes('Student no-show')));
    assert.ok(lines.some((l) => l.includes('No financial action')));

    assert.match(
      formatResolveApiError({ status: 409, code: 'refund_path_already_used', message: 'used' }),
      /refund path/i,
    );
    assert.equal(
      formatResolveApiError({ status: 400, payload: { current_status: 'resolved' }, message: 'x' }),
      'This dispute is already resolved.',
    );
  });
});
