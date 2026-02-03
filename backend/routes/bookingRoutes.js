import express from 'express';
import * as bookingController from '../controllers/bookingController.js';
import * as rescheduleController from '../controllers/rescheduleController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { cancellationSchema, rescheduleSchema, createBookingSchema, updateBookingStatusSchema, getBookingsQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getBookingsQuerySchema), bookingController.getBookings);
router.get('/:id', authenticate, bookingController.getBookingById);
router.post('/', authenticate, validateRequest(createBookingSchema), bookingController.createBooking);
router.put('/:id/status', authenticate, validateRequest(updateBookingStatusSchema), bookingController.updateBookingStatus);
router.post('/:id/cancel', authenticate, validateRequest(cancellationSchema), bookingController.cancelBooking);
// Reschedule endpoint matching architecture spec: POST /api/bookings/:id/reschedule
router.post('/:id/reschedule', authenticate, validateRequest(rescheduleSchema), rescheduleController.requestReschedule);

export default router;
