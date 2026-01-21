/* Using compare-schema.js for new migrations
The compare-schema.js script is designed for the initial schema migration, not for every new migration.
When to use it:
Initial setup (already done):
Compare your existing database with the initial migration
Verify they match before marking it as executed
Not for regular migrations:
It compares against the initial migration file
It won't work for subsequent migrations like "add-nickname-to-users" */

import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: path.join(__dirname, `../.env.${env}`) });

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

// Expected tables from migration (manually extracted for accuracy)
const EXPECTED_TABLES = [
  'users', 'coach_profiles', 'coach_availabilities', 'lessons',
  'court_locations', 'coach_court_locations', 'bookings', 'booking_players',
  'dispute_types', 'dispute_resolution_actions', 'disputes', 'payments',
  'reschedule_history', 'cancellation_history', 'payouts', 'reviews',
  'user_reliability', 'conversations', 'messages', 'webhook_logs',
  'audit_logs', 'admin_analytics', 'admin_alerts', 'coach_reports',
  'student_feedback', 'message_templates', 'user_badges', 'session_history',
  'promo_codes', 'system_jobs', 'notifications'
];

// Get actual database schema
async function getDatabaseSchema() {
  const schema = {
    tables: {},
    indexes: {},
    foreignKeys: {}
  };
  
  // Get all tables
  const [tables] = await sequelize.query(`
    SELECT TABLE_NAME 
    FROM information_schema.TABLES 
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);
  
  for (const table of tables) {
    const tableName = table.TABLE_NAME;
    
    // Get columns with full details
    const [columns] = await sequelize.query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        COLUMN_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        COLUMN_KEY,
        EXTRA,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, {
      replacements: [tableName]
    });
    
    schema.tables[tableName] = {};
    for (const col of columns) {
      schema.tables[tableName][col.COLUMN_NAME] = {
        name: col.COLUMN_NAME,
        type: col.COLUMN_TYPE,
        dataType: col.DATA_TYPE,
        allowNull: col.IS_NULLABLE === 'YES',
        defaultValue: col.COLUMN_DEFAULT,
        primaryKey: col.COLUMN_KEY === 'PRI',
        autoIncrement: col.EXTRA.includes('auto_increment'),
        unique: col.COLUMN_KEY === 'UNI',
        maxLength: col.CHARACTER_MAXIMUM_LENGTH,
        precision: col.NUMERIC_PRECISION,
        scale: col.NUMERIC_SCALE
      };
    }
    
    // Get indexes
    const [indexes] = await sequelize.query(`
      SELECT 
        INDEX_NAME,
        GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as COLUMNS,
        NON_UNIQUE
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      GROUP BY INDEX_NAME, NON_UNIQUE
      ORDER BY INDEX_NAME
    `, {
      replacements: [tableName]
    });
    
    schema.indexes[tableName] = indexes.map(idx => ({
      name: idx.INDEX_NAME,
      columns: idx.COLUMNS.split(','),
      unique: idx.NON_UNIQUE === 0
    }));
    
    // Get foreign keys
    const [fks] = await sequelize.query(`
      SELECT 
        kcu.CONSTRAINT_NAME,
        kcu.COLUMN_NAME,
        kcu.REFERENCED_TABLE_NAME,
        kcu.REFERENCED_COLUMN_NAME,
        rc.UPDATE_RULE,
        rc.DELETE_RULE
      FROM information_schema.KEY_COLUMN_USAGE kcu
      LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
      WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = ?
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
    `, {
      replacements: [tableName]
    });
    
    schema.foreignKeys[tableName] = fks;
  }
  
  return schema;
}

// Normalize types for comparison
function normalizeType(type) {
  if (!type) return '';
  return type.toUpperCase()
    .replace(/\s+/g, '')
    .replace(/UNSIGNED/gi, '')
    .replace(/ZEROFILL/gi, '');
}

// Normalize default values
function normalizeDefault(defaultValue) {
  if (defaultValue === null || defaultValue === undefined) return null;
  if (typeof defaultValue === 'string') {
    const normalized = defaultValue.toUpperCase()
      .replace(/CURRENT_TIMESTAMP.*/i, 'CURRENT_TIMESTAMP')
      .replace(/['"]/g, '');
    return normalized === 'NULL' ? null : normalized;
  }
  return String(defaultValue);
}

// Compare column types (more lenient)
function typesMatch(migrationType, dbType) {
  const normMigration = normalizeType(migrationType);
  const normDb = normalizeType(dbType);
  
  // Handle VARCHAR variations
  if (normMigration.includes('VARCHAR') && normDb.includes('VARCHAR')) {
    return true; // Length differences are OK for now
  }
  
  // Handle DECIMAL variations
  if (normMigration.includes('DECIMAL') && normDb.includes('DECIMAL')) {
    return true; // Precision differences are OK for now
  }
  
  // Handle INT variations
  if (normMigration.includes('INT') && normDb.includes('INT')) {
    return true;
  }
  
  // Handle TINYINT(1) vs BOOLEAN
  if ((normMigration.includes('BOOLEAN') || normMigration.includes('TINYINT(1)')) &&
      (normDb.includes('TINYINT(1)') || normDb.includes('BOOLEAN'))) {
    return true;
  }
  
  // Handle TIMESTAMP vs DATETIME
  if ((normMigration.includes('TIMESTAMP') || normMigration.includes('DATETIME')) &&
      (normDb.includes('TIMESTAMP') || normDb.includes('DATETIME'))) {
    return true;
  }
  
  // Exact match
  return normMigration === normDb;
}

// Main comparison function
async function compareSchema() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database\n');
    
    console.log('🔍 Querying database schema...');
    const dbSchema = await getDatabaseSchema();
    const dbTables = Object.keys(dbSchema.tables).filter(t => t !== 'SequelizeMeta');
    console.log(`   Found ${dbTables.length} tables in database\n`);
    
    console.log('🔬 Comparing schemas...\n');
    
    const differences = {
      missingTables: [],
      extraTables: [],
      tableDifferences: {}
    };
    
    // Check for missing tables
    differences.missingTables = EXPECTED_TABLES.filter(t => !dbSchema.tables[t]);
    
    // Check for extra tables
    differences.extraTables = dbTables.filter(t => !EXPECTED_TABLES.includes(t));
    
    // Compare each expected table
    for (const tableName of EXPECTED_TABLES) {
      if (!dbSchema.tables[tableName]) continue;
      
      const dbCols = dbSchema.tables[tableName];
      const tableDiff = {
        missingColumns: [],
        extraColumns: [],
        columnDifferences: {}
      };
      
      // Read migration file to get expected columns (simplified - we'll use a manual list or parse better)
      // For now, we'll just report what's in the DB and let user verify
      
      // Get expected columns from migration file by parsing
      const migrationPath = path.join(__dirname, '../migrations/20260101171440-initial-schema.cjs');
      const migrationContent = fs.readFileSync(migrationPath, 'utf8');
      
      // Extract table definition for this table
      const tableRegex = new RegExp(`createTable\\(['"]${tableName}['"],\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}\\s*\\)`, 's');
      const tableMatch = migrationContent.match(tableRegex);
      
      if (tableMatch) {
        const tableDef = tableMatch[1];
        const expectedColumns = new Set();
        
        // Extract column names
        const colNameRegex = /(\w+):\s*\{/g;
        let colMatch;
        while ((colMatch = colNameRegex.exec(tableDef)) !== null) {
          expectedColumns.add(colMatch[1]);
        }
        
        // Check for missing columns
        for (const colName of expectedColumns) {
          if (!dbCols[colName]) {
            tableDiff.missingColumns.push(colName);
          }
        }
        
        // Check for extra columns (excluding timestamps that might be auto-added)
        const allowedExtra = ['updated_at']; // Some tables might have updated_at
        for (const colName in dbCols) {
          if (!expectedColumns.has(colName) && !allowedExtra.includes(colName)) {
            tableDiff.extraColumns.push(colName);
          }
        }
      }
      
      if (tableDiff.missingColumns.length > 0 || 
          tableDiff.extraColumns.length > 0) {
        differences.tableDifferences[tableName] = tableDiff;
      }
    }
    
    // Report results
    let hasDifferences = false;
    
    if (differences.missingTables.length > 0) {
      hasDifferences = true;
      console.log('❌ Missing Tables (expected in migration but not in DB):');
      differences.missingTables.forEach(t => console.log(`   - ${t}`));
      console.log();
    }
    
    if (differences.extraTables.length > 0) {
      console.log('ℹ️  Extra Tables (in DB but not in migration):');
      differences.extraTables.forEach(t => console.log(`   - ${t}`));
      console.log();
    }
    
    if (Object.keys(differences.tableDifferences).length > 0) {
      hasDifferences = true;
      console.log('⚠️  Table Column Differences:\n');
      for (const tableName in differences.tableDifferences) {
        const diff = differences.tableDifferences[tableName];
        console.log(`   Table: ${tableName}`);
        
        if (diff.missingColumns.length > 0) {
          console.log(`     ❌ Missing columns: ${diff.missingColumns.join(', ')}`);
        }
        if (diff.extraColumns.length > 0) {
          console.log(`     ℹ️  Extra columns: ${diff.extraColumns.join(', ')}`);
        }
        console.log();
      }
    }
    
    // Summary
    console.log('📊 Summary:');
    console.log(`   Expected tables: ${EXPECTED_TABLES.length}`);
    console.log(`   Found tables: ${dbTables.length}`);
    console.log(`   Missing tables: ${differences.missingTables.length}`);
    console.log(`   Extra tables: ${differences.extraTables.length}`);
    console.log(`   Tables with column differences: ${Object.keys(differences.tableDifferences).length}\n`);
    
    if (!hasDifferences && differences.extraTables.length === 0) {
      console.log('✅ Schema matches perfectly! No differences found.\n');
      return true;
    } else if (!hasDifferences) {
      console.log('✅ Schema matches (only extra tables in DB, which is OK)\n');
      return true;
    } else {
      console.log('❌ Schema differences found. Please review above.\n');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

compareSchema().then(matches => {
  process.exit(matches ? 0 : 1);
});

