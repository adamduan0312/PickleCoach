import { Review, Booking, User, CoachProfile } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { Op } from 'sequelize';

export const getReviews = async (req, res) => {
  try {
    const { page = 1, limit = 10, target_user_id, reviewer_id } = req.query;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = {};
    if (target_user_id) where.target_user_id = target_user_id;
    if (reviewer_id) where.reviewer_id = reviewer_id;

    const reviews = await Review.findAndCountAll({
      where,
      include: [
        { model: Booking, as: 'booking' },
        { model: User, as: 'reviewer', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'targetUser', attributes: ['id', 'full_name', 'avatar_url'] },
      ],
      limit: queryLimit,
      offset,
      order: [['created_at', 'DESC']],
    });

    const response = getPagingData(reviews, page, queryLimit);
    return successResponse(res, response.items, 'Reviews retrieved successfully');
  } catch (error) {
    console.error('Get reviews error:', error);
    return errorResponse(res, 'Failed to retrieve reviews', 500);
  }
};

export const createReview = async (req, res) => {
  try {
    const { booking_id, target_user_id, rating, comment, attendance_badges, visibility } = req.body;

    const booking = await Booking.findByPk(booking_id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (req.user.id !== booking.primary_student_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Only the student who booked can leave a review', 403);
    }

    if (booking.status !== 'completed') {
      return errorResponse(res, 'Can only review completed bookings', 400);
    }

    const existingReview = await Review.findOne({
      where: { booking_id, reviewer_id: req.user.id },
    });

    if (existingReview) {
      return errorResponse(res, 'Review already exists for this booking', 409);
    }

    const review = await Review.create({
      booking_id,
      reviewer_id: req.user.id,
      target_user_id: target_user_id || booking.coach_id,
      rating,
      comment,
      attendance_badges,
      visibility: visibility || 'public',
    });

    // Update coach rating
    const coachReviews = await Review.findAll({
      where: { target_user_id: booking.coach_id },
    });

    const avgRating = coachReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / coachReviews.length;
    const coachProfile = await CoachProfile.findOne({ where: { user_id: booking.coach_id } });
    if (coachProfile) {
      await coachProfile.update({
        rating_average: avgRating,
        rating_count: coachReviews.length,
      });
    }

    await logAudit(req.user.id, 'review_created', 'reviews', review.id, null, review.toJSON(), req);

    return successResponse(res, review, 'Review created successfully', 201);
  } catch (error) {
    console.error('Create review error:', error);
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

    if (req.user.id !== review.reviewer_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const { rating, comment, attendance_badges, visibility } = req.body;
    const beforeState = review.toJSON();

    await review.update({
      rating: rating !== undefined ? rating : review.rating,
      comment: comment !== undefined ? comment : review.comment,
      attendance_badges: attendance_badges !== undefined ? attendance_badges : review.attendance_badges,
      visibility: visibility || review.visibility,
    });

    await logAudit(req.user.id, 'review_updated', 'reviews', review.id, beforeState, review.toJSON(), req);

    return successResponse(res, review, 'Review updated successfully');
  } catch (error) {
    console.error('Update review error:', error);
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

    if (req.user.id !== review.reviewer_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    await review.destroy();
    await logAudit(req.user.id, 'review_deleted', 'reviews', id, review.toJSON(), null, req);

    return successResponse(res, null, 'Review deleted successfully');
  } catch (error) {
    console.error('Delete review error:', error);
    return errorResponse(res, 'Failed to delete review', 500);
  }
};
