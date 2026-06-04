import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { sequelize } from '../models/sequelize.js';
import { User, UserRole } from '../models/index.js';

// Load environment variables
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

async function createFirstAdmin() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connected');
    
    const email = process.argv[2];
    const password = process.argv[3];
    const fullName = process.argv[4] || 'Admin User';

    if (!email || !password) {
      console.error('❌ Usage: node create-first-admin.js <email> <password> [full_name]');
      process.exit(1);
    }

    console.log(`📧 Checking if user with email ${email} already exists...`);
    const existingAdmin = await User.findOne({ where: { email } });

    if (existingAdmin) {
      console.log('⚠️  User already exists. Updating password and ensuring admin/active...');
      const password_hash = await bcrypt.hash(password, 10);
      await existingAdmin.update({
        password_hash,
        full_name: fullName,
        is_active: true,
        deleted_at: null,
      });
      await UserRole.findOrCreate({
        where: { user_id: existingAdmin.id, role: 'admin' },
        defaults: { user_id: existingAdmin.id, role: 'admin' },
      });
      console.log('✅ Password updated! You can now login with this email and password.');
      console.log(`   ID: ${existingAdmin.id}`);
      console.log(`   Name: ${existingAdmin.full_name}`);
      console.log(`   Email: ${existingAdmin.email}`);
      await sequelize.close();
      process.exit(0);
      return;
    }

    console.log('🔐 Hashing password...');
    const password_hash = await bcrypt.hash(password, 10);

    console.log('👤 Creating admin user...');
    const admin = await User.create({
      full_name: fullName,
      email,
      password_hash,
      is_active: true,
    });
    await UserRole.create({ user_id: admin.id, role: 'admin' });

    console.log('✅ Admin created successfully!');
    console.log(`   ID: ${admin.id}`);
    console.log(`   Name: ${admin.full_name}`);
    console.log(`   Email: ${admin.email}`);
    console.log('   Roles: admin');
    console.log(`   Created: ${admin.created_at}`);
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error);
    process.exit(1);
  }
}

createFirstAdmin();
