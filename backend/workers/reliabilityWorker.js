import { User, UserReliability, Booking, CancellationHistory, RescheduleHistory } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';

/**
 * Recalculate reliability scores for all users
 * Runs daily at 2 AM
 */
export const recalculateReliability = async () => {
  try {
    const users = await User.findAll({
      where: {
        role: { [Op.in]: ['student', 'coach'] },
        is_active: true,
      },
    });

    for (const user of users) {
      await calculateUserReliability(user.id);
    }

    logger.info(`Reliability worker processed ${users.length} users`);
  } catch (error) {
    logger.error('Error in reliability worker:', error);
    throw error;
  }
};

/**
 * Calculate reliability score for a specific user
 */
export const calculateUserReliability = async (userId) => {
  try {
    // Get user's booking statistics
    const totalBookings = await Booking.count({
      where: {
        [Op.or]: [
          { coach_id: userId },
          { primary_student_id: userId },
        ],
        status: { [Op.in]: ['completed', 'cancelled'] },
      },
    });

    // Get bookings for this user
    const userBookings = await Booking.findAll({
      where: {
        [Op.or]: [
          { coach_id: userId },
          { primary_student_id: userId },
        ],
      },
      attributes: ['id'],
    });
    const bookingIds = userBookings.map(b => b.id);

    const reschedules = await RescheduleHistory.count({
      where: {
        booking_id: { [Op.in]: bookingIds },
        [Op.or]: [
          { requested_by: 'student' },
          { requested_by: 'coach' },
        ],
      },
    });

    const paidReschedules = await RescheduleHistory.count({
      where: {
        booking_id: { [Op.in]: bookingIds },
        paid_reschedule: true,
      },
    });

    const lateCancels = await CancellationHistory.count({
      where: {
        booking_id: { [Op.in]: bookingIds },
        penalty_amount: { [Op.gt]: 0 },
      },
    });

    const noShows = await Booking.count({
      where: {
        id: { [Op.in]: bookingIds },
        status: 'cancelled',
        // TODO: Add no-show detection logic (could check if cancelled very close to scheduled time)
      },
    });

    const coachCancels = await CancellationHistory.count({
      where: {
        booking_id: { [Op.in]: bookingIds },
        cancelled_by: 'coach',
      },
    });

    // Calculate reliability score (0-100)
    // Base score starts at 100, deduct points for negative behaviors
    let score = 100.0;

    if (totalBookings > 0) {
      const rescheduleRate = reschedules / totalBookings;
      const cancelRate = (lateCancels + noShows) / totalBookings;
      const coachCancelRate = coachCancels / totalBookings;

      // Deduct points based on rates
      score -= (rescheduleRate * 10); // Up to 10 points for reschedules
      score -= (cancelRate * 20); // Up to 20 points for cancellations
      score -= (coachCancelRate * 30); // Up to 30 points for coach cancellations

      score = Math.max(0, Math.min(100, score)); // Clamp between 0 and 100
    }

    // Update or create reliability record
    const [reliability, created] = await UserReliability.findOrCreate({
      where: { user_id: userId },
      defaults: {
        user_id: userId,
        total_bookings: totalBookings,
        reschedules: reschedules,
        paid_reschedules: paidReschedules,
        late_cancels: lateCancels,
        no_shows: noShows,
        coach_cancels: coachCancels,
        reliability_score: score,
      },
    });

    if (!created) {
      await reliability.update({
        total_bookings: totalBookings,
        reschedules: reschedules,
        paid_reschedules: paidReschedules,
        late_cancels: lateCancels,
        no_shows: noShows,
        coach_cancels: coachCancels,
        reliability_score: score,
      });
    }

    logger.info(`Calculated reliability for user ${userId}: ${score.toFixed(2)}`);
  } catch (error) {
    logger.error(`Error calculating reliability for user ${userId}:`, error);
    throw error;
  }
};

