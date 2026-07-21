/**
 * Contract tests for terminal Stripe dispute reconciliation.
 * No DB, no HTTP — guards parking (open) and release (terminal) behavior.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildStripeDisputePaymentPatch,
  isTerminalStripeDisputeStatus,
  mapOpenStripeDisputeEscrowReconciliation,
  mapTerminalStripeDisputeEscrowReconciliation,
  shouldReleaseBookingFromStripeDisputeTerminal,
} from '../services/paymentStripeContract.js';
import { mapStripeDisputeStatusToLocal } from '../services/stripeDisputeSyncService.js';
import { BookingTransitionVia, canTransitionBookingStatus } from '../services/bookingStateMachine.js';
import { isPaymentEscrowPayable } from '../utils/payoutEscrowEligibility.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const syncServicePath = join(__dirname, '../services/stripeDisputeSyncService.js');

const stripeDispute = (status, id = 'dp_test_1') => ({ id, status, charge: 'ch_test_1' });

describe('Stripe dispute status classification', () => {
  it('non-terminal maps to open or under_review', () => {
    assert.equal(mapStripeDisputeStatusToLocal('needs_response'), 'under_review');
    assert.equal(mapStripeDisputeStatusToLocal('warning_needs_response'), 'under_review');
    assert.equal(isTerminalStripeDisputeStatus('needs_response'), false);
  });

  it('terminal statuses map to resolved', () => {
    for (const status of ['won', 'lost', 'charge_refunded']) {
      assert.equal(mapStripeDisputeStatusToLocal(status), 'resolved');
      assert.equal(isTerminalStripeDisputeStatus(status), true);
    }
  });
});

describe('non-terminal dispute opening (charge.dispute.created)', () => {
  it('parks escrow as disputed', () => {
    const open = mapOpenStripeDisputeEscrowReconciliation();
    assert.equal(open.escrow_status, 'disputed');
    assert.equal(open.payment_status, null);
  });

  it('buildStripeDisputePaymentPatch for open dispute', () => {
    const patch = buildStripeDisputePaymentPatch(stripeDispute('needs_response'));
    assert.equal(patch.escrow_status, 'disputed');
    assert.equal(patch.stripe_dispute_status, 'needs_response');
    assert.equal(patch.payment_status, undefined);
  });

  it('does not release booking on open', () => {
    assert.equal(shouldReleaseBookingFromStripeDisputeTerminal('disputed', 'needs_response'), false);
  });
});

describe('terminal dispute reconciliation (charge.dispute.closed)', () => {
  it('won → escrow held (payout eligible), payment_status unchanged', () => {
    const mapped = mapTerminalStripeDisputeEscrowReconciliation('won');
    assert.deepEqual(mapped, { escrow_status: 'held', payment_status: null });

    const patch = buildStripeDisputePaymentPatch(stripeDispute('won'));
    assert.equal(patch.escrow_status, 'held');
    assert.equal(patch.payment_status, undefined);
    assert.equal(isPaymentEscrowPayable({ escrow_status: patch.escrow_status }), true);
  });

  it('lost → escrow refunded, payment_status refunded', () => {
    const mapped = mapTerminalStripeDisputeEscrowReconciliation('lost');
    assert.deepEqual(mapped, { escrow_status: 'refunded', payment_status: 'refunded' });

    const patch = buildStripeDisputePaymentPatch(stripeDispute('lost'));
    assert.equal(patch.escrow_status, 'refunded');
    assert.equal(patch.payment_status, 'refunded');
    assert.equal(isPaymentEscrowPayable({ escrow_status: patch.escrow_status }), false);
  });

  it('charge_refunded → escrow refunded, payment_status refunded', () => {
    const patch = buildStripeDisputePaymentPatch(stripeDispute('charge_refunded'));
    assert.equal(patch.escrow_status, 'refunded');
    assert.equal(patch.payment_status, 'refunded');
  });

  it('releases booking only when parked in disputed', () => {
    assert.equal(shouldReleaseBookingFromStripeDisputeTerminal('disputed', 'won'), true);
    assert.equal(shouldReleaseBookingFromStripeDisputeTerminal('disputed', 'lost'), true);
    assert.equal(shouldReleaseBookingFromStripeDisputeTerminal('completed', 'won'), false);
    assert.equal(shouldReleaseBookingFromStripeDisputeTerminal('student_no_show', 'won'), false);
    assert.equal(shouldReleaseBookingFromStripeDisputeTerminal('awaiting_verification', 'won'), false);
  });

  it('state machine allows disputed → completed via STRIPE_DISPUTE_TERMINAL', () => {
    const r = canTransitionBookingStatus(
      'disputed',
      'completed',
      BookingTransitionVia.STRIPE_DISPUTE_TERMINAL,
    );
    assert.equal(r.ok, true);
  });
});

describe('idempotent webhook replay', () => {
  it('terminal patch is stable on repeated application', () => {
    const d = stripeDispute('won');
    assert.deepEqual(buildStripeDisputePaymentPatch(d), buildStripeDisputePaymentPatch(d));
  });

  it('open patch is stable on repeated application', () => {
    const d = stripeDispute('under_review');
    assert.deepEqual(buildStripeDisputePaymentPatch(d), buildStripeDisputePaymentPatch(d));
  });

  it('noop booking transition when already completed', () => {
    const r = canTransitionBookingStatus(
      'completed',
      'completed',
      BookingTransitionVia.STRIPE_DISPUTE_TERMINAL,
    );
    assert.equal(r.ok, true);
    assert.equal(r.noop, true);
  });
});

describe('sync service wiring', () => {
  it('uses dedicated STRIPE_DISPUTE_TERMINAL via (not admin resolve vias)', () => {
    const src = readFileSync(syncServicePath, 'utf8');
    assert.match(src, /STRIPE_DISPUTE_TERMINAL/);
    assert.match(src, /buildStripeDisputePaymentPatch/);
    assert.match(src, /shouldReleaseBookingFromStripeDisputeTerminal/);
    assert.doesNotMatch(src, /DISPUTE_RESOLVE_CATCHALL_ON_DISPUTED_BOOKING/);
    assert.doesNotMatch(src, /DISPUTE_RESOLVE_BEHAVIOR_ON_DISPUTED_BOOKING/);
  });

  it('does not set escrow disputed on terminal events', () => {
    const src = readFileSync(syncServicePath, 'utf8');
    assert.doesNotMatch(src, /escrow_status:\s*'disputed'/);
  });
});
