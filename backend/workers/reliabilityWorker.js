import { User, UserRole, SystemJob } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';

/**
 * Recalculate reliability scores for users with coach and/or student capability (separate rows).
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
      const roles = getEffectiveRolesForUserRecord(user);
      if (roles.includes('coach')) {
        await updateUserReliability(user.id, 'coach', { skipIfAdminOverride: true }).catch((err) => {
          logger.error(`Coach reliability failed for user ${user.id}:`, err);
        });
        updates += 1;
      }
      if (roles.includes('student')) {
        await updateUserReliability(user.id, 'student', { skipIfAdminOverride: true }).catch((err) => {
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
    const roles = getEffectiveRolesForUserRecord(user);
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
 * Monthly coach reliability job — full recompute from source data (metrics + score stay aligned).
 * Previously this reset only `reliability_score` to 100, which contradicted persisted counters.
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
      logger.info('Monthly coach reliability job already completed this month');
      return;
    }

    const systemJob = await SystemJob.create({
      job_type: jobType,
      status: 'pending',
      scheduled_at: now,
      payload: { action: 'monthly_coach_recompute', month: now.getMonth() + 1, year: now.getFullYear() },
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

      let recomputeCount = 0;

      for (const coach of coaches) {
        const fullUser = await User.findByPk(coach.id, {
          include: [{ model: UserRole, as: 'userRoles', attributes: ['role'], required: false }],
        });
        const roles = getEffectiveRolesForUserRecord(fullUser);
        if (!roles.includes('coach')) continue;

        await updateUserReliability(coach.id, 'coach', { skipIfAdminOverride: true }).catch((err) => {
          logger.error(`Monthly coach reliability recompute failed for ${coach.id}:`, err);
        });
        recomputeCount += 1;
        logger.info(`Recomputed coach reliability for user ${coach.id} (${coach.full_name})`);
      }

      await systemJob.update({
        status: 'completed',
        attempted_at: new Date(),
      });

      logger.info(`Monthly coach reliability job completed: ${recomputeCount} coaches recomputed`);
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
    logger.error('Error in monthly coach reliability job:', error);
    throw error;
  }
};
