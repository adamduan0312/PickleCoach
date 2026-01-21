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

    // booking_id is REQUIRED - conversations must be booking-scoped
    if (!booking_id) {
      return errorResponse(res, 'booking_id is required', 400);
    }

    const booking = await Booking.findByPk(booking_id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    // Check if messaging is locked (unlocks only after payment capture)
    // This prevents pre-booking messaging as per architecture spec
    if (booking.messaging_locked && req.user.role !== 'admin') {
      return errorResponse(res, 'Messaging is locked for this booking. Payment must be captured first.', 403);
    }

    // Check if conversation already exists for this booking
    const existingConversation = await Conversation.findOne({ where: { booking_id } });
    if (existingConversation) {
      return successResponse(res, existingConversation, 'Conversation already exists');
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

    // All conversations must have a booking (booking_id is required)
    if (!conversation.booking) {
      return errorResponse(res, 'Conversation must be associated with a booking', 400);
    }

    // Check if messaging is locked (unlocks only after payment capture)
    if (conversation.booking.messaging_locked && req.user.role !== 'admin') {
      return errorResponse(res, 'Messaging is locked for this booking. Payment must be captured first.', 403);
    }

    // Verify user is authorized (must be coach or student on the booking)
    if (req.user.id !== conversation.booking.coach_id && 
        req.user.id !== conversation.booking.primary_student_id && 
        req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    // Receiver is inferred from conversation booking (no need to store receiver_id)
    const message = await Message.create({
      conversation_id,
      sender_id: req.user.id,
      content,
      attachments,
    });

    return successResponse(res, message, 'Message sent successfully', 201);
  } catch (error) {
    console.error('Send message error:', error);
    return errorResponse(res, 'Failed to send message', 500);
  }
};

export const markMessageAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findByPk(id, {
      include: [
        { model: Conversation, as: 'conversation', include: [{ model: Booking, as: 'booking' }] },
      ],
    });

    if (!message) {
      return errorResponse(res, 'Message not found', 404);
    }

    // Determine receiver from conversation booking
    const booking = message.conversation?.booking;
    if (!booking) {
      return errorResponse(res, 'Message conversation missing booking', 400);
    }

    const receiverId = message.sender_id === booking.coach_id 
      ? booking.primary_student_id 
      : booking.coach_id;

    if (req.user.id !== receiverId && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    await message.update({ read_at: new Date() });
    return successResponse(res, message, 'Message marked as read');
  } catch (error) {
    console.error('Mark message as read error:', error);
    return errorResponse(res, 'Failed to mark message as read', 500);
  }
};
