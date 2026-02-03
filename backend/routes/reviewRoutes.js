import express from 'express';
import * as reviewController from '../controllers/reviewController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { reviewSchema, updateReviewSchema, getReviewsQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', validateQuery(getReviewsQuerySchema), reviewController.getReviews);
router.post('/', authenticate, validateRequest(reviewSchema), reviewController.createReview);
router.put('/:id', authenticate, validateRequest(updateReviewSchema), reviewController.updateReview);
router.delete('/:id', authenticate, reviewController.deleteReview);

export default router;
