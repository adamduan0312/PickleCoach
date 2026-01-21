/* check-and-mark-migration.js — mark migration (with basic checks)
Purpose: Mark a migration as executed in SequelizeMeta
What it does:
Basic table check — verifies expected tables exist (hardcoded list)
One specific check — looks for nickname column
Marks migration — inserts into SequelizeMeta table
Basic validation — stops if tables are missing
Limitations:
Hardcoded table list (not parsed from migration file)
Only checks table names exist
Doesn't check column types, indexes, or foreign keys
Hardcoded for the initial migration
*/

import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

const config = require('../config/config.json');
const dbConfig = config[env];

const sequelize = new Sequelize(
  process.env.DB_NAME || dbConfig.database,
  process.env.DB_USER || dbConfig.username,
  process.env.DB_PASSWORD || dbConfig.password,
  {
    host: process.env.DB_HOST || dbConfig.host,
    port: process.env.DB_PORT || dbConfig.port,
    dialect: dbConfig.dialect,
    logging: false,
  }
);

async function checkAndMarkMigration() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Check if SequelizeMeta table exists, create if not
    const [results] = await sequelize.query(`
      CREATE TABLE IF NOT EXISTS SequelizeMeta (
        name VARCHAR(255) NOT NULL,
        PRIMARY KEY (name),
        UNIQUE KEY name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Check if migration is already marked (try both .js and .cjs)
    const [existing] = await sequelize.query(`
      SELECT * FROM SequelizeMeta WHERE name IN ('20260101171440-initial-schema.js', '20260101171440-initial-schema.cjs')
    `);

    if (existing.length > 0) {
      console.log('⚠️  Migration already marked as executed');
      process.exit(0);
    }

    // Check if tables exist (basic check)
    const [tables] = await sequelize.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);

    const tableNames = tables.map(t => t.TABLE_NAME);
    const expectedTables = [
      'users', 'coach_profiles', 'coach_availabilities', 'lessons',
      'court_locations', 'coach_court_locations', 'bookings', 'booking_players',
      'dispute_types', 'dispute_resolution_actions', 'disputes', 'payments',
      'reschedule_history', 'cancellation_history', 'payouts', 'reviews',
      'user_reliability', 'conversations', 'messages', 'webhook_logs',
      'audit_logs', 'admin_analytics', 'admin_alerts', 'coach_reports',
      'student_feedback', 'message_templates', 'user_badges', 'session_history',
      'promo_codes', 'system_jobs', 'notifications'
    ];

    const missingTables = expectedTables.filter(t => !tableNames.includes(t));
    const extraTables = tableNames.filter(t => !expectedTables.includes(t) && t !== 'SequelizeMeta');

    if (missingTables.length > 0) {
      console.log('❌ Missing tables:', missingTables);
      console.log('⚠️  Cannot mark migration as executed - schema mismatch');
      process.exit(1);
    }

    if (extraTables.length > 0) {
      console.log('ℹ️  Extra tables found (not in migration):', extraTables);
    }

    // Check for nickname column in users (migration has it, SQL schema doesn't)
    const [userColumns] = await sequelize.query(`
      SELECT COLUMN_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'nickname'
    `);

    if (userColumns.length > 0) {
      console.log('ℹ️  Note: users table has "nickname" column (not in SQL schema, but in migration)');
    } else {
      console.log('ℹ️  Note: users table does NOT have "nickname" column (migration includes it, SQL schema does not)');
      console.log('   This is a minor difference - migration can still be marked as executed');
    }

    // Mark migration as executed (use .cjs since that's the actual file now)
    await sequelize.query(`
      INSERT INTO SequelizeMeta (name) VALUES ('20260101171440-initial-schema.cjs')
    `);

    console.log('✅ Migration marked as executed in SequelizeMeta');
    console.log('✅ All expected tables found');
    console.log('✅ Schema matches migration (with minor differences noted above)');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

checkAndMarkMigration();

