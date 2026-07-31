import { serializeLatestMessage } from './messageDto.js';
import {
  serializeBookingForMessaging,
  serializeBookingSummary,
} from './bookingDto.js';

export { serializeBookingForMessaging, serializeBookingSummary };

export { serializeLatestMessage } from './messageDto.js';

/**
 * Inbox row for GET /api/messages/conversations — preview only, not full thread history.
 * @param {object} row
 * @param {{ unreadCount?: number }} [opts]
 */
export function serializeConversationInboxItem(row, { unreadCount = 0 } = {}) {
  const json = row?.toJSON ? row.toJSON() : { ...row };
  const { messages, booking, ...conversationCore } = json;
  return {
    id: conversationCore.id,
    booking_id: conversationCore.booking_id,
    created_at: conversationCore.created_at,
    updated_at: conversationCore.updated_at,
    latest_message: serializeLatestMessage(messages),
    booking: serializeBookingForMessaging(booking),
    unread_count: Number(unreadCount) || 0,
  };
}
