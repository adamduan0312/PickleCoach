/**
 * Booking messaging lifecycle and permission rules (pure).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MESSAGING_UNAVAILABLE_MESSAGE,
  canAccessBookingConversation,
  canSendBookingMessage,
  isMessagingLocked,
  messagingLockedForStatus,
} from '../utils/bookingMessaging.js';
import { affectsReliability, getValidReasons } from '../services/reliabilityPenaltyService.js';

const booking = (overrides = {}) => ({
  id: 1,
  coach_id: 10,
  primary_student_id: 20,
  status: 'confirmed',
  messaging_locked: false,
  ...overrides,
});

describe('booking messaging lifecycle', () => {
  it('pending is locked', () => {
    assert.equal(messagingLockedForStatus('pending'), true);
    assert.equal(isMessagingLocked(booking({ status: 'pending', messaging_locked: true })), true);
  });

  it('confirmed and awaiting_verification are unlocked when messaging_locked is false', () => {
    assert.equal(messagingLockedForStatus('confirmed'), false);
    assert.equal(messagingLockedForStatus('awaiting_verification'), false);
    assert.equal(isMessagingLocked(booking({ status: 'confirmed', messaging_locked: false })), false);
    assert.equal(
      isMessagingLocked(booking({ status: 'awaiting_verification', messaging_locked: false })),
      false,
    );
  });

  it('terminal statuses are locked', () => {
    for (const status of [
      'completed',
      'cancelled',
      'disputed',
      'coach_no_show',
      'student_no_show',
    ]) {
      assert.equal(messagingLockedForStatus(status), true, status);
      assert.equal(isMessagingLocked(booking({ status, messaging_locked: true })), true, status);
    }
  });

  it('messaging lock follows status (confirmed always unlocked)', () => {
    assert.equal(isMessagingLocked(booking({ status: 'confirmed', messaging_locked: true })), false);
    assert.equal(isMessagingLocked(booking({ status: 'cancelled', messaging_locked: false })), true);
  });
});

describe('booking messaging permissions', () => {
  it('coach and student can access', () => {
    const b = booking();
    assert.equal(canAccessBookingConversation(10, ['coach'], b), true);
    assert.equal(canAccessBookingConversation(20, ['student'], b), true);
  });

  it('admin can access', () => {
    assert.equal(canAccessBookingConversation(99, ['admin'], booking()), true);
  });

  it('non-participant cannot access', () => {
    assert.equal(canAccessBookingConversation(99, ['student'], booking()), false);
  });

  it('participant can send on unlocked confirmed booking', () => {
    const b = booking();
    const r = canSendBookingMessage(20, ['student'], b);
    assert.equal(r.ok, true);
  });

  it('participant cannot send on cancelled booking', () => {
    const r = canSendBookingMessage(20, ['student'], booking({ status: 'cancelled', messaging_locked: true }));
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.equal(r.message, MESSAGING_UNAVAILABLE_MESSAGE);
  });

  it('participant cannot send on completed booking', () => {
    const r = canSendBookingMessage(10, ['coach'], booking({ status: 'completed', messaging_locked: true }));
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  });

  it('admin can access but cannot send', () => {
    assert.equal(canAccessBookingConversation(1, ['admin'], booking()), true);
    const r = canSendBookingMessage(1, ['admin'], booking());
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  it('non-participant send is 403', () => {
    const r = canSendBookingMessage(99, ['student'], booking());
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });
});

describe('cancellation reasons (travel_delay)', () => {
  it('includes travel_delay and classifies excused vs unexcused', () => {
    assert.ok(getValidReasons().includes('travel_delay'));
    assert.equal(affectsReliability('weather'), false);
    assert.equal(affectsReliability('travel_delay'), true);
  });
});
