import { Notification, User } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { serializeNotification } from '../utils/notificationDto.js';
import * as notificationService from '../services/notificationService.js';
import { logger } from '../config/logger.js';

const MAX_LIST_ALL_NOTIFICATIONS = 10000;

export const getNotifications = async (req, res) => {
  try {
    const { page, limit, status } = req.validated;
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_NOTIFICATIONS, offset: 0 };

    const where = { user_id: req.user.id };
    if (status) where.status = status;

    const notifications = await Notification.findAndCountAll({
      where,
      limit: queryLimit,
      offset,
      order: [['created_at', 'DESC']],
    });

    if (!isPaginated) {
      return successResponse(
        res,
        notifications.rows.map(serializeNotification),
        'Notifications retrieved successfully',
      );
    }

    const response = getPagingData(notifications, page, queryLimit);
    return paginatedResponse(
      res,
      response.items.map(serializeNotification),
      response.pagination,
      'Notifications retrieved successfully',
    );
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

    await notification.update({
      status: 'sent',
      read_at: notification.read_at || new Date(),
    });
    return successResponse(res, serializeNotification(notification), 'Notification marked as read');
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

    const { user_id, type, channel, payload, entity_type, entity_id } = req.validated;

    const notification = await notificationService.createNotification(
      user_id,
      type,
      channel,
      payload,
      { entity_type, entity_id },
    );

    // Admin create should deliver immediately (in_app → sent; email/sms via provider).
    const sent = await notificationService.sendNotification(notification.id);

    return successResponse(res, serializeNotification(sent), 'Notification created successfully', 201);
  } catch (error) {
    logger.error('Create notification error:', error);
    return errorResponse(res, 'Failed to create notification', 500);
  }
};
