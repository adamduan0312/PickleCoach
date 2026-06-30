/**
 * Pure payment math — no DB, no Stripe. Locks canonical formulas in `paymentEngine.js`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dollarsToCents,
  centsToDecimalString,
  calculatePaymentAmounts,
  computeCancellationSplitCents,
  applyStripeRefundCap,
  splitNetRetainedCoachPlatformCents,
  computeEscrowCoachTransferCents,
  remainingRefundableOnChargeCents,
  centsNearEqual,
  parseTotalChargeCentsFromBooking,
} from '../services/paymentEngine.js';

describe('paymentEngine', () => {
  it('dollarsToCents handles string decimals and float edge cases', () => {
    assert.equal(dollarsToCents('12.34'), 1234);
    assert.equal(dollarsToCents(12.345), 1235);
    assert.equal(dollarsToCents(null), 0);
  });

  it('centsToDecimalString is non-negative and two fractional digits', () => {
    assert.equal(centsToDecimalString(1234), '12.34');
    assert.equal(centsToDecimalString(-5), '0.00');
  });

  it('calculatePaymentAmounts: 8% fee on lesson, 92% coach share of lesson, total = lesson + fee', () => {
    const a = calculatePaymentAmounts(100);
    assert.equal(a.lesson_price, 100);
    assert.equal(a.platform_fee_amount, 8);
    assert.equal(a.total_charge_to_student, 108);
    assert.equal(a.coach_payout_expected, 92);
    const lesson = dollarsToCents(100);
    const pf = dollarsToCents(a.platform_fee_amount);
    const tot = dollarsToCents(a.total_charge_to_student);
    const coach = dollarsToCents(a.coach_payout_expected);
    assert.equal(tot, lesson + pf);
    assert.equal(coach, Math.round((lesson * 92) / 100));
  });

  it('calculatePaymentAmounts is deterministic for typical decimal lesson price', () => {
    const a = calculatePaymentAmounts(10.99);
    const b = calculatePaymentAmounts(10.99);
    assert.deepEqual(a, b);
    assert.equal(dollarsToCents(a.total_charge_to_student), dollarsToCents(10.99) + dollarsToCents(a.platform_fee_amount));
  });

  it('computeCancellationSplitCents: refund + penalty === total', () => {
    const t = 10_000;
    const lateStudent = computeCancellationSplitCents({
      totalChargeCents: t,
      isLateCancel: true,
      cancelledBy: 'student',
    });
    assert.equal(lateStudent.refundCents + lateStudent.penaltyCents, t);
    const coach = computeCancellationSplitCents({
      totalChargeCents: t,
      isLateCancel: false,
      cancelledBy: 'coach',
    });
    assert.equal(coach.refundCents, t);
    assert.equal(coach.penaltyCents, 0);
  });

  it('applyStripeRefundCap preserves totalChargeCents split', () => {
    const capped = applyStripeRefundCap({
      policyRefundCents: 8000,
      totalChargeCents: 10_000,
      remainingCents: 3000,
    });
    assert.equal(capped.refundCents + capped.penaltyCents, 10_000);
    assert.equal(capped.refundCents, 3000);
    assert.equal(capped.capped, true);
  });

  it('splitNetRetainedCoachPlatformCents: coach + platform === net (remainder to platform)', () => {
    const x = splitNetRetainedCoachPlatformCents({
      netRetainedCents: 5400,
      totalChargeCents: 10_800,
      coachPayoutExpectedCents: 9200,
    });
    assert.equal(x.coachPayoutCents + x.platformFeeCents, 5400);
    assert.ok(x.coachPayoutCents >= 0);
    assert.ok(x.platformFeeCents >= 0);
  });

  it('computeEscrowCoachTransferCents matches split on net after refunds', () => {
    const { payoutCents, netRetainedCents } = computeEscrowCoachTransferCents({
      totalChargeCents: 10_800,
      refundedCents: 5400,
      coachPayoutExpectedCents: 9200,
    });
    assert.equal(netRetainedCents, 5400);
    assert.equal(payoutCents, 4600);
    const split = splitNetRetainedCoachPlatformCents({
      netRetainedCents,
      totalChargeCents: 10_800,
      coachPayoutExpectedCents: 9200,
    });
    assert.equal(payoutCents, split.coachPayoutCents);
  });

  it('remainingRefundableOnChargeCents never negative', () => {
    assert.equal(remainingRefundableOnChargeCents(1000, 400), 600);
    assert.equal(remainingRefundableOnChargeCents(1000, 1000), 0);
    assert.equal(remainingRefundableOnChargeCents(1000, 1200), 0);
  });

  it('centsNearEqual default tolerance 1', () => {
    assert.equal(centsNearEqual(100, 101), true);
    assert.equal(centsNearEqual(100, 99), true);
    assert.equal(centsNearEqual(100, 102), false);
  });

  it('parseTotalChargeCentsFromBooking prefers payment total', () => {
    assert.equal(
      parseTotalChargeCentsFromBooking({ total_charge_to_student: '54.00' }, { price: 50 }),
      5400,
    );
    assert.equal(parseTotalChargeCentsFromBooking(null, { price: 25.5 }), 2550);
  });
});
