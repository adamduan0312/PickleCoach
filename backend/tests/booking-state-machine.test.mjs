/**
 * Pure tests for `services/bookingStateMachine.js` (no DB).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyBookingStatusTransition,
  assertBulkBookingStatusTransition,
  BookingTransitionVia,
  canTransitionBookingStatus,
} from '../services/bookingStateMachine.js';

describe('bookingStateMachine', () => {
  it('allows pending → confirmed via payment capture webhook', () => {
    const r = canTransitionBookingStatus('pending', 'confirmed', BookingTransitionVia.PAYMENT_CAPTURE_WEBHOOK);
    assert.equal(r.ok, true);
  });

  it('rejects pending → completed (no such channel)', () => {
    const r = canTransitionBookingStatus('pending', 'completed', BookingTransitionVia.MARK_COMPLETED);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'booking_transition_not_allowed');
  });

  it('allows bulk worker confirmed → awaiting_verification', () => {
    assert.doesNotThrow(() =>
      assertBulkBookingStatusTransition(
        'confirmed',
        'awaiting_verification',
        BookingTransitionVia.WORKER_LESSON_END_TO_AWAITING_VERIFICATION,
      ),
    );
  });

  it('applyBookingStatusTransition updates Sequelize-like instance', async () => {
    const booking = { status: 'pending', async update(payload) {
      Object.assign(this, payload);
    } };
    await applyBookingStatusTransition(booking, {
      toStatus: 'cancelled',
      via: BookingTransitionVia.COACH_DECLINE,
      patch: { cancelled_by: 'coach' },
    });
    assert.equal(booking.status, 'cancelled');
    assert.equal(booking.cancelled_by, 'coach');
  });

  it('dispute resolve attendance: disputed → coach_no_show', () => {
    const r = canTransitionBookingStatus(
      'disputed',
      'coach_no_show',
      BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE,
    );
    assert.equal(r.ok, true);
  });

  it('behavior release: disputed → completed', () => {
    const r = canTransitionBookingStatus(
      'disputed',
      'completed',
      BookingTransitionVia.DISPUTE_RESOLVE_BEHAVIOR_ON_DISPUTED_BOOKING,
    );
    assert.equal(r.ok, true);
  });
});
