import { Message, Conversation, Booking, User } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';

export const getConversations = async (req, res) => {
  try {
    const { booking_id } = req.query;
    const where = {};
    if (booking_id) where.booking_id = booking_id;

    const conversations = await Conversation.findAll({
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
      order: [['created_at', 'DESC']],
    });

    return successResponse(res, conversations, 'Conversations retrieved successfully');
  } catch (error) {
    console.error('Get conversations error:', error);
    return errorResponse(res, 'Failed to retrieve conversations', 500);
  }
};

export const getConversationById = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const conversation = await Conversation.findByPk(id, {
      include: [
        { model: Booking, as: 'booking' },
        {
          model: Message,
          as: 'messages',
          limit: queryLimit,
          offset,
          order: [['created_at', 'ASC']],
          include: [
            { model: User, as: 'sender', attributes: ['id', 'full_name', 'avatar_url'] },
            { model: User, as: 'receiver', attributes: ['id', 'full_name', 'avatar_url'] },
          ],
        },
      ],
    });

    if (!conversation) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    return successResponse(res, conversation, 'Conversation retrieved successfully');
  } catch (error) {
    console.error('Get conversation error:', error);
    return errorResponse(res, 'Failed to retrieve conversation', 500);
  }
};

export const createConversation = async (req, res) => {
  try {
    const { booking_id } = req.body;

    if (booking_id) {
      const booking = await Booking.findByPk(booking_id);
      if (!booking) {
        return errorResponse(res, 'Booking not found', 404);
      }

      if (req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id && req.user.role !== 'admin') {
        return errorResponse(res, 'Unauthorized', 403);
      }

      const existingConversation = await Conversation.findOne({ where: { booking_id } });
      if (existingConversation) {
        return successResponse(res, existingConversation, 'Conversation already exists');
      }
    }

    const conversation = await Conversation.create({ booking_id });
    return successResponse(res, conversation, 'Conversation created successfully', 201);
  } catch (error) {
    console.error('Create conversation error:', error);
    return errorResponse(res, 'Failed to create conversation', 500);
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { conversation_id, content, attachments } = req.body;

    const conversation = await Conversation.findByPk(conversation_id, {
      include: [{ model: Booking, as: 'booking' }],
    });

    if (!conversation) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    if (conversation.booking) {
      if (conversation.booking.messaging_locked && req.user.role !== 'admin') {
        return errorResponse(res, 'Messaging is locked for this booking', 403);
      }

      if (req.user.id !== conversation.booking.coach_id && 
          req.user.id !== conversation.booking.primary_student_id && 
          req.user.role !== 'admin') {
        return errorResponse(res, 'Unauthorized', 403);
      }

      const receiverId = req.user.id === conversation.booking.coach_id 
        ? conversation.booking.primary_student_id 
        : conversation.booking.coach_id;

      const message = await Message.create({
        conversation_id,
        sender_id: req.user.id,
        receiver_id: receiverId,
        content,
        attachments,
      });

      return successResponse(res, message, 'Message sent successfully', 201);
    }

    return errorResponse(res, 'Invalid conversation', 400);
  } catch (error) {
    console.error('Send message error:', error);
    return errorResponse(res, 'Failed to send message', 500);
  }
};

export const markMessageAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findByPk(id);

    if (!message) {
      return errorResponse(res, 'Message not found', 404);
    }

    if (req.user.id !== message.receiver_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    await message.update({ read_at: new Date() });
    return successResponse(res, message, 'Message marked as read');
  } catch (error) {
    console.error('Mark message as read error:', error);
    return errorResponse(res, 'Failed to mark message as read', 500);
  }
};
