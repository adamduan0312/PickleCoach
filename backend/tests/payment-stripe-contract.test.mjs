/**
 * Stripe webhook + refund pipeline **contracts** — no HTTP, no DB, no live Stripe.
 * Guards replay/idempotency rules, charge.refunded mirror classification, processRefund guards,
 * multi-step partial refunds, and payment_actions reconciliation typing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { remainingRefundableOnChargeCents } from '../services/paymentEngine.js';
import {
  shouldStripeWebhookSkipAsDuplicate,
  classifyStripeChargeRefundMirrorUpdate,
  shouldSkipProcessRefundForPendingDuplicate,
  buildPaymentActionRefundIdempotencyKey,
  buildProcessRefundFallbackIdempotencyKey,
  isHydrateFullRemainingRefundAction,
  isFixedCentsRefundAction,
  isPaymentActionRefundSucceeded,
  isPaymentActionRefundExecutionBlocked,
  isPaymentActionRefundPermanentlyFailed,
  HYDRATE_FULL_REMAINING_REFUND_ACTION_TYPES,
  FIXED_CENTS_REFUND_ACTION_TYPES,
} from '../services/paymentStripeContract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webhookControllerPath = join(__dirname, '../controllers/webhookController.js');

describe('Stripe webhook idempotency contract', () => {
  it('skips only when prior webhook log succeeded', () => {
    assert.equal(shouldStripeWebhookSkipAsDuplicate(null), false);
    assert.equal(shouldStripeWebhookSkipAsDuplicate({ success: false }), false);
    assert.equal(shouldStripeWebhookSkipAsDuplicate({ success: true }), true);
  });

  it('webhookController uses shared duplicate guard (replay safety)', () => {
    const src = readFileSync(webhookControllerPath, 'utf8');
    assert.match(src, /shouldStripeWebhookSkipAsDuplicate/);
    assert.match(src, /webhook_idempotent_skip/);
  });
});

describe('charge.refunded mirror classification', () => {
  it('no DB update when nothing refunded yet', () => {
    const r = classifyStripeChargeRefundMirrorUpdate(10_800, 0);
    assert.equal(r.shouldUpdate, false);
  });

  it('partial refund → partially_refunded + held escrow', () => {
    const r = classifyStripeChargeRefundMirrorUpdate(10_800, 3000);
    assert.equal(r.shouldUpdate, true);
    assert.equal(r.payment_status, 'partially_refunded');
    assert.equal(r.escrow_status, 'held');
  });

  it('full refund → refunded + refunded escrow', () => {
    const r = classifyStripeChargeRefundMirrorUpdate(10_800, 10_800);
    assert.equal(r.shouldUpdate, true);
    assert.equal(r.payment_status, 'refunded');
    assert.equal(r.escrow_status, 'refunded');
  });

  it('gross zero but Stripe shows refund still treated as partial path (mirror parity)', () => {
    const r = classifyStripeChargeRefundMirrorUpdate(0, 500);
    assert.equal(r.shouldUpdate, true);
    assert.equal(r.payment_status, 'partially_refunded');
  });
});

describe('processRefund duplicate-pending guard', () => {
  it('skips non-worker calls when refund_status pending', () => {
    assert.equal(
      shouldSkipProcessRefundForPendingDuplicate({ refundStatus: 'pending', paymentActionExecution: false }),
      true,
    );
    assert.equal(
      shouldSkipProcessRefundForPendingDuplicate({ refundStatus: 'pending', paymentActionExecution: true }),
      false,
    );
    assert.equal(
      shouldSkipProcessRefundForPendingDuplicate({ refundStatus: 'succeeded', paymentActionExecution: false }),
      false,
    );
  });
});

describe('Idempotency key shapes (Stripe replay)', () => {
  it('payment_actions key is stable per booking + row id', () => {
    assert.equal(
      buildPaymentActionRefundIdempotencyKey({ bookingId: 12, paymentActionId: 99 }),
      'refund_12_99',
    );
  });

  it('processRefund fallback key encodes payment, cents, and charge', () => {
    assert.equal(
      buildProcessRefundFallbackIdempotencyKey({
        paymentId: 5,
        refundCents: 2500,
        stripeChargeId: 'ch_abc',
      }),
      'refund-payment-5-2500-ch_abc',
    );
  });
});

describe('Partial refund lifecycle (cents)', () => {
  it('sequential partials never exceed gross', () => {
    const gross = 10_000;
    let refunded = 0;
    const steps = [1000, 2000, 3000, 4000];
    for (const step of steps) {
      const remaining = remainingRefundableOnChargeCents(gross, refunded);
      assert.ok(step <= remaining, `step ${step} remaining ${remaining}`);
      refunded += step;
    }
    assert.equal(remainingRefundableOnChargeCents(gross, refunded), 0);
  });
});

describe('payment_actions reconciliation typing', () => {
  it('dispute full refund hydrates from charge; booking paths use fixed cents', () => {
    assert.equal(isHydrateFullRemainingRefundAction('dispute_refund_full'), true);
    assert.equal(isHydrateFullRemainingRefundAction('booking_cancel_refund'), false);
    assert.equal(isFixedCentsRefundAction('booking_cancel_refund'), true);
    assert.equal(isFixedCentsRefundAction('dispute_refund_full'), false);
  });

  it('exported type lists match sets', () => {
    assert.deepEqual([...HYDRATE_FULL_REMAINING_REFUND_ACTION_TYPES], ['dispute_refund_full']);
    assert.ok(FIXED_CENTS_REFUND_ACTION_TYPES.includes('booking_admin_refund'));
  });

  it('terminal success requires stripe_refund_id', () => {
    assert.equal(isPaymentActionRefundSucceeded('succeeded', 're_123'), true);
    assert.equal(isPaymentActionRefundSucceeded('succeeded', null), false);
  });

  it('execution blocked without positive refund_cents', () => {
    assert.equal(isPaymentActionRefundExecutionBlocked('pending', null), true);
    assert.equal(isPaymentActionRefundExecutionBlocked('pending', 0), true);
    assert.equal(isPaymentActionRefundExecutionBlocked('pending', 100), false);
  });

  it('permanent failure at max attempts', () => {
    assert.equal(isPaymentActionRefundPermanentlyFailed(8, 8), true);
    assert.equal(isPaymentActionRefundPermanentlyFailed(7, 8), false);
  });
});

describe('Connect transfer.reversed', () => {
  it('webhook switch handles transfer.reversed via dedicated handler', () => {
    const src = readFileSync(webhookControllerPath, 'utf8');
    assert.match(src, /case 'transfer\.reversed'/);
    assert.match(src, /handleTransferReversed/);
    assert.match(src, /handleTransferReversedFromStripe/);
  });

  it('paymentService parks canonical reverse at manual_payout_required and ignores duplicates', () => {
    const paymentServicePath = join(__dirname, '../services/paymentService.js');
    const src = readFileSync(paymentServicePath, 'utf8');
    assert.match(src, /export const handleTransferReversedFromStripe/);
    assert.match(src, /manual_payout_required/);
    assert.match(src, /transfer_reversed_non_canonical/);
    assert.match(src, /transfer_reversed_manual_review/);
    assert.match(src, /non_canonical_duplicate_reversal/);
  });
});
