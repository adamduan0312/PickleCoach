/**
 * Connect transfer webhook classification + payout release contracts.
 * booking.status=completed must never be treated as proof the coach was paid.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyConnectTransferWebhook,
  shouldFinalizeBookingFromTransferWebhook,
} from '../utils/connectTransferWebhook.js';
import {
  MAX_FAILED_CONNECT_PAYOUT_ATTEMPTS,
  shouldParkPayoutAfterFailedAttempts,
  isPaymentEscrowPayable,
} from '../utils/payoutEscrowEligibility.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const paymentServiceSrc = readFileSync(join(__dirname, '../services/paymentService.js'), 'utf8');
const payoutWorkerSrc = readFileSync(join(__dirname, '../workers/payoutWorker.js'), 'utf8');

describe('classifyConnectTransferWebhook', () => {
  it('treats unset payment.transfer_id as canonical_unset (first webhook may claim)', () => {
    assert.equal(
      classifyConnectTransferWebhook({ paymentTransferId: null, webhookTransferId: 'tr_A' }),
      'canonical_unset',
    );
    assert.equal(shouldFinalizeBookingFromTransferWebhook('canonical_unset'), true);
  });

  it('matches canonical transfer id', () => {
    assert.equal(
      classifyConnectTransferWebhook({ paymentTransferId: 'tr_A', webhookTransferId: 'tr_A' }),
      'canonical',
    );
    assert.equal(shouldFinalizeBookingFromTransferWebhook('canonical'), true);
  });

  it('flags a different transfer as duplicate and does NOT finalize booking', () => {
    assert.equal(
      classifyConnectTransferWebhook({ paymentTransferId: 'tr_A', webhookTransferId: 'tr_B' }),
      'duplicate',
    );
    assert.equal(shouldFinalizeBookingFromTransferWebhook('duplicate'), false);
  });
});

describe('finalizeTransferFromStripe source contracts', () => {
  const section = (() => {
    const start = paymentServiceSrc.indexOf('export const finalizeTransferFromStripe');
    const end = paymentServiceSrc.indexOf('\nexport const ', start + 1);
    return paymentServiceSrc.slice(start, end);
  })();

  it('duplicate webhook path returns without releasing escrow / marking booking paid', () => {
    assert.match(section, /classifyConnectTransferWebhook/);
    assert.match(section, /shouldFinalizeBookingFromTransferWebhook/);
    assert.match(section, /duplicate_transfer_webhook/);
    assert.match(section, /duplicate_transfer_detected/);
    assert.match(section, /finalizedBooking: false/);
    assert.match(section, /reason: 'duplicate_transfer'/);
    // Duplicate branch must not call markBookingPayoutPaid before returning.
    const dupReturn = section.indexOf("reason: 'duplicate_transfer'");
    const firstMarkPaid = section.indexOf('markBookingPayoutPaid');
    assert.ok(dupReturn > 0 && firstMarkPaid > dupReturn,
      'duplicate early-return must precede any markBookingPayoutPaid');
  });

  it('canonical path still releases escrow', () => {
    assert.match(section, /escrow_status: 'released'/);
    assert.match(section, /finalizedBooking: true/);
  });
});

describe('releaseEscrow concurrency + retry contracts', () => {
  it('claims held → pending_release before Stripe transfer', () => {
    const start = paymentServiceSrc.indexOf('export const releaseEscrow');
    const end = paymentServiceSrc.indexOf('\nexport const ', start + 1);
    const section = paymentServiceSrc.slice(start, end);
    const claimIdx = section.indexOf("escrow_status: 'pending_release'");
    const transferIdx = section.indexOf('stripeService.transferToConnectedAccount');
    assert.ok(claimIdx > 0 && transferIdx > claimIdx);
    assert.match(section, /lock:\s*transaction\.LOCK\.UPDATE/);
  });

  it('worker treats release skipped as non-fatal', () => {
    assert.match(payoutWorkerSrc, /releaseResult\?\.skipped/);
  });

  it('five failed Connect attempts park at manual_payout_required', () => {
    assert.equal(MAX_FAILED_CONNECT_PAYOUT_ATTEMPTS, 5);
    assert.equal(shouldParkPayoutAfterFailedAttempts(4), false);
    assert.equal(shouldParkPayoutAfterFailedAttempts(5), true);
  });

  it('pending_release / disputed escrow is not payable (completed ≠ paid)', () => {
    assert.equal(isPaymentEscrowPayable({ escrow_status: 'pending_release' }), false);
    assert.equal(isPaymentEscrowPayable({ escrow_status: 'disputed' }), false);
    assert.equal(isPaymentEscrowPayable({ escrow_status: 'manual_payout_required' }), false);
    assert.equal(isPaymentEscrowPayable({ escrow_status: 'held' }), true);
  });
});
