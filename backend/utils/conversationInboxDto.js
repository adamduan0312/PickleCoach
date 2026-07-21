import {
  serializeBookingForMessaging,
  serializeBookingSummary,
} from './bookingDto.js';

export { serializeBookingForMessaging, serializeBookingSummary };

export function serializeLatestMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const msg = messages[0];
  return msg?.toJSON ? msg.toJSON() : { ...msg };
}

/**
 * Inbox row for GET /api/messages/conversations — preview only, not full thread history.
 */
export function serializeConversationInboxItem(row) {
  const json = row?.toJSON ? row.toJSON() : { ...row };
  const { messages, booking, ...conversationCore } = json;
  return {
    id: conversationCore.id,
    booking_id: conversationCore.booking_id,
    created_at: conversationCore.created_at,
    updated_at: conversationCore.updated_at,
    latest_message: serializeLatestMessage(messages),
    booking: serializeBookingForMessaging(booking),
  };
}
