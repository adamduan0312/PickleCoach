/**
 * Payout eligibility is gated on escrow_status, NOT booking.status.
 *
 * Regression guard for the scenario where escrow stays non-held
 * (disputed, refunded, released, etc.) — payout must not proceed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYOUT_ELIGIBLE_ESCROW_STATUS,
  MAX_FAILED_CONNECT_PAYOUT_ATTEMPTS,
  isPaymentEscrowPayable,
  shouldParkPayoutAfterFailedAttempts,
} from '../utils/payoutEscrowEligibility.js';

describe('payout escrow eligibility', () => {
  it('only "held" escrow is payable', () => {
    assert.equal(PAYOUT_ELIGIBLE_ESCROW_STATUS, 'held');
    assert.equal(isPaymentEscrowPayable({ escrow_status: 'held' }), true);
  });

  it('a completed booking with disputed escrow is NOT payable', () => {
    // booking.status = 'completed' is irrelevant here — escrow is the authority.
    assert.equal(isPaymentEscrowPayable({ escrow_status: 'disputed' }), false);
  });

  it('every non-held escrow state is parked (not payable)', () => {
    for (const escrow_status of [
      'pending',
      'disputed',
      'released',
      'refunded',
      'manual_payout_required',
      'pending_release',
    ]) {
      assert.equal(
        isPaymentEscrowPayable({ escrow_status }),
        false,
        `${escrow_status} must not be payable`,
      );
    }
  });

  it('missing/null payment is not payable', () => {
    assert.equal(isPaymentEscrowPayable(null), false);
    assert.equal(isPaymentEscrowPayable(undefined), false);
    assert.equal(isPaymentEscrowPayable({}), false);
  });

  it('parks Connect retries after MAX_FAILED_CONNECT_PAYOUT_ATTEMPTS', () => {
    assert.equal(MAX_FAILED_CONNECT_PAYOUT_ATTEMPTS, 5);
    assert.equal(shouldParkPayoutAfterFailedAttempts(4), false);
    assert.equal(shouldParkPayoutAfterFailedAttempts(5), true);
    assert.equal(shouldParkPayoutAfterFailedAttempts(749), true);
  });
});
