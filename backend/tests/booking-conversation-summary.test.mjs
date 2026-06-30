/**
 * Conversation summary on booking responses.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildConversationSummary } from '../utils/bookingMessaging.js';

describe('buildConversationSummary', () => {
  const confirmedBooking = {
    id: 5,
    coach_id: 10,
    primary_student_id: 20,
    status: 'confirmed',
    messaging_locked: false,
  };

  it('student on confirmed booking can send when conversation exists', () => {
    const summary = buildConversationSummary(
      confirmedBooking,
      { id: 15, booking_id: 5 },
      8,
      20,
      ['student'],
    );
    assert.equal(summary.id, 15);
    assert.equal(summary.can_send_messages, true);
    assert.equal(summary.message_count, 8);
  });

  it('admin can read context but cannot send', () => {
    const summary = buildConversationSummary(
      confirmedBooking,
      { id: 15, booking_id: 5 },
      3,
      99,
      ['admin'],
    );
    assert.equal(summary.id, 15);
    assert.equal(summary.can_send_messages, false);
    assert.equal(summary.message_count, 3);
  });

  it('cancelled booking: history count preserved, send disabled', () => {
    const cancelled = { ...confirmedBooking, status: 'cancelled', messaging_locked: true };
    const summary = buildConversationSummary(
      cancelled,
      { id: 15, booking_id: 5 },
      2,
      20,
      ['student'],
    );
    assert.equal(summary.message_count, 2);
    assert.equal(summary.can_send_messages, false);
  });

  it('no conversation yet on pending booking reports can_send_messages false', () => {
    const pending = { ...confirmedBooking, status: 'pending', messaging_locked: true };
    const summary = buildConversationSummary(pending, null, 0, 20, ['student']);
    assert.equal(summary.id, null);
    assert.equal(summary.can_send_messages, false);
  });

  it('confirmed booking with auto-created conversation exposes id', () => {
    const summary = buildConversationSummary(
      confirmedBooking,
      { id: 15, booking_id: 5 },
      0,
      20,
      ['student'],
    );
    assert.equal(summary.id, 15);
    assert.equal(summary.can_send_messages, true);
    assert.equal(summary.message_count, 0);
  });
});
