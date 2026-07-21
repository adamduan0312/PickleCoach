import express from 'express';
import * as reliabilityController from '../controllers/reliabilityController.js';
import * as bookingController from '../controllers/bookingController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validator.js';
import { getBookingsQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/me/reliability', authenticate, authorize('student'), reliabilityController.getStudentReliabilityForMe);
/** Student dashboard — bookings where authenticated user is the primary student. */
router.get(
  '/me/bookings',
  authenticate,
  authorize('student'),
  validateQuery(getBookingsQuerySchema),
  bookingController.getStudentBookings,
);

export default router;
