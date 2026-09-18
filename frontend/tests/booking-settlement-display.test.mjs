import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateRetainedAfterRefundCents,
  bookingSettlementDisplayRows,
  bookingSettlementFacts,
  previewFinancialAllocation,
} from '../src/domain/bookingSettlementDisplay.js';

describe('bookingSettlementDisplay', () => {
  it('$80 / $40 partial allocates coach $36.80 and platform $3.20', () => {
    const split = allocateRetainedAfterRefundCents({
      capturedCents: 8000,
      studentRefundCents: 4000,
    });
    assert.equal(split.retainedCents, 4000);
    assert.equal(split.coachPayoutCents, 3680);
    assert.equal(split.platformFeeCents, 320);
  });

  it('preview full refund zeros coach and platform', () => {
    const preview = previewFinancialAllocation({
      capturedAmount: 80,
      financialAction: 'refund_student',
    });
    assert.equal(preview.studentRefund, 80);
    assert.equal(preview.remaining, 0);
    assert.equal(preview.coachPayout, 0);
    assert.equal(preview.platformFee, 0);
  });

  it('preview partial refund does not imply full refund', () => {
    const preview = previewFinancialAllocation({
      capturedAmount: '80.00',
      financialAction: 'refund_student_partial',
      refundAmount: '40',
    });
    assert.equal(preview.studentRefund, 40);
    assert.equal(preview.remaining, 40);
    assert.equal(preview.coachPayout, 36.8);
    assert.equal(preview.platformFee, 3.2);
    assert.ok(preview.lines.every((l) => !/full refund/i.test(l)));
  });

  it('ignores stale capture fee / remaining-as-coach payment fields after partial refund', () => {
    const facts = bookingSettlementFacts(
      { payout_status: 'pending', status: 'coach_no_show' },
      {
        total_charge_to_student: '80.00',
        refunded_amount: '40.00',
        // Stale capture-time fee + wrong "remaining = coach" seed (the UI bug).
        platform_fee_amount: '6.40',
        coach_payout_expected: '40.00',
        payment_status: 'partially_refunded',
        refund_status: 'succeeded',
        escrow_status: 'held',
      },
      {
        decision: 'upheld',
        financial_action: 'refund_student_partial',
        refund_amount: '40.00',
        penalize_role: 'none',
        dispute_type_code: 'coach_no_show_claim',
        outcome: 'coach_no_show',
      },
    );

    assert.equal(facts.coachPayoutExpected, 36.8);
    assert.equal(facts.platformFee, 3.2);
    assert.equal(facts.remaining, 40);
    assert.equal(facts.settlementHeadline, 'Partial refund complete — coach payout pending');
    assert.ok(!/refund pending/i.test(facts.settlementHeadline));

    const rows = bookingSettlementDisplayRows(facts);
    assert.ok(rows.some((r) => r.dt === 'Initial student refund' && r.dd.includes('40')));
    assert.ok(rows.some((r) => r.dt === 'Student refunded total' && r.dd === 'Complete — $40.00'));
    assert.ok(rows.some((r) => r.dt === 'Amount retained after student refund' && r.dd.includes('40')));
    assert.ok(rows.some((r) => r.dt === 'Coach payout' && r.dd === 'Pending — $36.80 expected'));
    assert.ok(rows.some((r) => r.dt === 'Platform fee' && r.dd === 'Pending — $3.20 expected'));
    assert.ok(!rows.some((r) => r.dt === 'Coach payout' && r.dd.includes('$40.00') && !r.dd.includes('36.80')));
    assert.ok(!rows.some((r) => r.dt === 'Platform fee' && r.dd.includes('6.40')));
  });

  it('full refund shows $0 coach/fee and clarifies none due because charge refunded', () => {
    const facts = bookingSettlementFacts(
      { payout_status: 'none', status: 'coach_no_show' },
      {
        total_charge_to_student: '80.00',
        refunded_amount: '80.00',
        platform_fee_amount: '6.40',
        coach_payout_expected: '0.00',
        payment_status: 'refunded',
        refund_status: 'succeeded',
        escrow_status: 'refunded',
      },
      {
        decision: 'upheld',
        financial_action: 'refund_student',
        refund_amount: null,
        dispute_type_code: 'coach_no_show_claim',
        outcome: 'coach_no_show',
      },
    );

    assert.equal(facts.coachPayoutExpected, 0);
    assert.equal(facts.platformFee, 0);
    assert.equal(facts.settlementHeadline, 'Settlement complete');
    assert.equal(facts.fullRefundDone, true);

    const rows = bookingSettlementDisplayRows(facts);
    assert.ok(!rows.some((r) => r.dt === 'Initial student refund'));
    assert.ok(rows.some((r) => r.dt === 'Student refunded total' && r.dd === 'Complete — $80.00'));
    assert.ok(rows.some((r) => r.dt === 'Amount retained after student refund' && r.dd.includes('$0.00')));
    assert.ok(rows.some((r) => (
      r.dt === 'Coach payout'
      && r.dd.includes('$0.00')
      && /none due because the full charge was refunded/i.test(r.dd)
    )));
    assert.ok(rows.some((r) => r.dt === 'Platform fee' && r.dd.includes('$0.00')));
    assert.ok(!rows.some((r) => r.dt === 'Platform fee' && r.dd.includes('6.40')));
  });

  it('null payment does not invent a $0 refunded settlement (resolution page parity)', () => {
    const facts = bookingSettlementFacts(
      { payout_status: 'none', status: 'coach_no_show' },
      null,
      {
        decision: 'upheld',
        financial_action: 'refund_student',
        refund_amount: null,
      },
    );
    assert.equal(facts.studentRefunded, 0);
    assert.equal(facts.remaining, null);
    assert.equal(facts.coachPayoutExpected, null);
    assert.equal(facts.platformFee, null);
  });

  it('no-refund student no-show shows full retained allocation and pending payout', () => {
    const facts = bookingSettlementFacts(
      { payout_status: 'none', status: 'student_no_show' },
      {
        total_charge_to_student: '80.00',
        refunded_amount: '0.00',
        platform_fee_amount: '6.40',
        coach_payout_expected: '73.60',
        payment_status: 'captured',
        refund_status: 'none',
        escrow_status: 'held',
      },
      {
        decision: 'upheld',
        financial_action: 'no_change',
        penalize_role: 'none',
        dispute_type_code: 'student_no_show_claim',
        outcome: 'student_no_show',
      },
    );
    assert.equal(facts.settlementHeadline, 'Coach payout pending');
    assert.equal(facts.remaining, 80);
    assert.equal(facts.coachPayoutExpected, 73.6);
    assert.equal(facts.platformFee, 6.4);

    const rows = bookingSettlementDisplayRows(facts);
    assert.ok(rows.some((r) => r.dt === 'Student refunded total' && r.dd.includes('$0.00')));
    assert.ok(rows.some((r) => r.dt === 'Amount retained after student refund' && r.dd.includes('80')));
    assert.ok(rows.some((r) => r.dt === 'Coach payout' && r.dd === 'Pending — $73.60 expected'));
    assert.ok(rows.some((r) => r.dt === 'Platform fee' && r.dd === 'Pending — $6.40 expected'));
  });

  it('manual_payout_required shows failed payout, not merely pending', () => {
    const facts = bookingSettlementFacts(
      { payout_status: 'none', status: 'student_no_show' },
      {
        total_charge_to_student: '80.00',
        refunded_amount: 0,
        platform_fee_amount: '6.40',
        coach_payout_expected: '73.60',
        payment_status: 'captured',
        refund_status: 'none',
        escrow_status: 'manual_payout_required',
      },
    );
    assert.equal(facts.settlementHeadline, 'Settlement failed — manual review required');
    assert.equal(facts.settlementStatus, 'failed');
    assert.equal(facts.coachPayoutStatusLabel, 'Failed — manual review');

    const rows = bookingSettlementDisplayRows(facts);
    assert.ok(rows.some((r) => (
      r.dt === 'Coach payout'
      && /Failed — manual review/.test(r.dd)
      && r.dd.includes('73.60')
    )));
    assert.ok(rows.some((r) => r.dt === 'Platform fee' && /6\.40.*retained/.test(r.dd)));
    assert.ok(!rows.some((r) => r.dt === 'Coach payout' && /^Pending/.test(r.dd)));
  });

  it('pending Stripe refund does not claim refund complete while amount is known', () => {
    const facts = bookingSettlementFacts(
      { payout_status: 'none', status: 'coach_no_show' },
      {
        total_charge_to_student: '80.00',
        refunded_amount: '40.00',
        platform_fee_amount: '3.20',
        coach_payout_expected: '36.80',
        payment_status: 'partially_refunded',
        refund_status: 'pending',
        escrow_status: 'held',
      },
      {
        financial_action: 'refund_student_partial',
        refund_amount: '40.00',
      },
    );
    assert.equal(facts.settlementHeadline, 'Student refund pending');
    const rows = bookingSettlementDisplayRows(facts);
    assert.ok(rows.some((r) => r.dt === 'Student refunded total' && r.dd === 'Pending — $40.00'));
    assert.ok(rows.some((r) => r.dt === 'Coach payout' && /Not yet due until refund settlement/.test(r.dd)));
  });
});
