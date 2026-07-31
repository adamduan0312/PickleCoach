/**
 * Message / conversation response DTOs.
 */

import { serializeBookingForMessaging } from './bookingDto.js';
import { serializeUserPartySummary } from './bookingDto.js';

function toPlain(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  if (typeof row.toJSON === 'function') return row.toJSON();
  return { ...row };
}

/**
 * Single message — id, sender, text, timestamps.
 */
export function serializeMessage(message) {
  if (!message) return null;
  const plain = toPlain(message);
  const dto = {
    id: plain.id,
    conversation_id: plain.conversation_id,
    sender_id: plain.sender_id,
    message_text: plain.message_text,
    created_at: plain.created_at,
    updated_at: plain.updated_at,
  };
  if (plain.sender !== undefined) {
    dto.sender = serializeUserPartySummary(plain.sender);
  }
  return dto;
}

/** Latest message preview for inbox (first element of include limit 1). */
export function serializeLatestMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  return serializeMessage(messages[0]);
}

/**
 * Conversation thread shell (detail) — no raw Sequelize extras.
 */
export function serializeConversationDetail(conversation, { booking, messages } = {}) {
  if (!conversation) return null;
  const plain = toPlain(conversation);
  const dto = {
    id: plain.id,
    booking_id: plain.booking_id,
    created_at: plain.created_at,
    updated_at: plain.updated_at,
  };
  const bookingSrc = booking !== undefined ? booking : plain.booking;
  if (bookingSrc !== undefined) {
    dto.booking = serializeBookingForMessaging(bookingSrc);
  }
  if (messages !== undefined) {
    dto.messages = Array.isArray(messages) ? messages.map(serializeMessage) : messages;
  }
  return dto;
}
