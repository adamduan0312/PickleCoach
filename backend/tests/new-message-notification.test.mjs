/**
 * New chat message → in-app notification for the other booking participant.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNewMessageNotificationPayload,
} from '../notifications/payloadBuilders.js';
import {
  resolveMessageNotificationRecipient,
} from '../services/notificationService.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const messageControllerSrc = readFileSync(
  join(__dirname, '../controllers/messageController.js'),
  'utf8',
);

const booking = (overrides = {}) => ({
  id: 5,
  coach_id: 10,
  primary_student_id: 20,
  ...overrides,
});

describe('resolveMessageNotificationRecipient', () => {
  it('student sender → coach recipient', () => {
    assert.equal(resolveMessageNotificationRecipient(booking(), 20), 10);
  });

  it('coach sender → student recipient', () => {
    assert.equal(resolveMessageNotificationRecipient(booking(), 10), 20);
  });

  it('returns null when sender is not a participant', () => {
    assert.equal(resolveMessageNotificationRecipient(booking(), 99), null);
  });

  it('returns null when coach and student are the same id', () => {
    assert.equal(
      resolveMessageNotificationRecipient(booking({ coach_id: 10, primary_student_id: 10 }), 10),
      null,
    );
  });
});

describe('buildNewMessageNotificationPayload', () => {
  it('includes deep-link ids and truncates long previews', () => {
    const long = 'x'.repeat(200);
    const payload = buildNewMessageNotificationPayload({
      message: { id: 42, conversation_id: 7, sender_id: 20, message_text: long },
      booking: booking(),
      sender: { id: 20, full_name: 'Jamie Student' },
      conversationId: 7,
    });

    assert.equal(payload.message_id, 42);
    assert.equal(payload.conversation_id, 7);
    assert.equal(payload.booking_id, 5);
    assert.equal(payload.sender_id, 20);
    assert.equal(payload.sender_name, 'Jamie Student');
    assert.match(payload.headline, /Jamie Student/);
    assert.equal(payload.preview.length, 140);
    assert.ok(payload.preview.endsWith('...'));
  });

  it('keeps short message text intact', () => {
    const payload = buildNewMessageNotificationPayload({
      message: { id: 1, message_text: 'See you at court!' },
      booking: booking(),
      sender: { id: 10, full_name: 'Coach Alex' },
      conversationId: 3,
    });
    assert.equal(payload.preview, 'See you at court!');
    assert.match(payload.summary, /Coach Alex: See you at court!/);
  });
});

describe('new_message payload route (via withNotificationRoute)', () => {
  it('client can navigate(payload.route) without switching on type', async () => {
    const { withNotificationRoute } = await import('../notifications/notificationRoutes.js');
    const payload = withNotificationRoute(
      'new_message',
      buildNewMessageNotificationPayload({
        message: { id: 1, message_text: 'Sounds good!' },
        booking: booking(),
        sender: { id: 20, full_name: 'John' },
        conversationId: 42,
      }),
    );
    assert.equal(payload.route, '/messages/42');
    assert.match(payload.summary, /John: Sounds good!/);
  });
});

describe('sendMessage wires new_message notification', () => {
  it('calls notifyNewMessage after creating the message', () => {
    assert.match(messageControllerSrc, /notifyNewMessage/);
    assert.match(messageControllerSrc, /new_message_notify_failed/);
  });
});

describe('notifyNewMessage uses createNotification', () => {
  it('does not call Notification.create directly', async () => {
    const src = readFileSync(
      join(__dirname, '../services/notificationService.js'),
      'utf8',
    );
    const notifySection = src.slice(src.indexOf('export const notifyNewMessage'));
    assert.match(notifySection, /createNotification\(/);
    assert.doesNotMatch(notifySection, /Notification\.create\(/);
  });
});
