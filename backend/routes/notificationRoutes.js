import express from 'express';
import * as notificationController from '../controllers/notificationController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, notificationController.getNotifications);
router.post('/', authenticate, authorize('admin'), notificationController.createNotification);
router.put('/:id/read', authenticate, notificationController.markNotificationAsRead);

export default router;
