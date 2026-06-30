import { Op } from 'sequelize';
import { Message, Conversation, Booking, User } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logger } from '../config/logger.js';
import {
  canAccessBookingConversation,
  canSendBookingMessage,
  isMessagingLocked,
} from '../utils/bookingMessaging.js';
import { ensureBookingConversation } from '../utils/bookingConversationSummary.js';

const MAX_LIST_ALL_CONVERSATIONS = 10000;
const MAX_LIST_ALL_MESSAGES = 10000;

function serializeMessage(message) {
  const plain = message?.toJSON ? message.toJSON() : { ...message };
  return plain;
}

function serializeConversation(conversation, { booking, messaging_locked } = {}) {
  const plain = conversation?.toJSON ? conversation.toJSON() : { ...conversation };
  if (booking) plain.booking = booking;
  if (messaging_locked != null) plain.messaging_locked = messaging_locked;
  return plain;
}

export const getConversations = async (req, res) => {
  try {
    const { booking_id, page, limit } = req.validated;
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_CONVERSATIONS, offset: 0 };
    const where = {};
    if (booking_id) where.booking_id = booking_id;

    if (!(req.user.roles || []).includes('admin')) {
      const userBookings = await Booking.findAll({
        where: {
          [Op.or]: [
            { coach_id: req.user.id },
            { primary_student_id: req.user.id },
          ],
        },
        attributes: ['id'],
      });
      const bookingIds = userBookings.map((b) => b.id);
      if (booking_id) {
        if (!bookingIds.includes(parseInt(booking_id, 10))) {
          return successResponse(res, [], 'Conversations retrieved successfully');
        }
        where.booking_id = parseInt(booking_id, 10);
      } else {
        where.booking_id = bookingIds.length ? bookingIds : [-1];
      }
    } else if (booking_id) {
      where.booking_id = booking_id;
    }

    const conversations = await Conversation.findAndCountAll({
      where,
      include: [
        { model: Booking, as: 'booking' },
        {
          model: Message,
          as: 'messages',
          limit: 1,
          order: [['created_at', 'DESC']],
          include: [
            { model: User, as: 'sender', attributes: ['id', 'full_name', 'avatar_url'] },
          ],
        },
      ],
      limit: queryLimit,
      offset,
      distinct: true,
      order: [['created_at', 'DESC']],
    });

    const rows = conversations.rows.map((row) => {
      const json = row.toJSON();
      if (json.booking) {
        json.messaging_locked = isMessagingLocked(json.booking);
      }
      return json;
    });

    if (!isPaginated) {
      return successResponse(res, rows, 'Conversations retrieved successfully');
    }

    const response = getPagingData({ ...conversations, rows }, page, queryLimit);
    return paginatedResponse(res, response.items, response.pagination, 'Conversations retrieved successfully');
  } catch (error) {
    logger.error('Get conversations error:', error);
    return errorResponse(res, 'Failed to retrieve conversations', 500);
  }
};

export const getConversationById = async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit } = req.validated;
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_MESSAGES, offset: 0 };

    const conversation = await Conversation.findByPk(id, {
      include: [{ model: Booking, as: 'booking' }],
    });

    if (!conversation) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    const booking = conversation.booking;
    if (!canAccessBookingConversation(req.user.id, req.user.roles, booking)) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const messages = await Message.findAndCountAll({
      where: { conversation_id: id },
      include: [{ model: User, as: 'sender', attributes: ['id', 'full_name', 'avatar_url'] }],
      limit: queryLimit,
      offset,
      order: [['created_at', 'ASC']],
    });

    const payload = serializeConversation(conversation, {
      booking: booking?.toJSON?.() ?? booking,
      messaging_locked: isMessagingLocked(booking),
    });
    payload.messages = messages.rows.map(serializeMessage);
    if (isPaginated) {
      const paging = getPagingData(messages, page, queryLimit);
      payload.messages_pagination = paging.pagination;
    }

    return successResponse(res, payload, 'Conversation retrieved successfully');
  } catch (error) {
    logger.error('Get conversation error:', error);
    return errorResponse(res, 'Failed to retrieve conversation', 500);
  }
};

export const createConversation = async (req, res) => {
  try {
    const { booking_id } = req.body;

    const booking = await Booking.findByPk(booking_id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    const sendCheck = canSendBookingMessage(req.user.id, req.user.roles, booking);
    if (!sendCheck.ok) {
      return errorResponse(res, sendCheck.message, sendCheck.status);
    }

    const existingConversation = await Conversation.findOne({ where: { booking_id } });
    if (existingConversation) {
      return successResponse(
        res,
        serializeConversation(existingConversation, { messaging_locked: isMessagingLocked(booking) }),
        'Conversation already exists',
      );
    }

    const conversation = await ensureBookingConversation(booking_id);
    return successResponse(
      res,
      serializeConversation(conversation, { messaging_locked: isMessagingLocked(booking) }),
      'Conversation created successfully',
      201,
    );
  } catch (error) {
    logger.error('Create conversation error:', error);
    return errorResponse(res, 'Failed to create conversation', 500);
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { conversation_id, message_text } = req.body;

    const conversation = await Conversation.findByPk(conversation_id, {
      include: [{ model: Booking, as: 'booking' }],
    });

    if (!conversation) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    if (!conversation.booking) {
      return errorResponse(res, 'Conversation must be associated with a booking', 400);
    }

    const sendCheck = canSendBookingMessage(req.user.id, req.user.roles, conversation.booking);
    if (!sendCheck.ok) {
      return errorResponse(res, sendCheck.message, sendCheck.status);
    }

    const message = await Message.create({
      conversation_id,
      sender_id: req.user.id,
      message_text,
    });

    await conversation.update({ updated_at: new Date() });

    return successResponse(res, serializeMessage(message), 'Message sent successfully', 201);
  } catch (error) {
    logger.error('Send message error:', error);
    return errorResponse(res, 'Failed to send message', 500);
  }
};
