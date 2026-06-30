/**
 * Booking-scoped messaging lifecycle.
 *
 * Messaging lock is derived from `booking.status` (single source of truth).
 * `messaging_locked` on the row is kept in sync by `applyBookingStatusTransition`.
 */

export const MESSAGING_UNAVAILABLE_MESSAGE = 'Messaging is unavailable for this booking';

/** Only these statuses allow coach/student to send messages. */
export const MESSAGING_UNLOCKED_STATUSES = ['confirmed', 'awaiting_verification'];

export function messagingLockedForStatus(status) {
  return !MESSAGING_UNLOCKED_STATUSES.includes(status);
}

/** Persisted boolean for `bookings.messaging_locked` — always derived from status. */
export function messagingLockedValueForStatus(status) {
  return messagingLockedForStatus(status);
}

export function isMessagingLocked(booking) {
  if (!booking?.status) return true;
  return messagingLockedForStatus(booking.status);
}

export function isBookingParticipant(userId, booking) {
  if (!booking || userId == null) return false;
  return userId === booking.coach_id || userId === booking.primary_student_id;
}

export function canAccessBookingConversation(userId, roles, booking) {
  if (!booking) return false;
  if (Array.isArray(roles) && roles.includes('admin')) return true;
  return isBookingParticipant(userId, booking);
}

/**
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
export function canSendBookingMessage(userId, roles, booking) {
  if (!booking) {
    return { ok: false, status: 404, message: 'Booking not found' };
  }
  if (!canAccessBookingConversation(userId, roles, booking)) {
    return { ok: false, status: 403, message: 'Unauthorized' };
  }
  if (Array.isArray(roles) && roles.includes('admin')) {
    return { ok: false, status: 403, message: 'Unauthorized' };
  }
  if (!isBookingParticipant(userId, booking)) {
    return { ok: false, status: 403, message: 'Unauthorized' };
  }
  if (isMessagingLocked(booking)) {
    return { ok: false, status: 409, message: MESSAGING_UNAVAILABLE_MESSAGE };
  }
  return { ok: true };
}

/**
 * @param {object|null} conversationRow
 * @param {number} messageCount
 */
export function buildConversationSummary(booking, conversationRow, messageCount, userId, roles) {
  const sendCheck = canSendBookingMessage(userId, roles, booking);
  return {
    id: conversationRow?.id ?? null,
    can_send_messages: sendCheck.ok,
    message_count: messageCount ?? 0,
  };
}
