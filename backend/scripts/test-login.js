/**
 * Test login: verify user exists, is active, and password matches.
 * Usage: node scripts/test-login.js <email> <password>
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { sequelize } from '../models/sequelize.js';
import { User } from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

async function testLogin() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: node scripts/test-login.js <email> <password>');
    process.exit(1);
  }

  try {
    await sequelize.authenticate();

    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.error('❌ No user found with email:', email);
      console.error('   Create one with: node scripts/create-first-admin.js', email, '"<password>"', '"Your Name"');
      process.exit(1);
    }

    console.log('✅ User found: id=%s, email=%s, role=%s, is_active=%s', user.id, user.email, user.role, user.is_active);

    if (!user.is_active) {
      console.error('❌ Account is inactive');
      process.exit(1);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      console.error('❌ Password does not match');
      process.exit(1);
    }

    console.log('✅ Password is correct');
    console.log('\nPostman: POST {{api_url}}/auth/login');
    console.log('Body (raw JSON):');
    console.log(JSON.stringify({ email, password }, null, 2));
    console.log('Header: Content-Type: application/json');
    console.log('(Ensure api_url = http://localhost:4000/api)');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

testLogin();
