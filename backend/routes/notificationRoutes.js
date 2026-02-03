import express from 'express';
import * as notificationController from '../controllers/notificationController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { createNotificationSchema, getNotificationsQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getNotificationsQuerySchema), notificationController.getNotifications);
router.post('/', authenticate, authorize('admin'), validateRequest(createNotificationSchema), notificationController.createNotification);
router.put('/:id/read', authenticate, notificationController.markNotificationAsRead);

export default router;
