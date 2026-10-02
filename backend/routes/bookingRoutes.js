import express from 'express';
import * as bookingController from '../controllers/bookingController.js';
import * as weatherCancellationController from '../controllers/weatherCancellationController.js';
import { authenticate, authorize, requireVerifiedEmail } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import {
  cancellationSchema,
  createBookingSchema,
  confirmBookingSchema,
  declineBookingSchema,
  completeBookingSchema,
  noShowBookingSchema,
  weatherCancellationRequestSchema,
} from '../config/validation.js';

const router = express.Router();

router.post(
  '/confirm',
  authenticate,
  authorize('student'),
  requireVerifiedEmail,
  validateRequest(confirmBookingSchema),
  bookingController.confirmBooking,
);
router.get('/:id', authenticate, bookingController.getBookingById);
router.post('/', authenticate, requireVerifiedEmail, validateRequest(createBookingSchema), bookingController.createBooking);
// MVP: coach-only accept / decline for pending bookings (not PUT /status)
router.put('/:id/accept', authenticate, requireVerifiedEmail, bookingController.acceptBooking);
router.put('/:id/decline', authenticate, requireVerifiedEmail, validateRequest(declineBookingSchema), bookingController.declineBooking);
router.post('/:id/complete', authenticate, requireVerifiedEmail, validateRequest(completeBookingSchema), bookingController.completeBooking);
/** Coach records that the primary student did not attend (booking → status `student_no_show`). */
router.post('/:id/student-no-show', authenticate, requireVerifiedEmail, validateRequest(noShowBookingSchema), bookingController.markBookingNoShow);
router.post('/:id/cancel', authenticate, requireVerifiedEmail, validateRequest(cancellationSchema), bookingController.cancelBooking);
/** Mutual weather cancellation: one participant asks, the other accepts (full refund, no reliability impact) or declines. */
router.post(
  '/:id/weather-cancellation',
  authenticate,
  requireVerifiedEmail,
  validateRequest(weatherCancellationRequestSchema),
  weatherCancellationController.requestWeatherCancellation,
);
router.post('/:id/weather-cancellation/:requestId/accept', authenticate, requireVerifiedEmail, weatherCancellationController.acceptWeatherCancellation);
router.post('/:id/weather-cancellation/:requestId/decline', authenticate, requireVerifiedEmail, weatherCancellationController.declineWeatherCancellation);
router.post('/:id/weather-cancellation/:requestId/withdraw', authenticate, requireVerifiedEmail, weatherCancellationController.withdrawWeatherCancellation);

export default router;
