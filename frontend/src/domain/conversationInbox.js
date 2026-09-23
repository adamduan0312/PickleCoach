/**
 * Student/coach Messages inbox ordering.
 *
 * 1. Unread / needs attention (unread_count > 0)
 * 2. Active conversations (has at least one message) — latest message first
 * 3. Empty conversations (booking-created, no messages yet) — newest conversation created last
 */

function ms(value) {
  if (value == null || value === '') return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function latestMessageMs(c) {
  const t = ms(c?.latest_message?.created_at);
  return Number.isFinite(t) ? t : 0;
}

function conversationCreatedMs(c) {
  const t = ms(c?.created_at);
  return Number.isFinite(t) ? t : 0;
}

export function conversationInboxGroup(conversation) {
  const unread = Number(conversation?.unread_count) || 0;
  if (unread > 0) return 0;
  if (conversation?.latest_message?.id || conversation?.latest_message?.message_text) return 1;
  // latest_message may be an object without text — treat any non-null latest as active
  if (conversation?.latest_message) return 1;
  return 2;
}

/**
 * @param {Array<object>} conversations inbox DTOs
 */
export function sortConversationsForInbox(conversations) {
  if (!Array.isArray(conversations) || conversations.length < 2) return conversations || [];

  return [...conversations].sort((a, b) => {
    const ga = conversationInboxGroup(a);
    const gb = conversationInboxGroup(b);
    if (ga !== gb) return ga - gb;

    if (ga === 0 || ga === 1) {
      const byMsg = latestMessageMs(b) - latestMessageMs(a);
      if (byMsg !== 0) return byMsg;
    }

    const byCreated = conversationCreatedMs(b) - conversationCreatedMs(a);
    if (byCreated !== 0) return byCreated;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}
