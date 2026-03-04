/**
 * Reset password for an existing user (dev/convenience).
 * Usage: node scripts/reset-user-password.js <email> <new_password>
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { sequelize } from '../models/sequelize.js';
import { User } from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

async function resetPassword() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.error('Usage: node scripts/reset-user-password.js <email> <new_password>');
    process.exit(1);
  }

  try {
    await sequelize.authenticate();

    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.error('❌ No user found with email:', email);
      process.exit(1);
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await user.update({ password_hash });
    console.log('✅ Password updated for', email);
    console.log('   You can now login with the new password.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

resetPassword();
