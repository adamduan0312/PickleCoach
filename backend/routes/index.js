import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import coachRoutes from './coachRoutes.js';
import courtRoutes from './courtRoutes.js';
import lessonRoutes from './lessonRoutes.js';
import bookingRoutes from './bookingRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import rescheduleRoutes from './rescheduleRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import messageRoutes from './messageRoutes.js';
import disputeRoutes from './disputeRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import adminRoutes from './adminRoutes.js';
import * as webhookController from '../controllers/webhookController.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/coaches', coachRoutes);
router.use('/courts', courtRoutes);
router.use('/lessons', lessonRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);
router.use('/reschedules', rescheduleRoutes);
router.use('/reviews', reviewRoutes);
router.use('/messages', messageRoutes);
router.use('/disputes', disputeRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

// Webhook routes (no auth, uses signature verification)
router.post('/webhooks/stripe', webhookController.stripeWebhookMiddleware, webhookController.handleStripeWebhook);

export default router;
