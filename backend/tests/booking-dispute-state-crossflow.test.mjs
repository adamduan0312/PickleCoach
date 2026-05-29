/**
 * Cross-entity state checks (pure, no DB).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canTransitionBookingStatus, BookingTransitionVia } from '../services/bookingStateMachine.js';
import { canTransitionDisputeStatus, DisputeTransitionVia } from '../services/disputeStateMachine.js';

describe('booking ↔ dispute crossflow (pure)', () => {
  it('admin resolve closes dispute while booking moves to attendance outcome', () => {
    assert.equal(canTransitionDisputeStatus('open', 'resolved', DisputeTransitionVia.ADMIN_RESOLVE).ok, true);
    assert.equal(
      canTransitionBookingStatus('completed', 'student_no_show', BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE)
        .ok,
      true,
    );
  });

  it('Stripe non-terminal dispute parks booking as disputed from completed', () => {
    assert.equal(
      canTransitionBookingStatus('completed', 'disputed', BookingTransitionVia.STRIPE_DISPUTE_OPEN).ok,
      true,
    );
  });
});
