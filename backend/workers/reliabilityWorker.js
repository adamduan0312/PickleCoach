import { User, UserReliability, Booking, SystemJob } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { updateUserReliability } from '../services/reliabilityService.js';

/**
 * Recalculate reliability scores for all users
 * Runs daily at 2 AM
 */
export const recalculateReliability = async () => {
  try {
    // Only process coaches and students - admins are excluded from reliability
    const users = await User.findAll({
      where: {
        role: { [Op.in]: ['student', 'coach'] }, // Admins excluded
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
 * Uses the updated service that separates coach and student reliability
 */
export const calculateUserReliability = async (userId) => {
  try {
    await updateUserReliability(userId);
    logger.info(`Calculated reliability for user ${userId}`);
  } catch (error) {
    logger.error(`Error calculating reliability for user ${userId}:`, error);
    throw error;
  }
};

/**
 * Monthly coach reliability reset
 * On the 1st of each month, reset reliability_score to 100 for all coaches
 * Historical data (reschedule_history, cancellation_history, audit_logs) are NEVER deleted
 * Only the reliability_score field is reset - this is a "soft reset"
 */
export const monthlyCoachReliabilityReset = async () => {
  const jobType = 'recalculate_reliability';
  
  try {
    // Check if job already ran this month
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const existingJob = await SystemJob.findOne({
      where: {
        job_type: jobType,
        status: 'completed',
        scheduled_at: {
          [Op.gte]: firstOfMonth,
        },
      },
    });

    if (existingJob) {
      logger.info('Monthly coach reliability reset already completed this month');
      return;
    }

    // Create system job record
    const systemJob = await SystemJob.create({
      job_type: jobType,
      status: 'pending',
      scheduled_at: now,
      payload: { action: 'monthly_coach_reset', month: now.getMonth() + 1, year: now.getFullYear() },
    });

    try {
      // Find all active coaches (admins excluded from reliability)
      const coaches = await User.findAll({
        where: {
          role: 'coach', // Admins excluded - they don't have reliability scores
          is_active: true,
        },
      });

      let resetCount = 0;

      for (const coach of coaches) {
        // Check if user has coach bookings
        const coachBookings = await Booking.count({
          where: { coach_id: coach.id },
        });

        // Reset reliability for coaches (all coaches in the query are valid)
        if (coachBookings > 0) {
          // Get or create reliability record
          const [reliability, created] = await UserReliability.findOrCreate({
            where: { user_id: coach.id },
            defaults: {
              user_id: coach.id,
              reliability_score: 100.00,
            },
          });

          if (!created) {
            // Soft reset: only reset the score, keep all historical metrics
            await reliability.update({
              reliability_score: 100.00,
            });
            resetCount++;
          } else {
            resetCount++;
          }

          logger.info(`Reset reliability score for coach ${coach.id} (${coach.full_name})`);
        }
      }

      // Mark job as completed
      await systemJob.update({
        status: 'completed',
        attempted_at: new Date(),
      });

      logger.info(`Monthly coach reliability reset completed: ${resetCount} coaches reset`);
    } catch (error) {
      // Mark job as failed
      await systemJob.update({
        status: 'failed',
        attempted_at: new Date(),
        last_error: error.message,
        retries: systemJob.retries + 1,
      });
      throw error;
    }
  } catch (error) {
    logger.error('Error in monthly coach reliability reset:', error);
    throw error;
  }
};

