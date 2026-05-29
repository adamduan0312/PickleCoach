#!/usr/bin/env node
/**
 * DB ↔ Sequelize schema drift detector.
 *
 * Rule: **database columns are source of truth**; Sequelize models are the checked representation.
 *
 * Usage (from `backend/`): `npm run schema:drift`
 *
 * Env:
 * - `NODE_ENV` — picks config (default development)
 * - `SCHEMA_DRIFT_ALLOW_SKIP=1` — exit 0 if DB unreachable (CI without MySQL)
 * - `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` — override config.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { getSchemaMap } from './schema-map.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: join(backendRoot, `.env.${env}`) });

const require = createRequire(import.meta.url);
const config = require('../config/config.json')[env];

function loadIgnore() {
  const p = join(backendRoot, '.schema-drift-ignore.json');
  if (!existsSync(p)) {
    return { ignoreTables: [], ignoreColumns: {}, ignoreGlobalColumnNames: [] };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { ignoreTables: [], ignoreColumns: {}, ignoreGlobalColumnNames: [] };
  }
}

function normalizeMysqlType(colType) {
  return String(colType || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function sequelizeFamily(typeLabel) {
  const t = String(typeLabel || '').toLowerCase();
  if (t.includes('integer') || t === 'number') return 'numeric';
  if (t.includes('decimal') || t.includes('float') || t.includes('double')) return 'decimal';
  if (t.includes('string') || t.includes('text')) return 'string';
  if (t.includes('boolean')) return 'bool';
  if (t.includes('date')) return 'date';
  if (t.includes('json')) return 'json';
  if (t.includes('enum')) return 'enum';
  return 'other';
}

function mysqlFamily(columnType) {
  const t = normalizeMysqlType(columnType);
  if (/^tinyint\(1\)/.test(t) || t.startsWith('bit')) return 'bool';
  if (/^(tinyint|smallint|mediumint|int|bigint)/.test(t)) return 'numeric';
  if (/^(decimal|numeric|float|double)/.test(t)) return 'decimal';
  if (/^(varchar|char|text|mediumtext|longtext)/.test(t)) return 'string';
  if (/^(datetime|timestamp|date|time)/.test(t)) return 'date';
  if (/^json/.test(t)) return 'json';
  if (/^enum/.test(t)) return 'enum';
  return 'other';
}

async function fetchDbColumns(conn, database) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  /** @type {Map<string, Map<string, { columnType: string, isNullable: string }>>} */
  const byTable = new Map();
  for (const row of rows) {
    const t = row.TABLE_NAME;
    if (!byTable.has(t)) byTable.set(t, new Map());
    byTable.get(t).set(row.COLUMN_NAME, {
      columnType: row.COLUMN_TYPE,
      isNullable: row.IS_NULLABLE,
    });
  }
  return byTable;
}

async function main() {
  const ignore = loadIgnore();
  const ignoreTables = new Set(ignore.ignoreTables || []);
  const ignoreColumns = ignore.ignoreColumns || {};
  const ignoreGlobal = new Set(ignore.ignoreGlobalColumnNames || []);

  const database = process.env.DB_NAME || config.database;
  const host = process.env.DB_HOST || config.host;
  const port = Number(process.env.DB_PORT || config.port || 3306);
  const user = process.env.DB_USER || config.username;
  const password = process.env.DB_PASSWORD != null ? process.env.DB_PASSWORD : config.password;

  let conn;
  try {
    conn = await mysql.createConnection({ host, port, user, password, database });
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(`[schema-drift] Cannot connect to MySQL (${database}@${host}): ${msg}`);
    if (process.env.SCHEMA_DRIFT_ALLOW_SKIP === '1') {
      console.error('[schema-drift] SCHEMA_DRIFT_ALLOW_SKIP=1 → exiting 0');
      process.exit(0);
    }
    process.exit(1);
  }

  const { tables: modelTables } = getSchemaMap();
  let dbByTable;
  try {
    dbByTable = await fetchDbColumns(conn, database);
  } finally {
    await conn.end();
  }

  let exitCode = 0;
  const sections = [];

  for (const [tableName, meta] of Object.entries(modelTables)) {
    if (ignoreTables.has(tableName)) continue;
    const dbCols = dbByTable.get(tableName);
    const modelColNames = new Set(Object.keys(meta.columns));
    const missingFromDatabase = [];
    const missingFromModel = [];
    const typeMismatches = [];

    if (!dbCols) {
      sections.push(`\n## Table \`${tableName}\` (model: ${meta.modelName})\n**ERROR:** table missing in database.\n`);
      exitCode = 1;
      continue;
    }

    for (const col of modelColNames) {
      if (ignoreGlobal.has(col)) continue;
      const perTable = ignoreColumns[tableName] || [];
      if (perTable.includes(col)) continue;
      if (!dbCols.has(col)) {
        missingFromDatabase.push(col);
      }
    }

    for (const col of dbCols.keys()) {
      if (ignoreGlobal.has(col)) continue;
      const perTable = ignoreColumns[tableName] || [];
      if (perTable.includes(col)) continue;
      if (!modelColNames.has(col)) {
        missingFromModel.push(col);
      }
    }

    for (const col of modelColNames) {
      if (!dbCols.has(col)) continue;
      const m = meta.columns[col];
      const db = dbCols.get(col);
      const sf = sequelizeFamily(m.typeLabel);
      const mf = mysqlFamily(db.columnType);
      if (sf !== mf && sf !== 'other' && mf !== 'other') {
        typeMismatches.push(
          `- \`${col}\`: Sequelize ~${sf} (${m.typeLabel}) vs DB ${mf} (${db.columnType})`,
        );
      }
    }

    if (missingFromDatabase.length || missingFromModel.length || typeMismatches.length) {
      exitCode = 1;
      let block = `\n## Table \`${tableName}\` (model: ${meta.modelName})\n`;
      if (missingFromDatabase.length) {
        block += `**Sequelize model defines column(s) not present in DB** (migrations / DB behind model):\n${missingFromDatabase.map((c) => `- \`${c}\``).join('\n')}\n\n`;
      }
      if (missingFromModel.length) {
        block += `**DB has column(s) not represented in Sequelize model** (model / schema-map behind DB):\n${missingFromModel.map((c) => `- \`${c}\``).join('\n')}\n\n`;
      }
      if (typeMismatches.length) {
        block += `**Best-effort type family mismatch:**\n${typeMismatches.join('\n')}\n\n`;
      }
      sections.push(block);
    }
  }

  const extraDbTables = [];
  for (const t of dbByTable.keys()) {
    if (ignoreTables.has(t)) continue;
    if (!Object.prototype.hasOwnProperty.call(modelTables, t)) {
      extraDbTables.push(t);
    }
  }
  if (extraDbTables.length) {
    sections.push(
      `\n## DB tables with no Sequelize model in schema-map\n` +
        `(informational — add model or add table to ignoreTables)\n${extraDbTables.map((t) => `- \`${t}\``).join('\n')}\n`,
    );
  }

  console.log('# Schema drift report');
  console.log(`Database (source of truth): \`${database}\``);
  console.log(`Models compared: ${Object.keys(modelTables).length} tables\n`);

  if (sections.length === 0) {
    console.log('No drift detected between INFORMATION_SCHEMA and Sequelize `schema-map.js`.\n');
  } else {
    console.log(sections.join('\n'));
  }

  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
