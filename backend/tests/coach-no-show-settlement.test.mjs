import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  shouldRetainCoachNoShowRemainderForPayout,
  isDisputePartialRefundSettledForPayout,
} from '../utils/coachNoShowSettlement.js';
import { computeCoachEscrowPayoutFromPaymentSnapshot } from '../services/paymentEngine.js';

describe('coachNoShowSettlement', () => {
  it('retains remainder for payout when dispute partial action or resolution exists', () => {
    assert.equal(
      shouldRetainCoachNoShowRemainderForPayout({
        hasDisputePartialPaymentAction: true,
      }),
      true,
    );
    assert.equal(
      shouldRetainCoachNoShowRemainderForPayout({
        resolutionActionCode: 'partial_refund',
      }),
      true,
    );
    assert.equal(
      shouldRetainCoachNoShowRemainderForPayout({
        resolutionActionCode: 'approved_refund',
      }),
      false,
    );
    assert.equal(
      shouldRetainCoachNoShowRemainderForPayout({}),
      false,
    );
  });

  it('partial refund settlement gate matches late-cancel retained gate', () => {
    assert.equal(
      isDisputePartialRefundSettledForPayout({
        payment_status: 'partially_refunded',
        refund_status: 'succeeded',
        refunded_amount: '40.00',
      }),
      true,
    );
    assert.equal(
      isDisputePartialRefundSettledForPayout({
        payment_status: 'captured',
        refund_status: 'succeeded',
        refunded_amount: '40.00',
      }),
      false,
    );
  });

  it('$80 booking with $40 partial → coach $36.80 platform $3.20', () => {
    const { payoutCents, netRetainedCents } = computeCoachEscrowPayoutFromPaymentSnapshot({
      totalChargeToStudent: '80.00',
      refundedAmount: '40.00',
      lessonPrice: '80.00',
    });
    assert.equal(netRetainedCents, 4000);
    assert.equal(payoutCents, 3680);
    // platform = retained - coach
    assert.equal(netRetainedCents - payoutCents, 320);
  });

  it('full refund leaves $0 coach payout and $0 retained platform fee', () => {
    const { payoutCents, netRetainedCents } = computeCoachEscrowPayoutFromPaymentSnapshot({
      totalChargeToStudent: '80.00',
      refundedAmount: '80.00',
      lessonPrice: '80.00',
    });
    assert.equal(netRetainedCents, 0);
    assert.equal(payoutCents, 0);
  });

  it('paymentService skips auto remaining refund when dispute partial retains for payout', () => {
    const src = readFileSync(new URL('../services/paymentService.js', import.meta.url), 'utf8');
    const start = src.indexOf('export const enqueueCoachNoShowRefundIfEligible');
    assert.ok(start >= 0);
    const section = src.slice(start, start + 2500);
    assert.match(section, /hasCoachNoShowRetainedPayoutIntent/);
    assert.match(section, /dispute_partial_retains_for_payout/);
  });

  it('payoutWorker only pays coach_no_show when retained partial intent exists', () => {
    const src = readFileSync(new URL('../workers/payoutWorker.js', import.meta.url), 'utf8');
    assert.match(src, /hasCoachNoShowRetainedPayoutIntent/);
    assert.match(src, /coach_no_show_auto_refund_path/);
    assert.match(src, /isDisputePartialRefundSettledForPayout/);
  });
});

