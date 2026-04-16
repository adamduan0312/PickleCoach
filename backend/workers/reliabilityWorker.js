import { User, UserReliability, Booking, SystemJob, UserRole } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { updateUserReliability } from '../services/reliabilityService.js';

/**
 * Recalculate reliability scores for all non-admin users (coach and student rows separately).
 */
export const recalculateReliability = async () => {
  try {
    const users = await User.findAll({
      where: {
        is_active: true,
        deleted_at: { [Op.is]: null },
      },
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'], required: false }],
    });

    let updates = 0;
    for (const user of users) {
      const roles = user.userRoles?.map((r) => r.role) ?? [];
      if (roles.includes('admin')) continue;
      if (roles.includes('coach')) {
        await updateUserReliability(user.id, 'coach').catch((err) => {
          logger.error(`Coach reliability failed for user ${user.id}:`, err);
        });
        updates += 1;
      }
      if (roles.includes('student')) {
        await updateUserReliability(user.id, 'student').catch((err) => {
          logger.error(`Student reliability failed for user ${user.id}:`, err);
        });
        updates += 1;
      }
    }

    logger.info(`Reliability worker processed ${users.length} users (${updates} role updates)`);
  } catch (error) {
    logger.error('Error in reliability worker:', error);
    throw error;
  }
};

/**
 * Calculate reliability for a specific user (both roles when applicable).
 */
export const calculateUserReliability = async (userId) => {
  try {
    const user = await User.findByPk(userId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'], required: false }],
    });
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    const roles = user.userRoles?.map((r) => r.role) ?? [];
    if (roles.includes('admin')) {
      return;
    }
    if (roles.includes('coach')) {
      await updateUserReliability(userId, 'coach');
    }
    if (roles.includes('student')) {
      await updateUserReliability(userId, 'student');
    }
    logger.info(`Calculated reliability for user ${userId}`);
  } catch (error) {
    logger.error(`Error calculating reliability for user ${userId}:`, error);
    throw error;
  }
};

/**
 * Monthly coach reliability reset — only the coach role row for users who coach.
 */
export const monthlyCoachReliabilityReset = async () => {
  const jobType = 'recalculate_reliability';

  try {
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

    const systemJob = await SystemJob.create({
      job_type: jobType,
      status: 'pending',
      scheduled_at: now,
      payload: { action: 'monthly_coach_reset', month: now.getMonth() + 1, year: now.getFullYear() },
    });

    try {
      const coaches = await User.findAll({
        where: { is_active: true, deleted_at: { [Op.is]: null } },
        include: [
          {
            model: UserRole,
            as: 'userRoles',
            attributes: ['role'],
            where: { role: 'coach' },
            required: true,
          },
        ],
      });

      let resetCount = 0;

      for (const coach of coaches) {
        const fullUser = await User.findByPk(coach.id, {
          include: [{ model: UserRole, as: 'userRoles', attributes: ['role'], required: false }],
        });
        const roles = fullUser?.userRoles?.map((r) => r.role) ?? [];
        if (roles.includes('admin')) continue;

        const coachBookings = await Booking.count({
          where: { coach_id: coach.id },
        });

        if (coachBookings > 0) {
          const [reliability, created] = await UserReliability.findOrCreate({
            where: { user_id: coach.id, role: 'coach' },
            defaults: {
              user_id: coach.id,
              role: 'coach',
              reliability_score: 100.0,
            },
          });

          if (!created) {
            await reliability.update({
              reliability_score: 100.0,
            });
          }
          resetCount += 1;
          logger.info(`Reset coach reliability score for user ${coach.id} (${coach.full_name})`);
        }
      }

      await systemJob.update({
        status: 'completed',
        attempted_at: new Date(),
      });

      logger.info(`Monthly coach reliability reset completed: ${resetCount} coaches reset`);
    } catch (error) {
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
