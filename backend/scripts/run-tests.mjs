/**
 * Test runner with a discovery guard.
 *
 * `node --test <glob>` exits 0 when the glob matches ZERO files, so a typo'd
 * pattern (e.g. tests/*.spec.mjs) would make CI report success while running
 * nothing. This wrapper resolves the glob first and refuses to pass on empty.
 *
 * Usage: node scripts/run-tests.mjs [pattern]   (default: tests/*.test.mjs)
 */
import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// fs.globSync requires Node 22+ (see "engines" in package.json).
const major = Number(process.versions.node.split('.')[0]);
if (major < 22 || typeof globSync !== 'function') {
  console.error(`Node >= 22 required to run tests (found ${process.versions.node}).`);
  process.exit(1);
}

const pattern = process.argv[2] || 'tests/*.test.mjs';
const files = globSync(pattern).sort();

if (files.length === 0) {
  console.error(`No test files matched '${pattern}' — refusing to report success.`);
  process.exit(1);
}

console.log(`Discovered ${files.length} test files matching '${pattern}'.`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
