/**
 * Closed-booking messaging: read history, do not send / create threads.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  conversationClosedNotice,
  messagingLockedCopy,
} from '../src/domain/bookingStatus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('messaging closed copy', () => {
  it('pending explains messaging is not open yet', () => {
    const booking = { status: 'pending', messaging_locked: true };
    assert.equal(
      messagingLockedCopy(booking),
      'Messaging opens after the coach accepts this booking.',
    );
    assert.equal(
      conversationClosedNotice(booking),
      'Messaging opens after the coach accepts this booking.',
    );
  });

  it('completed uses view-only closed conversation copy', () => {
    const booking = { status: 'completed', messaging_locked: true };
    assert.match(
      conversationClosedNotice(booking),
      /This conversation is closed.*can’t send new messages for this completed booking/i,
    );
    assert.equal(
      messagingLockedCopy(booking),
      'Messaging is closed for this booking.',
    );
    assert.equal(
      messagingLockedCopy({ ...booking, conversation: { id: 12 } }),
      'This conversation is closed. You can still view previous messages.',
    );
  });

  it('cancelled and no-show use closed view-only notices', () => {
    assert.match(
      conversationClosedNotice({ status: 'cancelled', messaging_locked: true }),
      /cancelled booking/i,
    );
    assert.match(
      conversationClosedNotice({ status: 'coach_no_show', messaging_locked: true }),
      /This conversation is closed/i,
    );
    assert.match(
      conversationClosedNotice({ status: 'student_no_show', messaging_locked: true }),
      /can’t send new messages for this booking/i,
    );
  });

  it('disputed stays closed for MVP with view-only notice', () => {
    assert.match(
      conversationClosedNotice({ status: 'disputed', messaging_locked: true }),
      /payment dispute is open/i,
    );
  });

  it('unlocked bookings have no closed notices', () => {
    const booking = { status: 'confirmed', messaging_locked: false };
    assert.equal(messagingLockedCopy(booking), null);
    assert.equal(conversationClosedNotice(booking), null);
  });
});

describe('messaging closed UI wiring', () => {
  it('conversation page removes composer when locked', () => {
    const src = readFileSync(join(__dirname, '../src/pages/messages/MessagesPages.jsx'), 'utf8');
    assert.ok(src.includes('conversationClosedNotice'));
    assert.ok(src.includes('{!locked ? ('));
    assert.ok(src.includes('chat-composer'));
    assert.ok(!src.includes("placeholder={locked ? 'Messaging is locked for this booking'"));
  });

  it('booking detail offers View messages for locked bookings with an existing thread', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('View messages'));
    assert.ok(src.includes('canViewConversation'));
    assert.ok(src.includes('!booking.messaging_locked'));
    assert.ok(src.includes('// Locked bookings: view existing history only'));
  });
});
