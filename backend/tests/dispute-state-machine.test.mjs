/**
 * Pure tests for `services/disputeStateMachine.js` (no DB).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertInitialInAppDisputeStatus,
  applyDisputeStatusTransition,
  canTransitionDisputeStatus,
  DisputeTransitionVia,
} from '../services/disputeStateMachine.js';

describe('disputeStateMachine', () => {
  it('in-app create must start open', () => {
    assert.equal(assertInitialInAppDisputeStatus('open').ok, true);
    assert.equal(assertInitialInAppDisputeStatus('resolved').ok, false);
  });

  it('admin resolve: open → resolved', () => {
    const r = canTransitionDisputeStatus('open', 'resolved', DisputeTransitionVia.ADMIN_RESOLVE);
    assert.equal(r.ok, true);
  });

  it('admin resolve rejects wrong target status', () => {
    const r = canTransitionDisputeStatus('open', 'open', DisputeTransitionVia.ADMIN_RESOLVE);
    assert.equal(r.ok, false);
  });

  it('Stripe sync is permissive for webhook mirror', () => {
    assert.equal(canTransitionDisputeStatus('open', 'under_review', DisputeTransitionVia.STRIPE_SYNC).ok, true);
    assert.equal(canTransitionDisputeStatus('under_review', 'resolved', DisputeTransitionVia.STRIPE_SYNC).ok, true);
  });

  it('applyDisputeStatusTransition applies patch on status noop', async () => {
    const dispute = {
      status: 'resolved',
      async update(patch) {
        Object.assign(this, patch);
      },
    };
    await applyDisputeStatusTransition(dispute, {
      toStatus: 'resolved',
      via: DisputeTransitionVia.STRIPE_SYNC,
      patch: { stripe_dispute_status: 'won' },
    });
    assert.equal(dispute.status, 'resolved');
    assert.equal(dispute.stripe_dispute_status, 'won');
  });
});
