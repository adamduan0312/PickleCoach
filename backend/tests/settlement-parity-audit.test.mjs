/**
 * Settlement parity audit — discovers the QA fixture matrix and validates:
 * 1) Payment attrs match retained 92/8 allocation
 * 2) Booking-path vs dispute-path payment snapshots agree when linked
 * 3) getDisputeById prefers booking payment over optional dispute_id association
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  buildResolvedIssuesQaSpecs,
  buildSettlementQaPaymentAttrs,
  diffSettlementPaymentFields,
  expectedSettlementCentsFromPayment,
} from '../utils/settlementQaFixtures.js';
import { computeCoachEscrowPayoutFromPaymentSnapshot } from '../services/paymentEngine.js';
import { formatDisputeResponse } from '../utils/disputeDto.js';
import { serializePaymentSummary } from '../utils/paymentDto.js';

describe('settlement parity audit (fixture matrix)', () => {
  const specs = buildResolvedIssuesQaSpecs();

  it('discovers full/partial/none/manual_payout and attendance variants', () => {
    assert.ok(specs.length >= 13);
    const keys = new Set(specs.map((s) => s.key));
    assert.ok(keys.has('coach_no_show_upheld_full_refund'));
    assert.ok(keys.has('coach_no_show_partial_refund'));
    assert.ok(keys.has('student_no_show_upheld'));
    assert.ok(keys.has('student_no_show_manual_payout'));
    assert.ok(keys.has('lesson_not_completed_partial'));
    assert.equal(specs.filter((s) => s.money === 'full_refund').length >= 3, true);
    assert.equal(specs.filter((s) => s.money === 'partial_refund').length >= 2, true);
    assert.equal(specs.filter((s) => s.money === 'none').length >= 4, true);
    assert.equal(specs.filter((s) => s.money === 'manual_payout').length, 1);
  });

  for (const spec of specs) {
    it(`allocation + DTO parity: ${spec.key}`, () => {
      const booking = {
        id: 1000 + specs.indexOf(spec),
        coach_id: 7,
        primary_student_id: 2,
        price: '80.00',
        status: spec.bookingStatus,
        payout_status: 'none',
      };
      const paymentAttrs = buildSettlementQaPaymentAttrs(booking, spec.money, {
        refundCents: spec.refund_cents ?? null,
      });
      const expected = expectedSettlementCentsFromPayment(paymentAttrs);
      const escrow = computeCoachEscrowPayoutFromPaymentSnapshot({
        totalChargeToStudent: paymentAttrs.total_charge_to_student,
        refundedAmount: paymentAttrs.refunded_amount ?? 0,
        lessonPrice: paymentAttrs.lesson_price,
      });

      assert.equal(escrow.netRetainedCents, expected.retainedCents, 'retained');
      assert.equal(escrow.payoutCents, expected.coachPayoutCents, 'coach');
      assert.equal(
        expected.retainedCents - expected.coachPayoutCents,
        expected.platformFeeCents,
        'platform',
      );

      if (spec.money === 'full_refund') {
        assert.equal(expected.refundedCents, expected.capturedCents);
        assert.equal(expected.retainedCents, 0);
        assert.equal(expected.coachPayoutCents, 0);
        assert.equal(expected.platformFeeCents, 0);
      }
      if (spec.money === 'partial_refund' && spec.refund_cents) {
        assert.equal(expected.refundedCents, spec.refund_cents);
      }
      if (spec.money === 'manual_payout') {
        assert.equal(paymentAttrs.escrow_status, 'manual_payout_required');
      }

      // Booking detail uses booking.payments[0]; dispute detail must serialize the same snapshot.
      const bookingPaymentDto = serializePaymentSummary(paymentAttrs, { isAdmin: false });
      const linkedDisputePaymentDto = serializePaymentSummary(
        { ...paymentAttrs, dispute_id: 55 },
        { isAdmin: false },
      );
      const mismatches = diffSettlementPaymentFields(
        bookingPaymentDto,
        linkedDisputePaymentDto,
        { label: `${spec.key}: ` },
      );
      assert.deepEqual(mismatches, []);

      const disputeDto = formatDisputeResponse({
        id: 55,
        booking_id: booking.id,
        dispute_type_id: 1,
        notes: null,
        opened_by: spec.opened_by,
        status: 'resolved',
        decision: spec.decision,
        outcome: spec.outcome,
        penalize_role: spec.penalize_role,
        refund_cents: spec.refund_cents ?? null,
        resolution_notes: null,
        admin_id: 1,
        admin: { id: 1, full_name: 'Admin' },
        resolved_at: '2026-01-02T00:00:00.000Z',
        opened_at: '2026-01-01T00:00:00.000Z',
        booking,
        payment: paymentAttrs,
        resolutionAction: {
          id: 1,
          code:
            spec.financial === 'refund_student'
              ? 'approved_refund'
              : spec.financial === 'refund_student_partial'
                ? 'partial_refund'
                : 'no_action',
          name: 'x',
          description: 'x',
        },
        disputeType: { id: 1, code: spec.type, name: spec.type, description: '' },
      });

      assert.equal(disputeDto.financial_action, spec.financial);
      assert.ok(disputeDto.payment);
      assert.equal(
        String(disputeDto.payment.refunded_amount ?? '0.00'),
        String(paymentAttrs.refunded_amount ?? '0.00'),
      );
      assert.equal(disputeDto.payment.payment_status, paymentAttrs.payment_status);
      assert.equal(disputeDto.payment.escrow_status, paymentAttrs.escrow_status);

      // Unlinked payment association → empty dispute payment is a known mismatch pattern.
      if (spec.money !== 'none' && spec.money !== 'manual_payout') {
        const missing = diffSettlementPaymentFields(bookingPaymentDto, null, {
          label: `${spec.key} unlinked: `,
        });
        assert.ok(missing.some((m) => /dispute payment missing/i.test(m)));
      }
    });
  }

  it('getDisputeById loads booking payment when dispute_id association is missing', () => {
    const src = readFileSync(new URL('../controllers/disputeController.js', import.meta.url), 'utf8');
    const start = src.indexOf('export const getDisputeById');
    const section = src.slice(start, start + 2200);
    assert.match(section, /Payment\.findOne/);
    assert.match(section, /booking_id: dispute\.booking_id/);
    assert.match(section, /setDataValue\('payment'/);
  });

  it('seed:resolved-issues-qa links payments.dispute_id', () => {
    const src = readFileSync(new URL('../scripts/seed-resolved-issues-qa.js', import.meta.url), 'utf8');
    assert.match(src, /payment\.update\(\{\s*dispute_id:\s*dispute\.id/);
    assert.match(src, /buildResolvedIssuesQaSpecs/);
  });
});
