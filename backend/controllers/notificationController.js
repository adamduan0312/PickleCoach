import { Notification, User } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logger } from '../config/logger.js';

export const getNotifications = async (req, res) => {
  try {
    const { page, limit, status } = req.validated;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = { user_id: req.user.id };
    if (status) where.status = status;

    const notifications = await Notification.findAndCountAll({
      where,
      limit: queryLimit,
      offset,
      order: [['created_at', 'DESC']],
    });

    const response = getPagingData(notifications, page, queryLimit);
    return successResponse(res, response.items, 'Notifications retrieved successfully');
  } catch (error) {
    logger.error('Get notifications error:', error);
    return errorResponse(res, 'Failed to retrieve notifications', 500);
  }
};

export const markNotificationAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findByPk(id);

    if (!notification) {
      return errorResponse(res, 'Notification not found', 404);
    }

    if (notification.user_id !== req.user.id && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    await notification.update({ status: 'sent' });
    return successResponse(res, notification, 'Notification marked as read');
  } catch (error) {
    logger.error('Mark notification as read error:', error);
    return errorResponse(res, 'Failed to mark notification as read', 500);
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findByPk(id);

    if (!notification) {
      return errorResponse(res, 'Notification not found', 404);
    }

    if (notification.user_id !== req.user.id && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    await notification.destroy();
    return successResponse(res, null, 'Notification deleted successfully');
  } catch (error) {
    logger.error('Delete notification error:', error);
    return errorResponse(res, 'Failed to delete notification', 500);
  }
};

export const createNotification = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Only admins can create notifications', 403);
    }

    const { user_id, type, channel, payload } = req.validated;

    const notification = await Notification.create({
      user_id,
      type,
      channel,
      payload,
      status: 'pending',
    });

    return successResponse(res, notification, 'Notification created successfully', 201);
  } catch (error) {
    logger.error('Create notification error:', error);
    return errorResponse(res, 'Failed to create notification', 500);
  }
};
