#!/usr/bin/env node
/**
 * Reset database and run migrations + demo seed (e.g. before manual Postman testing).
 *
 * Prerequisites:
 *   - MySQL running; credentials in config/config.json (development) must match your DB.
 *   - Stop the API server before a full reset so DROP DATABASE can succeed.
 *
 * Demo seed (seeders/20240101000000-demo-data.cjs) only runs when NODE_ENV=development.
 *
 * Usage (from backend/):
 *   node scripts/reset-and-seed-for-tests.mjs
 *   RESET_MODE=reseed node scripts/reset-and-seed-for-tests.mjs   # faster: undo seeds + re-seed only
 *
 * Env:
 *   NODE_ENV     default development (required for seed)
 *   RESET_MODE   "full" (default) | "reseed"
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');
process.chdir(backendRoot);

const nodeEnv = process.env.NODE_ENV || 'development';
dotenv.config({ path: path.join(backendRoot, `.env.${nodeEnv}`) });

const resetMode = (process.env.RESET_MODE || 'full').toLowerCase();

const env = {
  ...process.env,
  NODE_ENV: nodeEnv,
};

function run(label, cmd, args, { allowFail = false } = {}) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
    cwd: backendRoot,
  });
  const code = result.status ?? 1;
  if (code !== 0 && !allowFail) {
    console.error(`\n✖ Failed: ${label} (exit ${code})`);
    process.exit(code);
  }
  return code;
}

function sequelize(args, opts) {
  return run(`sequelize-cli ${args.join(' ')}`, 'npx', ['sequelize-cli', ...args], opts);
}

console.log('PickleCoach — reset DB for tests');
console.log(`  NODE_ENV=${nodeEnv}  RESET_MODE=${resetMode}`);
console.log('  Tip: stop the API server so MySQL can drop the database.\n');

if (nodeEnv !== 'development') {
  console.error('✖ Demo seed only allows NODE_ENV=development (see seed file).');
  process.exit(1);
}

if (resetMode === 'reseed') {
  sequelize(['db:seed:undo:all', '--env', nodeEnv], { allowFail: true });
  sequelize(['db:seed:all', '--env', nodeEnv]);
} else if (resetMode === 'full') {
  sequelize(['db:drop', '--env', nodeEnv], { allowFail: true });
  sequelize(['db:create', '--env', nodeEnv]);
  sequelize(['db:migrate', '--env', nodeEnv]);
  sequelize(['db:seed:all', '--env', nodeEnv]);
} else {
  console.error(`✖ Unknown RESET_MODE="${resetMode}". Use "full" or "reseed".`);
  process.exit(1);
}

console.log(`
✅ Database ready for tests.

   Admin login (Postman): admin@picklecoach.com / admin123
   Coach: coach1@example.com / password123
   Student: student1@example.com / password123
`);
