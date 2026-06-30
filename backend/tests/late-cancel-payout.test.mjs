/**
 * Student late-cancel retained revenue — coach payout eligibility and escrow math.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeEscrowCoachTransferCents,
  computeCoachEscrowPayoutFromPaymentSnapshot,
  resolveCaptureCoachPayoutCents,
} from '../services/paymentEngine.js';
import {
  isLateCancelRetainedRevenueEligible,
  isLateCancelRetainedRevenueEligibleFromHistory,
  isLateCancelRefundSettledForPayout,
  shouldQueueLateCancelCoachPayout,
  cancellationFinancialsForHistory,
  LATE_CANCELLATION_PENALTY_REASON,
  COACH_LATE_STUDENT_CANCEL_HELP_TEXT,
} from '../utils/lateCancelPayout.js';

describe('lateCancelPayout eligibility', () => {
  it('student late cancel with penalty is eligible', () => {
    assert.equal(
      isLateCancelRetainedRevenueEligible({
        bookingStatus: 'cancelled',
        cancelledBy: 'student',
        penaltyCents: 5400,
        penaltyReason: LATE_CANCELLATION_PENALTY_REASON,
      }),
      true,
    );
  });

  it('coach cancel and full-refund student cancel are not eligible', () => {
    assert.equal(
      isLateCancelRetainedRevenueEligible({
        bookingStatus: 'cancelled',
        cancelledBy: 'coach',
        penaltyCents: 5400,
        penaltyReason: LATE_CANCELLATION_PENALTY_REASON,
      }),
      false,
    );
    assert.equal(
      isLateCancelRetainedRevenueEligible({
        bookingStatus: 'cancelled',
        cancelledBy: 'student',
        penaltyCents: 0,
        penaltyReason: null,
      }),
      false,
    );
  });

  it('reads eligibility from cancellation_history row', () => {
    assert.equal(
      isLateCancelRetainedRevenueEligibleFromHistory({
        cancelled_by: 'student',
        penalty_amount: '54.00',
        penalty_reason: LATE_CANCELLATION_PENALTY_REASON,
      }),
      true,
    );
  });
});

describe('isLateCancelRefundSettledForPayout', () => {
  it('requires partially_refunded + refund_status succeeded', () => {
    assert.equal(
      isLateCancelRefundSettledForPayout({
        payment_status: 'partially_refunded',
        refund_status: 'succeeded',
        refunded_amount: '54.00',
      }),
      true,
    );
    assert.equal(
      isLateCancelRefundSettledForPayout({
        payment_status: 'captured',
        refund_status: 'none',
        refunded_amount: '0.00',
      }),
      false,
    );
    assert.equal(
      isLateCancelRefundSettledForPayout({
        payment_status: 'partially_refunded',
        refund_status: 'pending',
        refunded_amount: '54.00',
      }),
      false,
    );
  });
});

describe('COACH_LATE_STUDENT_CANCEL_HELP_TEXT', () => {
  it('includes 50% refund and coach compensation', () => {
    assert.match(COACH_LATE_STUDENT_CANCEL_HELP_TEXT, /50%/);
    assert.match(COACH_LATE_STUDENT_CANCEL_HELP_TEXT, /compensate the coach/i);
  });
});

describe('uncaptured authorize-only late cancel', () => {
  it('does not queue coach payout when PI was voided (no charge_id)', () => {
    assert.equal(
      shouldQueueLateCancelCoachPayout({
        bookingStatus: 'cancelled',
        cancelledBy: 'student',
        penaltyCents: 5400,
        penaltyReason: LATE_CANCELLATION_PENALTY_REASON,
        refundPaymentId: null,
        voidedPaymentId: 99,
      }),
      false,
    );
  });

  it('queues coach payout only when partial refund path runs on captured charge', () => {
    assert.equal(
      shouldQueueLateCancelCoachPayout({
        bookingStatus: 'cancelled',
        cancelledBy: 'student',
        penaltyCents: 5400,
        penaltyReason: LATE_CANCELLATION_PENALTY_REASON,
        refundPaymentId: 12,
        voidedPaymentId: null,
      }),
      true,
    );
  });

  it('cancellation_history financials are zero when authorization voided', () => {
    const fin = cancellationFinancialsForHistory({
      voidedPaymentId: 1,
      refund_amount: '54.00',
      penalty_amount: '54.00',
      penalty_reason: LATE_CANCELLATION_PENALTY_REASON,
    });
    assert.equal(fin.refund_amount, '0.00');
    assert.equal(fin.penalty_amount, '0.00');
    assert.equal(fin.penalty_reason, null);
  });
});

describe('late-cancel coach payout split (actual retained after refund)', () => {
  it('uses payment snapshot: net retained = charge − refunded, not full lesson coach share', () => {
    const fullCaptureCoach = resolveCaptureCoachPayoutCents(100);
    assert.equal(fullCaptureCoach, 9200);

    const { payoutCents, netRetainedCents, coachShareRatio } =
      computeCoachEscrowPayoutFromPaymentSnapshot({
        totalChargeToStudent: '108.00',
        refundedAmount: '54.00',
        lessonPrice: 100,
      });

    assert.equal(netRetainedCents, 5400);
    assert.equal(payoutCents, 4600);
    assert.equal(5400 - payoutCents, 800);
    assert.ok(payoutCents < fullCaptureCoach, 'must not pay full capture coach share after partial refund');
    assert.equal(payoutCents, Math.round(netRetainedCents * coachShareRatio));
  });

  it('regression: post-refund coach_payout_expected must not be used as ratio input (would underpay)', () => {
    const wrongRatioInput = 4600;
    const { payoutCents: wrongPayout } = computeEscrowCoachTransferCents({
      totalChargeCents: 10_800,
      refundedCents: 5400,
      coachPayoutExpectedCents: wrongRatioInput,
    });
    assert.equal(wrongPayout, 2300);
    assert.notEqual(wrongPayout, 4600);
  });

  it('regression: paying full capture coach share without subtracting refund would overpay', () => {
    const fullCaptureCoach = resolveCaptureCoachPayoutCents(100);
    const { payoutCents } = computeCoachEscrowPayoutFromPaymentSnapshot({
      totalChargeToStudent: '108.00',
      refundedAmount: '54.00',
      lessonPrice: 100,
    });
    assert.equal(payoutCents, 4600);
    assert.notEqual(payoutCents, fullCaptureCoach);
  });
});
