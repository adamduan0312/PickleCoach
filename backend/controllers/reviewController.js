import { Review, Booking, User } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { validateReviewCreateAuthorization } from '../utils/reviewCreateAuthorization.js';
import { recalculateCoachRatingFromReviews } from '../utils/recalculateCoachRating.js';
import { logger } from '../config/logger.js';
import { serializeReview } from '../utils/reviewDto.js';
import * as userLifecycle from '../utils/userLifecycle.js';
import * as notificationService from '../services/notificationService.js';

const MAX_LIST_ALL_REVIEWS = 10000;

/** Mutable deps for unit tests (ESM named exports are read-only). */
export const reviewListDeps = {
  findPublicActiveCoach: (coachId) => userLifecycle.findPublicActiveCoach(coachId),
};

const reviewIncludes = [
  {
    model: Booking,
    as: 'booking',
    attributes: ['id', 'scheduled_at', 'status', 'lesson_id', 'coach_id', 'primary_student_id'],
  },
  { model: User, as: 'student', attributes: ['id', 'full_name', 'avatar_url'] },
  { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
];

async function respondWithReviewList(req, res, { where, successMessage, failureMessage, logLabel }) {
  const { page, limit } = req.validated || {};

  if (page == null && limit == null) {
    const reviews = await Review.findAll({
      where,
      include: reviewIncludes,
      limit: MAX_LIST_ALL_REVIEWS,
      order: [['created_at', 'DESC']],
    });
    return successResponse(res, reviews.map(serializeReview), successMessage);
  }

  const { limit: queryLimit, offset } = getPagination(page, limit);
  const reviews = await Review.findAndCountAll({
    where,
    include: reviewIncludes,
    limit: queryLimit,
    offset,
    order: [['created_at', 'DESC']],
  });

  const response = getPagingData(
    { count: reviews.count, rows: reviews.rows.map(serializeReview) },
    page,
    queryLimit,
  );
  return paginatedResponse(res, response.items, response.pagination, successMessage);
}

/**
 * GET /api/reviews — **deprecated**. Use purpose-specific review lists instead.
 */
export const getReviews = async (req, res) => {
  return errorResponse(
    res,
    'GET /api/reviews is gone. Use GET /api/coaches/:id/reviews (reviews about a coach), GET /api/students/me/reviews (reviews you wrote), GET /api/coaches/me/reviews (reviews about you), or GET /api/admin/reviews (admin inventory).',
    410,
    null,
    { code: 'reviews_catalog_removed' },
  );
};

/**
 * GET /api/coaches/:id/reviews
 * Marketplace / profile: reviews about this coach.
 */
export const getCoachReviewsById = async (req, res) => {
  try {
    const coachId = req.params.id != null ? parseInt(req.params.id, 10) : null;
    if (!coachId || Number.isNaN(coachId)) {
      return errorResponse(res, 'Valid coach ID is required', 400);
    }

    const coach = await reviewListDeps.findPublicActiveCoach(coachId);
    if (!coach) {
      return errorResponse(res, 'Coach not found', 404);
    }

    return respondWithReviewList(req, res, {
      where: {
        coach_id: coachId,
      },
      successMessage: 'Reviews retrieved successfully',
      failureMessage: 'Failed to retrieve reviews',
      logLabel: 'Get coach reviews by id error',
    });
  } catch (error) {
    logger.error('Get coach reviews by id error:', error);
    return errorResponse(res, 'Failed to retrieve reviews', 500);
  }
};

/**
 * GET /api/students/me/reviews — reviews the authenticated student wrote.
 */
export const getMyWrittenReviews = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('student')) {
      return errorResponse(res, 'Only students can list reviews they have written', 403);
    }

    return respondWithReviewList(req, res, {
      where: { student_id: req.user.id },
      successMessage: 'My written reviews retrieved successfully',
      failureMessage: 'Failed to retrieve reviews',
      logLabel: 'Get my written reviews error',
    });
  } catch (error) {
    logger.error('Get my written reviews error:', error);
    return errorResponse(res, 'Failed to retrieve reviews', 500);
  }
};

/**
 * GET /api/coaches/me/reviews — reviews about the authenticated coach.
 */
export const getMyReceivedReviews = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, 'Only coaches can list reviews about themselves', 403);
    }

    return respondWithReviewList(req, res, {
      where: { coach_id: req.user.id },
      successMessage: 'Reviews about me retrieved successfully',
      failureMessage: 'Failed to retrieve reviews',
      logLabel: 'Get my received reviews error',
    });
  } catch (error) {
    logger.error('Get my received reviews error:', error);
    return errorResponse(res, 'Failed to retrieve reviews', 500);
  }
};

/**
 * GET /api/admin/reviews — full inventory; optional coach_id / student_id.
 */
export const getAdminReviews = async (req, res) => {
  try {
    const { coach_id, student_id } = req.validated || {};
    const where = {};
    if (coach_id != null) where.coach_id = coach_id;
    if (student_id != null) where.student_id = student_id;

    return respondWithReviewList(req, res, {
      where,
      successMessage: 'Reviews retrieved successfully',
      failureMessage: 'Failed to retrieve reviews',
      logLabel: 'Get admin reviews error',
    });
  } catch (error) {
    logger.error('Get admin reviews error:', error);
    return errorResponse(res, 'Failed to retrieve reviews', 500);
  }
};

export const createReview = async (req, res) => {
  try {
    const { booking_id, rating, comment } = req.validated;

    const booking = await Booking.findByPk(booking_id);

    const existingReview = booking
      ? await Review.findOne({ where: { booking_id } })
      : null;

    const auth = validateReviewCreateAuthorization({
      userId: req.user.id,
      booking,
      hasExistingReview: Boolean(existingReview),
    });
    if (!auth.ok) {
      return errorResponse(
        res,
        auth.message,
        auth.statusCode,
        null,
        auth.code ? { code: auth.code } : null,
      );
    }

    const review = await Review.create({
      booking_id,
      student_id: req.user.id,
      coach_id: auth.coachId,
      rating,
      comment,
    });

    await recalculateCoachRatingFromReviews(booking.coach_id);

    await logAudit(req.user.id, 'review_created', 'reviews', review.id, null, review.toJSON(), req);

    void notificationService.notifyReviewReceived({
      reviewId: review.id,
      bookingId: booking.id,
      coachId: booking.coach_id,
      rating: review.rating,
      studentName: req.user.full_name,
    }).catch((err) => {
      logger.warn({
        component: 'reviews',
        event: 'review_received_notify_failed',
        reviewId: review.id,
        bookingId: booking.id,
        message: err?.message,
      });
    });

    return successResponse(res, serializeReview(review), 'Review created successfully', 201);
  } catch (error) {
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return errorResponse(res, 'Review already exists for this booking', 409);
    }
    logger.error('Create review error:', error);
    return errorResponse(res, 'Failed to create review', 500);
  }
};

export const updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const review = await Review.findByPk(id);

    if (!review) {
      return errorResponse(res, 'Review not found', 404);
    }

    if (req.user.id !== review.student_id && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const { rating, comment } = req.validated;
    const beforeState = review.toJSON();
    const ratingChanged = rating !== undefined && rating !== review.rating;

    await review.update({
      rating: rating !== undefined ? rating : review.rating,
      comment: comment !== undefined ? comment : review.comment,
    });

    if (ratingChanged) {
      await recalculateCoachRatingFromReviews(review.coach_id);
    }

    await logAudit(req.user.id, 'review_updated', 'reviews', review.id, beforeState, review.toJSON(), req);

    return successResponse(res, serializeReview(review), 'Review updated successfully');
  } catch (error) {
    logger.error('Update review error:', error);
    return errorResponse(res, 'Failed to update review', 500);
  }
};

export const deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    const review = await Review.findByPk(id);

    if (!review) {
      return errorResponse(res, 'Review not found', 404);
    }

    if (req.user.id !== review.student_id && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const coachUserId = review.coach_id;
    const beforeState = review.toJSON();
    await review.destroy();
    await recalculateCoachRatingFromReviews(coachUserId);
    await logAudit(req.user.id, 'review_deleted', 'reviews', id, beforeState, null, req);

    return successResponse(res, null, 'Review deleted successfully');
  } catch (error) {
    logger.error('Delete review error:', error);
    return errorResponse(res, 'Failed to delete review', 500);
  }
};
