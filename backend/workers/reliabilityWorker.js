import { User, UserReliability, Booking } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { updateUserReliability } from '../services/reliabilityService.js';

/**
 * Recalculate reliability scores for all users
 * Runs daily at 2 AM
 */
export const recalculateReliability = async () => {
  try {
    const users = await User.findAll({
      where: {
        role: { [Op.in]: ['student', 'coach', 'admin'] },
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

