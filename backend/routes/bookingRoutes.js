import express from 'express';
import * as bookingController from '../controllers/bookingController.js';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import {
  cancellationSchema,
  createBookingSchema,
  confirmBookingSchema,
  declineBookingSchema,
  completeBookingSchema,
  noShowBookingSchema,
} from '../config/validation.js';

const router = express.Router();

router.post(
  '/confirm',
  authenticate,
  requireVerifiedEmail,
  validateRequest(confirmBookingSchema),
  bookingController.confirmBooking,
);
router.get('/:id', authenticate, bookingController.getBookingById);
router.post('/', authenticate, requireVerifiedEmail, validateRequest(createBookingSchema), bookingController.createBooking);
// MVP: coach-only accept / decline for pending bookings (not PUT /status)
router.put('/:id/accept', authenticate, bookingController.acceptBooking);
router.put('/:id/decline', authenticate, validateRequest(declineBookingSchema), bookingController.declineBooking);
router.post('/:id/complete', authenticate, validateRequest(completeBookingSchema), bookingController.completeBooking);
/** Coach records that the primary student did not attend (booking → status `student_no_show`). */
router.post('/:id/student-no-show', authenticate, validateRequest(noShowBookingSchema), bookingController.markBookingNoShow);
router.post('/:id/cancel', authenticate, validateRequest(cancellationSchema), bookingController.cancelBooking);

export default router;
