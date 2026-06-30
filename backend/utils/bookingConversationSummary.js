import { Op } from 'sequelize';
import { Conversation, Message } from '../models/index.js';
import { buildConversationSummary } from './bookingMessaging.js';
import { logger } from '../config/logger.js';

function bookingPlain(booking) {
  return booking?.toJSON ? booking.toJSON() : booking;
}

function defaultSummary(booking, userId, roles) {
  return buildConversationSummary(bookingPlain(booking), null, 0, userId, roles);
}

/**
 * Idempotent: one conversation per booking. Called when a booking becomes confirmed
 * so chat is ready before the client opens the thread.
 *
 * @param {number} bookingId
 * @param {{ transaction?: import('sequelize').Transaction }} [opts]
 * @returns {Promise<import('../models/Conversation.js').default|null>}
 */
export async function ensureBookingConversation(bookingId, { transaction } = {}) {
  if (!bookingId) return null;

  const existing = await Conversation.findOne({
    where: { booking_id: bookingId },
    transaction,
  });
  if (existing) return existing;

  try {
    return await Conversation.create({ booking_id: bookingId }, { transaction });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      return Conversation.findOne({ where: { booking_id: bookingId }, transaction });
    }
    logger.error('ensureBookingConversation failed', { bookingId, message: err?.message });
    throw err;
  }
}

/**
 * Batch-load conversation summaries for booking list/detail responses.
 *
 * @param {Array<object>} bookingRows — Sequelize instances or plain objects
 * @param {number} userId
 * @param {string[]} roles
 * @returns {Promise<Map<number, { id: number|null, can_send_messages: boolean, message_count: number }>>}
 */
export async function loadConversationSummariesByBookingId(bookingRows, userId, roles) {
  const map = new Map();
  if (!bookingRows?.length) return map;

  const bookingIds = bookingRows.map((b) => bookingPlain(b).id).filter(Boolean);
  if (!bookingIds.length) return map;

  const conversations = await Conversation.findAll({
    where: { booking_id: bookingIds },
    attributes: ['id', 'booking_id'],
  });

  const convByBookingId = new Map(conversations.map((c) => [c.booking_id, c]));
  const convIds = conversations.map((c) => c.id);

  let countByConvId = new Map();
  if (convIds.length) {
    const counts = await Message.findAll({
      attributes: ['conversation_id', [Message.sequelize.fn('COUNT', Message.sequelize.col('id')), 'count']],
      where: { conversation_id: convIds },
      group: ['conversation_id'],
      raw: true,
    });
    countByConvId = new Map(
      counts.map((row) => [row.conversation_id, Number(row.count) || 0]),
    );
  }

  for (const row of bookingRows) {
    const plain = bookingPlain(row);
    const conv = convByBookingId.get(plain.id);
    const messageCount = conv ? (countByConvId.get(conv.id) ?? 0) : 0;
    map.set(
      plain.id,
      buildConversationSummary(plain, conv, messageCount, userId, roles),
    );
  }

  return map;
}

/**
 * @param {object|object[]} bookingRows
 * @param {number} userId
 * @param {string[]} roles
 * @returns {Promise<object[]>} plain booking objects with `conversation` summary
 */
export async function attachConversationSummaries(bookingRows, userId, roles) {
  const rows = Array.isArray(bookingRows) ? bookingRows : [bookingRows];
  if (!rows.length) return [];

  const summaries = await loadConversationSummariesByBookingId(rows, userId, roles);

  return rows.map((row) => {
    const plain = bookingPlain(row);
    plain.conversation = summaries.get(plain.id) ?? defaultSummary(plain, userId, roles);
    return plain;
  });
}

/**
 * Single booking helper (detail responses).
 */
export async function attachConversationSummaryToBookingJson(bookingJson, userId, roles) {
  const [withSummary] = await attachConversationSummaries([bookingJson], userId, roles);
  return withSummary ?? bookingJson;
}
