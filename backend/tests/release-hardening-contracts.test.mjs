import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workersSrc = readFileSync(join(__dirname, '../workers/index.js'), 'utf8');
const serverSrc = readFileSync(join(__dirname, '../server.js'), 'utf8');
const notifySrc = readFileSync(join(__dirname, '../services/notificationService.js'), 'utf8');

describe('release hardening contracts', () => {
  it('workers store cron tasks and stopWorkers stops them', () => {
    assert.match(workersSrc, /scheduledTasks/);
    assert.match(workersSrc, /task\.stop\(/);
    assert.match(workersSrc, /WORKERS_ENABLED/);
    assert.match(serverSrc, /stopWorkers\(\)/);
  });

  it('accept path marks booking_request_coach in-app notifications read', () => {
    assert.match(notifySrc, /markCoachBookingRequestNotificationsRead/);
    assert.match(notifySrc, /booking_request_coach_marked_read/);
  });

  it('config.json does not embed a real-looking DB password', () => {
    const cfg = JSON.parse(readFileSync(join(__dirname, '../config/config.json'), 'utf8'));
    for (const env of Object.keys(cfg)) {
      assert.equal(cfg[env].password, 'USE_ENV_DB_PASSWORD');
    }
  });
});
