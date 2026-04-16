import express from 'express';
import * as bookingController from '../controllers/bookingController.js';
import * as rescheduleController from '../controllers/rescheduleController.js';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { cancellationSchema, rescheduleSchema, createBookingSchema, getBookingsQuerySchema, declineBookingSchema, completeBookingSchema, noShowBookingSchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getBookingsQuerySchema), bookingController.getBookings);
router.get('/:id', authenticate, bookingController.getBookingById);
router.post('/', authenticate, requireVerifiedEmail, validateRequest(createBookingSchema), bookingController.createBooking);
// MVP: coach-only accept / decline for pending bookings (not PUT /status)
router.put('/:id/accept', authenticate, bookingController.acceptBooking);
router.put('/:id/decline', authenticate, validateRequest(declineBookingSchema), bookingController.declineBooking);
router.post('/:id/complete', authenticate, validateRequest(completeBookingSchema), bookingController.completeBooking);
/** Coach records that the primary student did not attend (booking → status `no_show`). Legacy alias: `/:id/no-show`. */
router.post('/:id/student-no-show', authenticate, validateRequest(noShowBookingSchema), bookingController.markBookingNoShow);
router.post('/:id/no-show', authenticate, validateRequest(noShowBookingSchema), bookingController.markBookingNoShow);
router.post('/:id/cancel', authenticate, validateRequest(cancellationSchema), bookingController.cancelBooking);
// Reschedule endpoint matching architecture spec: POST /api/bookings/:id/reschedule
router.post('/:id/reschedule', authenticate, validateRequest(rescheduleSchema), rescheduleController.requestReschedule);

export default router;
