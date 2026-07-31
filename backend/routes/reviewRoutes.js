import express from 'express';
import * as reviewController from '../controllers/reviewController.js';
import { authenticate, authorize, requireVerifiedEmail } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { reviewSchema, updateReviewSchema, getReviewsQuerySchema } from '../config/validation.js';

const router = express.Router();

/** Deprecated catalog — use coaches/:id/reviews, students/me/reviews, coaches/me/reviews, admin/reviews. */
router.get('/', authenticate, validateQuery(getReviewsQuerySchema), reviewController.getReviews);
router.post(
  '/',
  authenticate,
  authorize('student'),
  requireVerifiedEmail,
  validateRequest(reviewSchema),
  reviewController.createReview,
);
router.put('/:id', authenticate, validateRequest(updateReviewSchema), reviewController.updateReview);
router.delete('/:id', authenticate, reviewController.deleteReview);

export default router;
