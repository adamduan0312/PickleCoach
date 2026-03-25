/**
 * Check or set a user's role (dev/support).
 * Usage:
 *   node scripts/set-user-role.js <email>              # print current role
 *   node scripts/set-user-role.js <email> coach        # set role to coach
 *   node scripts/set-user-role.js <email> student      # set role to student
 */
import dotenv from 'dotenv';
import { sequelize } from '../models/sequelize.js';
import { User, UserRole } from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

async function main() {
  const email = process.argv[2];
  const newRole = process.argv[3]; // 'coach' | 'student' (admin cannot be set by this script)

  if (!email) {
    console.error('Usage: node scripts/set-user-role.js <email> [coach|student]');
    process.exit(1);
  }

  const validRoles = ['coach', 'student'];
  if (newRole && !validRoles.includes(newRole)) {
    console.error('Role must be "coach" or "student". Admins are managed via create-first-admin.js.');
    process.exit(1);
  }

  try {
    await sequelize.authenticate();

    const user = await User.findOne({
      where: { email },
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    if (!user) {
      console.error('❌ No user found with email:', email);
      process.exit(1);
    }

    const roles = user.userRoles?.map((r) => r.role) ?? [];
    console.log('User: id=%s, email=%s, roles=%s, is_active=%s', user.id, user.email, roles.join(','), user.is_active);

    if (newRole) {
      if (roles.includes('admin')) {
        console.error('❌ Cannot change an admin’s role with this script. Use admin user management.');
        process.exit(1);
      }
      if (roles.includes(newRole)) {
        console.log('Role already "%s". No change.', newRole);
        process.exit(0);
      }
      await UserRole.create({ user_id: user.id, role: newRole });
      console.log('✅ Role "%s" added. User roles: %s. User should log in again or use PUT /api/auth/me/role to get a new token.', newRole, [...roles, newRole].join(', '));
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
