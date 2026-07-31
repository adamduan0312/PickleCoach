import express from 'express';
import * as bookingIntentController from '../controllers/bookingIntentController.js';
import { authenticate, authorize, requireVerifiedEmail } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { createBookingIntentSchema } from '../config/validation.js';

const router = express.Router();

router.post(
  '/',
  authenticate,
  authorize('student'),
  requireVerifiedEmail,
  validateRequest(createBookingIntentSchema),
  bookingIntentController.createBookingIntent,
);

export default router;
