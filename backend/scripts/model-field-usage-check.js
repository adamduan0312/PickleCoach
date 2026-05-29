#!/usr/bin/env node
/**
 * Static "lite" scan: `booking.status`-style access vs Sequelize schema-map.
 *
 * Usage (from `backend/`): `npm run model:usage`
 *
 * Env:
 * - `MODEL_USAGE_CHECK_UNUSED=1` — also WARN on model columns never referenced in scanned files
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSchemaMap } from './schema-map.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');

const STATIC_METHOD_BLOCK = new Set([
  'findAll',
  'findOne',
  'findByPk',
  'findOrCreate',
  'findOrBuild',
  'findCreateFind',
  'upsert',
  'findAndCountAll',
  'create',
  'bulkCreate',
  'update',
  'destroy',
  'restore',
  'count',
  'sum',
  'min',
  'max',
  'increment',
  'decrement',
  'aggregate',
  'schema',
  'sequelize',
  'rawAttributes',
  'tableName',
  'name',
  'primaryKeyAttribute',
  'primaryKeyField',
  'associations',
  'options',
  'init',
  'associate',
  'removeAttribute',
  'addHook',
  'hasMany',
  'belongsTo',
  'hasOne',
  'belongsToMany',
]);

const INSTANCE_METHOD_BLOCK = new Set([
  'toJSON',
  'get',
  'set',
  'getDataValue',
  'setDataValue',
  'reload',
  'save',
  'update',
  'destroy',
  'restore',
  'changed',
  'previous',
  'increment',
  'decrement',
  'equals',
  'where',
]);

/** Common Sequelize eager-loaded keys + JS builtins that appear after `Model.` in code. */
const FIELD_USAGE_NOISE = new Set([
  'roles',
  'userRoles',
  'reliabilities',
  'coachCourts',
  'coachProfile',
  'availabilities',
  'lessons',
  'coachBookings',
  'studentBookings',
  'booking',
  'conversation',
  'primaryStudent',
  'coach',
  'lesson',
  'payment',
  'dispute',
  'user',
  'reviewsGiven',
  'reviewsReceived',
  'sentMessages',
  'auditLogs',
  'notifications',
  'messageTemplates',
  'createdCourts',
  'map',
  'filter',
  'reduce',
  'forEach',
  'flatMap',
  'some',
  'every',
  'find',
  'findIndex',
  'length',
  'push',
  'pop',
  'shift',
  'unshift',
  'slice',
  'splice',
  'includes',
  'keys',
  'values',
  'entries',
  'then',
  'catch',
  'finally',
]);

function stripQuotedStrings(src) {
  return src
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/gs, '``');
}

function loadIgnore() {
  const p = join(backendRoot, '.schema-drift-ignore.json');
  if (!existsSync(p)) return { ignoreFieldUsagePatterns: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { ignoreFieldUsagePatterns: [] };
  }
}

function walkJsFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkJsFiles(p, acc);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) acc.push(p);
  }
  return acc;
}

function acceptableNamesForTable(tableMeta) {
  const s = new Set();
  for (const col of Object.values(tableMeta.columns)) {
    s.add(col.attributeKey);
    s.add(col.dbColumn);
  }
  return s;
}

function main() {
  const ignore = loadIgnore();
  const extraIgnoreRes = (ignore.ignoreFieldUsagePatterns || []).map((p) => new RegExp(p, 'g'));

  const { tables, scanEntities } = getSchemaMap();
  const dirs = [
    join(backendRoot, 'services'),
    join(backendRoot, 'controllers'),
    join(backendRoot, 'workers'),
    join(backendRoot, 'utils'),
  ];
  const files = dirs.flatMap((d) => walkJsFiles(d));

  /** @type {Map<string, Set<string>>} modelName -> used field tokens */
  const usedByModel = new Map();
  for (const e of scanEntities) {
    usedByModel.set(e.modelName, new Set());
  }

  /** @type {{ file: string, modelName: string, field: string, severity: string }[]} */
  const issues = [];
  const seenIssueKeys = new Set();

  for (const file of files) {
    const rel = relative(backendRoot, file);
    let src = readFileSync(file, 'utf8');
    for (const re of extraIgnoreRes) {
      src = src.replace(re, '');
    }
    src = stripQuotedStrings(src);

    for (const { modelName, tableName, varPatterns } of scanEntities) {
      const acceptable = acceptableNamesForTable(tables[tableName]);
      for (const pattern of varPatterns) {
        pattern.lastIndex = 0;
        let m;
        const pat = new RegExp(pattern.source, pattern.flags);
        while ((m = pat.exec(src)) !== null) {
          const field = m[1];
          if (!field || field.length < 2) continue;
          if (/^get[A-Z]\w*$/.test(field)) continue;
          if (
            STATIC_METHOD_BLOCK.has(field) ||
            INSTANCE_METHOD_BLOCK.has(field) ||
            FIELD_USAGE_NOISE.has(field)
          ) {
            continue;
          }
          if (field.startsWith('_')) continue;
          usedByModel.get(modelName)?.add(field);
          if (!acceptable.has(field)) {
            const dedupeKey = `${rel}|${modelName}|${field}`;
            if (seenIssueKeys.has(dedupeKey)) continue;
            seenIssueKeys.add(dedupeKey);
            issues.push({
              file: rel,
              modelName,
              field,
              severity: 'ERROR',
              message: `Field "${field}" not in Sequelize model ${modelName} / table ${tableName}`,
            });
          }
        }
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'ERROR');
  const byFile = new Map();
  for (const i of issues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }

  console.log('# Model field usage check (static lite)\n');
  console.log(`Scanned ${files.length} files under services/, controllers/, workers/, utils/\n`);

  if (errors.length === 0) {
    console.log('No invalid field tokens matched against schema-map.\n');
  } else {
    console.log(`## ${errors.length} ERROR(s)\n`);
    for (const [file, arr] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const errs = arr.filter((x) => x.severity === 'ERROR');
      if (!errs.length) continue;
      console.log(`### ${file}`);
      for (const e of errs) {
        console.log(`- ERROR: ${e.modelName}.${e.field} — ${e.message}`);
      }
      console.log('');
    }
  }

  if (process.env.MODEL_USAGE_CHECK_UNUSED === '1') {
    console.log('## Unused model columns (WARNING)\n');
    for (const { modelName, tableName } of scanEntities) {
      const acceptable = acceptableNamesForTable(tables[tableName]);
      const used = usedByModel.get(modelName) || new Set();
      const unused = [...acceptable].filter(
        (c) =>
          !used.has(c) &&
          !STATIC_METHOD_BLOCK.has(c) &&
          !INSTANCE_METHOD_BLOCK.has(c) &&
          !FIELD_USAGE_NOISE.has(c),
      );
      if (unused.length) {
        console.log(`- ${modelName} (${tableName}): ${unused.slice(0, 25).join(', ')}${unused.length > 25 ? '…' : ''}`);
      }
    }
    console.log('');
  }

  process.exit(errors.length ? 1 : 0);
}

main();
