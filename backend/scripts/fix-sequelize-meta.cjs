const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
const config = require('../config/config.json');

dotenv.config();
const dbConfig = config.development;

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

async function fixSequelizeMeta() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');

    // Check current state
    const [rows] = await sequelize.query('SELECT name FROM SequelizeMeta ORDER BY name');
    console.log('Current migrations in SequelizeMeta:');
    rows.forEach(r => console.log('  -', r.name));
    console.log();

    // Update .js to .cjs if it exists
    const [updateResult] = await sequelize.query(`
      UPDATE SequelizeMeta 
      SET name = '20260101171440-initial-schema.cjs' 
      WHERE name = '20260101171440-initial-schema.js'
    `);
    
    if (updateResult.affectedRows > 0) {
      console.log('✅ Updated initial schema migration name from .js to .cjs\n');
    } else {
      // Check if .cjs version already exists
      const [checkCjs] = await sequelize.query(`
        SELECT name FROM SequelizeMeta WHERE name = '20260101171440-initial-schema.cjs'
      `);
      if (checkCjs.length === 0) {
        // Insert it if neither exists
        await sequelize.query(`
          INSERT INTO SequelizeMeta (name) VALUES ('20260101171440-initial-schema.cjs')
        `);
        console.log('✅ Added initial schema migration to SequelizeMeta\n');
      } else {
        console.log('ℹ️  Initial schema migration (.cjs) already exists\n');
      }
    }

    // Check if fix migration is recorded
    const [fixCheck] = await sequelize.query(`
      SELECT name FROM SequelizeMeta WHERE name = '20260105172550-fix-foreign-keys-and-fulltext-index.cjs'
    `);
    
    if (fixCheck.length === 0) {
      console.log('⚠️  Fix migration not found - it should be there if it ran successfully');
    } else {
      console.log('✅ Fix migration is recorded');
    }

    // Show final state
    const [finalRows] = await sequelize.query('SELECT name FROM SequelizeMeta ORDER BY name');
    console.log('\nFinal migrations in SequelizeMeta:');
    finalRows.forEach(r => console.log('  ✓', r.name));

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixSequelizeMeta();

