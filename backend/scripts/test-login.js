import dotenv from 'dotenv';
import { sequelize } from '../models/sequelize.js';
import { User } from '../models/index.js';
import bcrypt from 'bcryptjs';

// Load environment variables
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

async function testLogin() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connected\n');
    
    const email = process.argv[2] || 'adamduan0312@gmail.com';
    const password = process.argv[3] || '03122003';

    console.log(`📧 Testing login for: ${email}`);
    console.log(`🔐 Password: ${password}\n`);
    
    // Step 1: Check if user exists
    console.log('Step 1: Checking if user exists...');
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      console.log('❌ User NOT found in database');
      console.log('\n💡 You need to create the user first:');
      console.log(`   node scripts/create-first-admin.js ${email} "${password}" "Adam Duan"`);
      await sequelize.close();
      process.exit(1);
    }
    console.log('✅ User found!');
    console.log(`   ID: ${user.id}`);
    console.log(`   Name: ${user.full_name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Active: ${user.is_active}\n`);
    
    // Step 2: Check if user is active
    if (!user.is_active) {
      console.log('❌ User account is INACTIVE');
      console.log('   The account exists but is marked as inactive.');
      await sequelize.close();
      process.exit(1);
    }
    console.log('✅ User account is active\n');
    
    // Step 3: Test password
    console.log('Step 2: Testing password...');
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      console.log('❌ Password does NOT match!');
      console.log('   The password you provided does not match the stored password hash.');
      console.log('   You may need to recreate the user with the correct password.');
      await sequelize.close();
      process.exit(1);
    }
    console.log('✅ Password is correct!\n');
    
    // Step 4: Show Postman instructions
    console.log('='.repeat(60));
    console.log('✅ LOGIN TEST PASSED - User can login successfully!');
    console.log('='.repeat(60));
    console.log('\n📝 Postman Login Request:');
    console.log('   Method: POST');
    console.log('   URL: {{api_url}}/auth/login');
    console.log('   (Make sure {{api_url}} = http://localhost:4000/api)');
    console.log('\n   Headers:');
    console.log('     Content-Type: application/json');
    console.log('\n   Body (raw JSON):');
    console.log('   {');
    console.log(`     "email": "${email}",`);
    console.log(`     "password": "${password}"`);
    console.log('   }');
    console.log('\n💡 Expected Response:');
    console.log('   Status: 200 OK');
    console.log('   Body: {');
    console.log('     "success": true,');
    console.log('     "data": {');
    console.log('       "user": { ... },');
    console.log('       "token": "eyJhbGc..."');
    console.log('     },');
    console.log('     "message": "Login successful"');
    console.log('   }');
    console.log('\n⚠️  Common Issues:');
    console.log('   1. Server not running → Run: npm start (in backend folder)');
    console.log('   2. Wrong URL → Should be /api/auth/login (not /auth/login)');
    console.log('   3. api_url variable not set → Set api_url = http://localhost:4000/api');
    console.log('   4. JSON format wrong → Make sure body is raw JSON, not form-data');
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.name === 'SequelizeConnectionError') {
      console.error('\n💡 Database connection failed. Make sure:');
      console.error('   1. MySQL is running');
      console.error('   2. Database credentials in config/config.json are correct');
      console.error('   3. Database "picklecoach_development" exists');
    }
    process.exit(1);
  }
}

testLogin();
