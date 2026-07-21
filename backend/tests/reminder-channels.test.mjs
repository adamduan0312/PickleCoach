/**
 * MVP lesson reminder channel policy.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reminderIncludesEmail } from '../services/notificationService.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(join(__dirname, '../workers/reminderWorker.js'), 'utf8');
const emailTemplatesSrc = readFileSync(join(__dirname, '../notifications/emailTemplates.js'), 'utf8');
const smsTemplatesSrc = readFileSync(join(__dirname, '../notifications/smsTemplates.js'), 'utf8');

describe('reminderIncludesEmail', () => {
  it('24h includes email', () => {
    assert.equal(reminderIncludesEmail('24h'), true);
  });

  it('1h is in-app only', () => {
    assert.equal(reminderIncludesEmail('1h'), false);
  });
});

describe('reminderWorker MVP tiers', () => {
  it('schedules only 24h and 1h reminders', () => {
    assert.match(workerSrc, /sendReminderNotification\(booking, '24h'\)/);
    assert.match(workerSrc, /sendReminderNotification\(booking, '1h'\)/);
    assert.doesNotMatch(workerSrc, /48h|pre_lesson_48/);
  });

  it('email and SMS templates omit 48h reminders', () => {
    assert.doesNotMatch(emailTemplatesSrc, /pre_lesson_48h/);
    assert.doesNotMatch(smsTemplatesSrc, /pre_lesson_48h/);
  });
});
