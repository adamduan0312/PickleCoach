import { QueryTypes } from 'sequelize';
import { sequelize, ConversationRead, Message } from '../models/index.js';

/**
 * Batch unread counts for inbox rows.
 * Unread = messages from others after the viewer's last_read_at (or all incoming if never read).
 *
 * @param {number} userId
 * @param {number[]} conversationIds
 * @returns {Promise<Map<number, number>>}
 */
export async function getUnreadCountsByConversationIds(userId, conversationIds) {
  const ids = [
    ...new Set(
      (conversationIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  const map = new Map(ids.map((id) => [id, 0]));
  if (!ids.length || userId == null) return map;

  const rows = await sequelize.query(
    `
    SELECT m.conversation_id AS conversation_id, COUNT(*) AS unread_count
    FROM messages m
    LEFT JOIN conversation_reads cr
      ON cr.conversation_id = m.conversation_id
     AND cr.user_id = :userId
    WHERE m.conversation_id IN (:ids)
      AND m.sender_id != :userId
      AND (cr.last_read_at IS NULL OR m.created_at > cr.last_read_at)
    GROUP BY m.conversation_id
    `,
    {
      replacements: { userId: Number(userId), ids },
      type: QueryTypes.SELECT,
    },
  );

  for (const row of rows) {
    const conversationId = Number(row.conversation_id);
    map.set(conversationId, Number(row.unread_count) || 0);
  }
  return map;
}

/**
 * Resolve the read cursor for a conversation: newest message created_at, or now if empty.
 * Prefer message time over wall-clock so concurrent sends after open stay unread.
 *
 * @param {number} conversationId
 * @returns {Promise<Date>}
 */
export async function resolveConversationReadCursor(conversationId) {
  const latest = await Message.findOne({
    where: { conversation_id: Number(conversationId) },
    attributes: ['created_at'],
    order: [
      ['created_at', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  if (latest?.created_at) {
    return new Date(latest.created_at);
  }
  return new Date();
}

/**
 * Upsert the viewer's read cursor for a conversation (opening the thread = read).
 * Defaults `last_read_at` to the newest message timestamp in the thread (not wall-clock now).
 * Never moves the cursor backwards.
 *
 * @param {number} userId
 * @param {number} conversationId
 * @param {Date} [at] — optional explicit cursor (tests); otherwise latest message created_at
 */
export async function markConversationAsRead(userId, conversationId, at = undefined) {
  const conversation_id = Number(conversationId);
  const user_id = Number(userId);
  const cursor = at != null ? new Date(at) : await resolveConversationReadCursor(conversation_id);

  const [row, created] = await ConversationRead.findOrCreate({
    where: { conversation_id, user_id },
    defaults: { last_read_at: cursor },
  });

  if (!created) {
    const existing = row.last_read_at ? new Date(row.last_read_at) : null;
    if (!existing || existing < cursor) {
      await row.update({ last_read_at: cursor });
    }
  }
  return row;
}

/**
 * Count unread messages for one conversation (same rules as batch helper).
 */
export async function countUnreadForConversation(userId, conversationId) {
  const map = await getUnreadCountsByConversationIds(userId, [conversationId]);
  return map.get(Number(conversationId)) || 0;
}
