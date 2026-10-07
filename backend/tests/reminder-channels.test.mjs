/**
 * MVP lesson reminder channel policy + court privacy for email copy.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reminderIncludesEmail } from '../services/notificationService.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  formatLessonDateForEmail,
  formatLessonTimeForEmail,
  formatReminderCourtAddress,
  buildLessonReminderDetailFields,
} from '../utils/lessonReminderCopy.js';
import { getEmailBodyFragment } from '../notifications/emailTemplates.js';

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

  it('loads the booking courtLocation', () => {
    assert.match(workerSrc, /as: 'courtLocation'/);
    assert.match(workerSrc, /CourtLocation/);
  });

  it('email and SMS templates omit 48h reminders', () => {
    assert.doesNotMatch(emailTemplatesSrc, /pre_lesson_48h/);
    assert.doesNotMatch(smsTemplatesSrc, /pre_lesson_48h/);
  });
});

describe('reminder email audience copy', () => {
  it('uses audience-based person labels and court fields', () => {
    assert.match(emailTemplatesSrc, /personLabel/);
    assert.match(emailTemplatesSrc, /court_name/);
    assert.match(emailTemplatesSrc, /court_address/);
    assert.match(emailTemplatesSrc, /Tomorrow's lesson/);
  });
});

const publicCourt = {
  id: 1,
  name: 'Central Park Pickleball Courts',
  address_line1: '123 Main St',
  city: 'Fort Lauderdale',
  state: 'FL',
  postal_code: '33301',
  country: 'US',
};

describe('lessonReminderCopy', () => {
  it('formats date and time in the viewer timezone', () => {
    // 2026-08-26T22:00:00Z = 6:00 PM Eastern
    const iso = '2026-08-26T22:00:00.000Z';
    assert.equal(formatLessonDateForEmail(iso, 'America/New_York'), 'Wednesday, August 26');
    assert.equal(formatLessonTimeForEmail(iso, 'America/New_York'), '6:00 PM Eastern Time');
    assert.equal(formatLessonTimeForEmail(iso, 'America/Chicago'), '5:00 PM Central Time');
    assert.equal(formatLessonTimeForEmail(iso, 'UTC'), '10:00 PM UTC');
  });

  it('builds detail fields from booking.courtLocation for a public court', () => {
    const fields = buildLessonReminderDetailFields(
      {
        status: 'confirmed',
        scheduled_at: '2026-08-26T22:00:00.000Z',
        lesson: { title: 'Beginner Pickleball' },
        courtLocation: publicCourt,
      },
      'America/New_York',
    );
    assert.equal(fields.lesson_title, 'Beginner Pickleball');
    assert.equal(fields.court_name, 'Central Park Pickleball Courts');
    assert.equal(fields.court_address, '123 Main St, Fort Lauderdale, FL 33301');
    assert.equal(fields.court_address_revealed, true);
    assert.equal(fields.lesson_date, 'Wednesday, August 26');
    assert.equal(fields.lesson_time, '6:00 PM Eastern Time');
    assert.equal(fields.lesson_when, 'Wednesday, August 26 · 6:00 PM Eastern Time');
  });

  it('pending booking: student reminder still includes the street address', () => {
    const fields = buildLessonReminderDetailFields(
      {
        status: 'pending',
        scheduled_at: '2026-08-26T22:00:00.000Z',
        lesson: { title: 'Beginner Pickleball' },
        courtLocation: publicCourt,
      },
      'America/New_York',
    );
    assert.equal(fields.court_address, '123 Main St, Fort Lauderdale, FL 33301');
    assert.equal(fields.court_address_revealed, true);
    assert.equal('court_is_private' in fields, false);
  });

  it('formatReminderCourtAddress prefers the full line, falls back to area', () => {
    assert.equal(
      formatReminderCourtAddress({
        address_line1: '9 Club Dr',
        city: 'Boca Raton',
        state: 'FL',
        postal_code: '33432',
        area: 'Boca Raton, FL 33432',
      }),
      '9 Club Dr, Boca Raton, FL 33432',
    );
    assert.equal(
      formatReminderCourtAddress({
        address_line1: null,
        area: 'Boca Raton, FL 33432',
      }),
      'Boca Raton, FL 33432',
    );
  });
});

describe('pre_lesson_24h email', () => {
  it('student email includes the court name and street address', () => {
    const fields = buildLessonReminderDetailFields(
      {
        status: 'confirmed',
        scheduled_at: '2026-08-26T22:00:00.000Z',
        lesson: { title: 'Beginner Pickleball' },
        courtLocation: publicCourt,
      },
      'America/New_York',
    );
    const fragment = getEmailBodyFragment('pre_lesson_24h', {
      audience: 'student',
      coach_name: 'John Smith',
      ...fields,
    });
    assert.match(fragment, /123 Main St, Fort Lauderdale, FL 33301/);
    assert.match(fragment, /Central Park Pickleball Courts/);
  });
});
