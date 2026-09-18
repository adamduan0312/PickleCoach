import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { COACH_GUIDE, STUDENT_GUIDE, guideForRole } from '../src/domain/howBookingsWork.js';
import {
  coachDashboardReminders,
  studentDashboardReminders,
} from '../src/domain/dashboardReminders.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('how bookings work guide copy', () => {
  it('keeps role-specific highlight messages', () => {
    assert.match(COACH_GUIDE.highlight, /does not determine your payout/i);
    assert.match(COACH_GUIDE.highlight, /Complete/i);
    assert.match(COACH_GUIDE.highlight, /Student no-show/i);
    assert.match(STUDENT_GUIDE.highlight, /report an issue/i);
    assert.match(STUDENT_GUIDE.highlight, /review window/i);
    assert.equal(guideForRole('coach'), COACH_GUIDE);
    assert.equal(guideForRole('student'), STUDENT_GUIDE);
    assert.equal(guideForRole('admin'), null);
  });

  it('avoids internal payment-system jargon', () => {
    const blob = [...COACH_GUIDE.steps, COACH_GUIDE.highlight, ...STUDENT_GUIDE.steps, STUDENT_GUIDE.highlight].join(' ');
    assert.doesNotMatch(blob, /escrow|payoutWorker|awaiting_verification|database/i);
  });
});

describe('dashboard reminders', () => {
  const now = Date.parse('2026-09-14T18:00:00.000Z');

  it('reminds coaches about response deadlines and attendance', () => {
    const reminders = coachDashboardReminders(
      [
        {
          id: 1,
          status: 'pending',
          scheduled_at: '2026-09-20T15:00:00.000Z',
          coach_acceptance_deadline_at: '2026-09-15T12:00:00.000Z',
        },
        {
          id: 2,
          status: 'awaiting_verification',
          scheduled_at: '2026-09-14T15:00:00.000Z',
          duration_minutes: 60,
          financial_review: {
            lesson_ended_at: '2026-09-14T16:00:00.000Z',
            review_until: '2026-09-15T16:00:00.000Z',
            window_open: true,
          },
        },
      ],
      now,
    );
    assert.equal(reminders.length, 2);
    assert.equal(reminders[0].id, 'coach-respond');
    assert.equal(reminders[0].cta, 'Review request');
    assert.equal(reminders[0].to, '/bookings/1');
    assert.equal(reminders[1].id, 'coach-attendance');
    assert.equal(reminders[1].cta, 'Confirm attendance');
    assert.match(reminders[1].body, /does not determine your payout/i);
    assert.equal(reminders[1].to, '/bookings/2');
  });

  it('uses next-in-queue copy when multiple bookings need the same action', () => {
    const reminders = coachDashboardReminders(
      [
        {
          id: 1,
          status: 'awaiting_verification',
          scheduled_at: '2026-09-13T15:00:00.000Z',
          duration_minutes: 60,
          financial_review: {
            lesson_ended_at: '2026-09-13T16:00:00.000Z',
            review_until: '2026-09-15T16:00:00.000Z',
            window_open: true,
          },
        },
        {
          id: 2,
          status: 'awaiting_verification',
          scheduled_at: '2026-09-14T12:00:00.000Z',
          duration_minutes: 60,
          financial_review: {
            lesson_ended_at: '2026-09-14T13:00:00.000Z',
            review_until: '2026-09-15T13:00:00.000Z',
            window_open: true,
          },
        },
        {
          id: 3,
          status: 'awaiting_verification',
          scheduled_at: '2026-09-14T14:00:00.000Z',
          duration_minutes: 60,
          financial_review: {
            lesson_ended_at: '2026-09-14T15:00:00.000Z',
            review_until: '2026-09-15T15:00:00.000Z',
            window_open: true,
          },
        },
        {
          id: 4,
          status: 'awaiting_verification',
          scheduled_at: '2026-09-14T15:00:00.000Z',
          duration_minutes: 60,
          financial_review: {
            lesson_ended_at: '2026-09-14T16:00:00.000Z',
            review_until: '2026-09-15T16:00:00.000Z',
            window_open: true,
          },
        },
      ],
      now,
    );
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].title, 'Confirm attendance for 4 finished lessons');
    assert.match(reminders[0].body, /Review each finished lesson/i);
    assert.equal(reminders[0].cta, 'Review next lesson');
    assert.equal(reminders[0].to, '/bookings/1');
  });

  it('reminds students about pending acceptance and open review windows', () => {
    const reminders = studentDashboardReminders(
      [
        {
          id: 10,
          status: 'pending',
          scheduled_at: '2026-09-20T15:00:00.000Z',
        },
        {
          id: 11,
          status: 'completed',
          scheduled_at: '2026-09-14T15:00:00.000Z',
          duration_minutes: 60,
          financial_review: {
            lesson_ended_at: '2026-09-14T16:00:00.000Z',
            review_until: '2026-09-15T16:00:00.000Z',
            window_open: true,
          },
        },
      ],
      now,
    );
    assert.equal(reminders.length, 2);
    assert.equal(reminders[0].id, 'student-pending');
    assert.equal(reminders[0].cta, 'View request');
    assert.equal(reminders[1].id, 'student-review-window');
    assert.equal(reminders[1].cta, 'Check booking');
    assert.match(reminders[1].body, /report an issue/i);
    assert.equal(reminders[1].to, '/bookings/11');
  });

  it('hides student review reminder once an issue is already open', () => {
    const reminders = studentDashboardReminders(
      [
        {
          id: 11,
          status: 'completed',
          scheduled_at: '2026-09-14T15:00:00.000Z',
          duration_minutes: 60,
          financial_review: {
            lesson_ended_at: '2026-09-14T16:00:00.000Z',
            review_until: '2026-09-15T16:00:00.000Z',
            window_open: true,
          },
          active_issue: { id: 99 },
        },
      ],
      now,
    );
    assert.deepEqual(reminders, []);
  });

  it('returns no reminders when nothing needs attention', () => {
    assert.deepEqual(coachDashboardReminders([], now), []);
    assert.deepEqual(
      studentDashboardReminders([{ id: 1, status: 'confirmed', scheduled_at: '2026-09-20T15:00:00.000Z' }], now),
      [],
    );
  });
});

describe('coach dashboard reminder decoupling', () => {
  it('still renders reminders when marketplace status fails', () => {
    const src = readFileSync(
      join(__dirname, '../src/pages/coach/CoachDashboardPage.jsx'),
      'utf8',
    );

    // Marketplace and bookings must be independent loads.
    assert.match(src, /marketplaceStatus\(\)/);
    assert.match(src, /myBookings\(\)/);
    assert.ok(
      (src.match(/useAsync\(/g) || []).length >= 2,
      'expected separate useAsync hooks for marketplace and bookings',
    );

    // Reminders depend only on bookings load state — not marketError.
    assert.match(
      src,
      /!bookingsLoading\s*&&\s*!bookingsError\s*\?\s*<DashboardReminders/,
    );
    assert.doesNotMatch(
      src,
      /!loading\s*&&\s*!error\s*\?\s*<DashboardReminders/,
    );
    assert.doesNotMatch(src, /marketError.*DashboardReminders|DashboardReminders.*marketError/);
  });
});
