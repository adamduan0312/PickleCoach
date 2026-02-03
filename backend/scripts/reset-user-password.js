import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { sequelize } from '../models/sequelize.js';
import { User } from '../models/index.js';

// Load environment variables
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

async function resetPassword(email, newPassword) {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connected');
    
    console.log(`📧 Looking up user with email: ${email}...`);
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.error(`❌ User with email ${email} not found`);
      await sequelize.close();
      process.exit(1);
    }

    console.log(`🔐 Hashing new password...`);
    const password_hash = await bcrypt.hash(newPassword, 10);
    
    console.log(`💾 Updating password...`);
    await user.update({ password_hash });
    
    console.log(`✅ Password reset successfully!`);
    console.log(`   Email: ${email}`);
    console.log(`   New password: ${newPassword}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   User name: ${user.full_name}`);
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting password:', error);
    if (error.message) {
      console.error(`   ${error.message}`);
    }
    await sequelize.close().catch(() => {});
    process.exit(1);
  }
}

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('❌ Usage: node backend/scripts/reset-user-password.js <email> <new_password>');
  console.error('   Example: node backend/scripts/reset-user-password.js user@example.com mynewpassword');
  process.exit(1);
}

resetPassword(email, password);