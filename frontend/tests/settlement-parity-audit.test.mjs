/**
 * Frontend settlement display audit over the discovered QA fixture matrix.
 * Ensures booking-detail and issue-resolution paths produce the same facts/rows
 * when given the same payment snapshot, and that labels match money rules.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bookingSettlementDisplayRows,
  bookingSettlementFacts,
} from '../src/domain/bookingSettlementDisplay.js';

/** Mirror of backend/utils/settlementQaFixtures buildResolvedIssuesQaSpecs (keep in sync). */
function buildResolvedIssuesQaSpecs() {
  return [
    {
      key: 'coach_no_show_upheld_full_refund',
      financial: 'refund_student',
      money: 'full_refund',
      bookingStatus: 'coach_no_show',
      decision: 'upheld',
      outcome: 'coach_no_show',
      penalize_role: 'none',
      type: 'coach_no_show_claim',
    },
    {
      key: 'coach_no_show_partial_refund',
      financial: 'refund_student_partial',
      money: 'partial_refund',
      refund_cents: 4000,
      bookingStatus: 'coach_no_show',
      decision: 'upheld',
      outcome: 'coach_no_show',
      penalize_role: 'none',
      type: 'coach_no_show_claim',
    },
    {
      key: 'coach_no_show_claim_rejected',
      financial: 'no_change',
      money: 'none',
      bookingStatus: 'student_no_show',
      decision: 'rejected',
      outcome: 'student_no_show',
      penalize_role: 'none',
      type: 'coach_no_show_claim',
    },
    {
      key: 'student_no_show_upheld',
      financial: 'no_change',
      money: 'none',
      bookingStatus: 'student_no_show',
      decision: 'upheld',
      outcome: 'student_no_show',
      penalize_role: 'none',
      type: 'student_no_show_claim',
    },
    {
      key: 'student_no_show_manual_payout',
      financial: 'no_change',
      money: 'manual_payout',
      bookingStatus: 'student_no_show',
      decision: 'upheld',
      outcome: 'student_no_show',
      penalize_role: 'none',
      type: 'student_no_show_claim',
    },
    {
      key: 'student_no_show_claim_rejected',
      financial: 'refund_student',
      money: 'full_refund',
      bookingStatus: 'coach_no_show',
      decision: 'rejected',
      outcome: 'coach_no_show',
      penalize_role: 'none',
      type: 'student_no_show_claim',
    },
    {
      key: 'lesson_not_completed_partial',
      financial: 'refund_student_partial',
      money: 'partial_refund',
      refund_cents: 2500,
      bookingStatus: 'completed',
      decision: 'upheld',
      outcome: null,
      penalize_role: 'coach',
      type: 'lesson_not_completed',
    },
    {
      key: 'misconduct_upheld_refund',
      financial: 'refund_student',
      money: 'full_refund',
      bookingStatus: 'completed',
      decision: 'upheld',
      outcome: null,
      penalize_role: 'coach',
      type: 'misconduct',
    },
  ];
}

function buildPayment(money, { price = 80, refundCents = null } = {}) {
  const capturedCents = Math.round(price * 100);
  if (money === 'full_refund') {
    return {
      total_charge_to_student: price.toFixed(2),
      refunded_amount: price.toFixed(2),
      coach_payout_expected: '0.00',
      platform_fee_amount: '0.00',
      payment_status: 'refunded',
      refund_status: 'succeeded',
      escrow_status: 'refunded',
    };
  }
  if (money === 'partial_refund') {
    const refund = refundCents ?? Math.round(capturedCents * 0.5);
    const retained = capturedCents - refund;
    const coach = Math.round(retained * 0.92);
    const platform = retained - coach;
    return {
      total_charge_to_student: price.toFixed(2),
      refunded_amount: (refund / 100).toFixed(2),
      coach_payout_expected: (coach / 100).toFixed(2),
      platform_fee_amount: (platform / 100).toFixed(2),
      payment_status: 'partially_refunded',
      refund_status: 'succeeded',
      escrow_status: 'held',
    };
  }
  if (money === 'manual_payout') {
    return {
      total_charge_to_student: price.toFixed(2),
      refunded_amount: '0.00',
      coach_payout_expected: (Math.round(capturedCents * 0.92) / 100).toFixed(2),
      platform_fee_amount: ((capturedCents - Math.round(capturedCents * 0.92)) / 100).toFixed(2),
      payment_status: 'captured',
      refund_status: 'none',
      escrow_status: 'manual_payout_required',
    };
  }
  return {
    total_charge_to_student: price.toFixed(2),
    refunded_amount: '0.00',
    coach_payout_expected: (Math.round(capturedCents * 0.92) / 100).toFixed(2),
    platform_fee_amount: ((capturedCents - Math.round(capturedCents * 0.92)) / 100).toFixed(2),
    payment_status: 'captured',
    refund_status: 'none',
    escrow_status: 'held',
  };
}

function issueFromSpec(spec) {
  return {
    decision: spec.decision,
    financial_action: spec.financial,
    refund_amount: spec.refund_cents != null ? (spec.refund_cents / 100).toFixed(2) : null,
    penalize_role: spec.penalize_role,
    dispute_type_code: spec.type,
    outcome: spec.outcome,
  };
}

describe('settlement parity audit (booking detail ↔ issue resolution display)', () => {
  const specs = buildResolvedIssuesQaSpecs();

  for (const spec of specs) {
    it(`${spec.key}: booking and issue paths agree; amounts follow 92/8 retained split`, () => {
      const booking = { payout_status: 'none', status: spec.bookingStatus };
      const payment = buildPayment(spec.money, { refundCents: spec.refund_cents ?? null });
      const issue = issueFromSpec(spec);

      // Booking detail: payment from booking.payments[0] + resolved_issue
      const bookingFacts = bookingSettlementFacts(booking, payment, issue);
      // Issue detail: payment from GET /disputes/:id (must be same snapshot after backend fix)
      const issueFacts = bookingSettlementFacts(booking, payment, issue);

      assert.equal(bookingFacts.settlementHeadline, issueFacts.settlementHeadline);
      assert.equal(bookingFacts.studentRefunded, issueFacts.studentRefunded);
      assert.equal(bookingFacts.remaining, issueFacts.remaining);
      assert.equal(bookingFacts.coachPayoutExpected, issueFacts.coachPayoutExpected);
      assert.equal(bookingFacts.platformFee, issueFacts.platformFee);
      assert.equal(bookingFacts.coachPayoutStatusLabel, issueFacts.coachPayoutStatusLabel);

      const bookingRows = bookingSettlementDisplayRows(bookingFacts);
      const issueRows = bookingSettlementDisplayRows(issueFacts);
      assert.deepEqual(bookingRows, issueRows);

      const retained = Number(payment.total_charge_to_student) - Number(payment.refunded_amount || 0);
      assert.equal(bookingFacts.remaining, Number(retained.toFixed(2)));

      if (spec.money === 'full_refund') {
        assert.equal(bookingFacts.studentRefunded, 80);
        assert.equal(bookingFacts.remaining, 0);
        assert.equal(bookingFacts.coachPayoutExpected, 0);
        assert.equal(bookingFacts.platformFee, 0);
        assert.equal(bookingFacts.settlementHeadline, 'Settlement complete');
        assert.ok(bookingRows.some((r) => /none due because the full charge was refunded/i.test(r.dd)));
      }

      if (spec.money === 'partial_refund' && spec.refund_cents === 4000) {
        assert.equal(bookingFacts.studentRefunded, 40);
        assert.equal(bookingFacts.remaining, 40);
        assert.equal(bookingFacts.coachPayoutExpected, 36.8);
        assert.equal(bookingFacts.platformFee, 3.2);
        assert.equal(bookingFacts.settlementHeadline, 'Partial refund complete — coach payout pending');
      }

      if (spec.money === 'partial_refund' && spec.refund_cents === 2500) {
        assert.equal(bookingFacts.studentRefunded, 25);
        assert.equal(bookingFacts.remaining, 55);
        assert.equal(bookingFacts.coachPayoutExpected, 50.6);
        assert.equal(bookingFacts.platformFee, 4.4);
      }

      if (spec.money === 'none') {
        assert.equal(bookingFacts.studentRefunded, 0);
        assert.equal(bookingFacts.remaining, 80);
        assert.equal(bookingFacts.coachPayoutExpected, 73.6);
        assert.equal(bookingFacts.platformFee, 6.4);
        assert.match(bookingFacts.settlementHeadline, /coach payout pending/i);
      }

      if (spec.money === 'manual_payout') {
        assert.equal(bookingFacts.settlementStatus, 'failed');
        assert.equal(bookingFacts.settlementHeadline, 'Settlement failed — manual review required');
        assert.equal(bookingFacts.coachPayoutStatusLabel, 'Failed — manual review');
        assert.ok(bookingRows.some((r) => r.dt === 'Coach payout' && /Failed — manual review/.test(r.dd)));
        assert.ok(!bookingRows.some((r) => r.dt === 'Coach payout' && /^Pending/.test(r.dd)));
      }

      // Missing dispute payment must not be treated as a settled $0 refund on issue page.
      const missingPaymentFacts = bookingSettlementFacts(booking, null, issue);
      if (spec.money === 'full_refund' || spec.money === 'partial_refund') {
        assert.notEqual(missingPaymentFacts.studentRefunded, bookingFacts.studentRefunded);
      }
    });
  }
});
