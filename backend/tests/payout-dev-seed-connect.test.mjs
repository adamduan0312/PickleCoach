import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processHeldEscrowPayment } from '../workers/payoutWorker.js';
import { PAYOUT_ELIGIBLE_ESCROW_STATUS } from '../utils/payoutEscrowEligibility.js';

function heldPayment(stripeAccountId) {
  return {
    id: 1,
    escrow_status: PAYOUT_ELIGIBLE_ESCROW_STATUS,
    metadata: {},
    booking: { status: 'completed' },
    coach: { coachProfile: { stripe_account_id: stripeAccountId } },
  };
}

describe('payout worker with simulated dev seed Connect accounts', () => {
  it('never attempts a transfer to a simulated account', async () => {
    const result = await processHeldEscrowPayment(heldPayment('acct_tour_maya'));
    assert.deepEqual(result, { skipped: true, reason: 'dev_seed_connect_account' });
  });

  it('does not treat simulated ids as special in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const payment = heldPayment('acct_tour_maya');
      payment.booking = { status: 'completed', end_time: new Date().toISOString() };
      const result = await processHeldEscrowPayment(payment);
      assert.notEqual(result.reason, 'dev_seed_connect_account');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
