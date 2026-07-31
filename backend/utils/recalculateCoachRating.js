/**
 * Recompute coach_profiles.rating_average / rating_count from all reviews for that coach.
 */

import { Review, CoachProfile } from '../models/index.js';

/**
 * @param {number} coachUserId — users.id of the reviewed coach (`reviews.coach_id`)
 */
export async function recalculateCoachRatingFromReviews(coachUserId) {
  if (coachUserId == null) return null;

  const coachReviews = await Review.findAll({
    where: { coach_id: coachUserId },
    attributes: ['rating'],
  });

  const coachProfile = await CoachProfile.findOne({ where: { user_id: coachUserId } });
  if (!coachProfile) return null;

  if (coachReviews.length === 0) {
    await coachProfile.update({
      rating_average: 0,
      rating_count: 0,
    });
    return { rating_average: 0, rating_count: 0 };
  }

  const avgRating =
    coachReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / coachReviews.length;

  await coachProfile.update({
    rating_average: avgRating,
    rating_count: coachReviews.length,
  });

  return { rating_average: avgRating, rating_count: coachReviews.length };
}

/** Pure average helper for unit tests. */
export function averageReviewRatings(ratings) {
  if (!Array.isArray(ratings) || ratings.length === 0) {
    return { rating_average: 0, rating_count: 0 };
  }
  const sum = ratings.reduce((acc, r) => acc + (Number(r) || 0), 0);
  return {
    rating_average: sum / ratings.length,
    rating_count: ratings.length,
  };
}
