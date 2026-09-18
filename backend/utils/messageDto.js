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
 * The other booking party for the current viewer (coach ↔ student).
 * Safe display fields only; null when the viewer is not a booking party
 * (e.g. admin) or party associations are missing.
 *
 * @param {object|null|undefined} booking — Booking with optional coach / primaryStudent
 * @param {number|string|null|undefined} viewerUserId
 * @returns {{ id: number, full_name: string, avatar_url: string|null }|null}
 */
export function resolveConversationCounterpart(booking, viewerUserId) {
  if (!booking || viewerUserId == null) return null;
  const plain = toPlain(booking);
  const viewerId = Number(viewerUserId);
  if (!Number.isFinite(viewerId)) return null;

  const coachId = plain.coach_id != null ? Number(plain.coach_id) : null;
  const studentId = plain.primary_student_id != null ? Number(plain.primary_student_id) : null;

  let other = null;
  if (coachId != null && viewerId === coachId) {
    other = plain.primaryStudent;
  } else if (studentId != null && viewerId === studentId) {
    other = plain.coach;
  } else {
    return null;
  }

  return serializeUserPartySummary(other);
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
 * @param {object} conversation
 * @param {{ booking?: object, messages?: object[], viewerUserId?: number|string }} [opts]
 */
export function serializeConversationDetail(conversation, { booking, messages, viewerUserId } = {}) {
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
  if (viewerUserId !== undefined) {
    dto.counterpart = resolveConversationCounterpart(bookingSrc, viewerUserId);
  }
  if (messages !== undefined) {
    dto.messages = Array.isArray(messages) ? messages.map(serializeMessage) : messages;
  }
  return dto;
}
