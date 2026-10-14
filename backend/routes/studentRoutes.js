import express from 'express';
import * as reliabilityController from '../controllers/reliabilityController.js';
import * as bookingController from '../controllers/bookingController.js';
import * as reviewController from '../controllers/reviewController.js';
import * as favoriteCoachController from '../controllers/favoriteCoachController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateQuery, validateRequest } from '../middleware/validator.js';
import { addFavoriteCoachBodySchema, getBookingsQuerySchema, getReviewsQuerySchema } from '../config/validation.js';

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
/** Reviews the authenticated student wrote. */
router.get(
  '/me/reviews',
  authenticate,
  authorize('student'),
  validateQuery(getReviewsQuerySchema),
  reviewController.getMyWrittenReviews,
);

/** Saved coaches. The student is always the authenticated user. */
router.get('/me/favorites/ids', authenticate, authorize('student'), favoriteCoachController.listFavoriteCoachIds);
router.get('/me/favorites', authenticate, authorize('student'), favoriteCoachController.listFavoriteCoaches);
router.post(
  '/me/favorites',
  authenticate,
  authorize('student'),
  validateRequest(addFavoriteCoachBodySchema),
  favoriteCoachController.addFavoriteCoach,
);
router.delete('/me/favorites/:coachId', authenticate, authorize('student'), favoriteCoachController.removeFavoriteCoach);

export default router;
