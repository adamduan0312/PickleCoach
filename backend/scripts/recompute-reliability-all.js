/**
 * Recompute reliability for all users with student/coach roles.
 *
 * Usage:
 *   node scripts/recompute-reliability-all.js
 */
import dotenv from 'dotenv';
import { sequelize } from '../models/sequelize.js';
import { UserRole } from '../models/index.js';
import { updateUserReliability } from '../services/reliabilityService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

async function main() {
  try {
    await sequelize.authenticate();

    const roleRows = await UserRole.findAll({
      where: {
        role: ['coach', 'student'],
      },
      attributes: ['user_id', 'role'],
      order: [['user_id', 'ASC']],
    });

    if (!roleRows.length) {
      console.log('No student/coach user roles found. Nothing to recompute.');
      process.exit(0);
    }

    let updated = 0;
    let failed = 0;

    for (const row of roleRows) {
      const userId = row.user_id;
      const role = row.role;
      try {
        await updateUserReliability(userId, role);
        updated += 1;
      } catch (error) {
        failed += 1;
        console.error(`Failed recompute for user_id=${userId}, role=${role}:`, error.message);
      }
    }

    console.log(
      JSON.stringify(
        {
          total_role_rows: roleRows.length,
          recomputed: updated,
          failed,
        },
        null,
        2,
      ),
    );

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Failed reliability recompute:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
