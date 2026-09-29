/**
 * Email HTML shell + booking presentation (timezone labels, CTAs, HTML escape).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getEmailSubject,
  getEmailContent,
  getEmailBodyFragment,
  wrapEmailHtml,
  EMAIL_BUTTON_STYLE,
  SUPPORTED_EMAIL_TYPES,
  emailAppUrl,
} from '../notifications/emailTemplates.js';
import { escapeHtml } from '../utils/htmlEscape.js';
import {
  formatLessonWhenForEmail,
  formatDeadlineLabelForEmail,
} from '../utils/lessonReminderCopy.js';

const STRUCTURED_WHEN = {
  lesson_date: 'Tuesday, August 25',
  lesson_time: '11:00 AM EDT',
  lesson_when: 'Tuesday, August 25 · 11:00 AM EDT',
  timezone: 'America/New_York',
  location_line: 'Fort Lauderdale, FL 33301 · Central Park Pickleball Courts',
  court_name: 'Central Park Pickleball Courts',
  court_address: '123 Main St, Fort Lauderdale, FL 33301',
};

const BOOKING_EMAIL_TYPES = [
  'booking_request_coach',
  'booking_confirmed',
  'booking_declined',
  'booking_cancelled',
  'booking_request_expired',
  'confirm_attendance_reminder',
  'student_no_show',
  'coach_no_show',
  'dispute_resolved',
  'refund_succeeded',
  'pre_lesson_24h',
];

/** Raw JS/ISO datetime patterns that must not appear in rendered HTML. */
const RAW_DATETIME_RE = /\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)/i;
const ISO_IN_BODY_RE = /2026-08-25T15:00:00\.000Z/;

describe('emailTemplates shell (Phase D2)', () => {
  it('wrapEmailHtml includes header, dividers, and footer', () => {
    const html = wrapEmailHtml('<p>Hello</p>');
    assert.match(html, /PickleCoach/);
    assert.match(html, /You're receiving this because you have a PickleCoach account\./);
    assert.match(html, /<table role="presentation"/);
    assert.match(html, /<p>Hello<\/p>/);
    assert.match(html, /<!DOCTYPE html>/);
  });

  it('every supported template is wrapped and includes dynamic payload content', () => {
    const samples = {
      password_reset: {
        reset_url: 'http://localhost:5173/reset-password?token=abc123',
        expires_in: '1 hour',
      },
      email_verification: {
        verify_url: 'http://localhost:5173/verify-email?token=def456',
        expires_in: '24 hours',
      },
      email_change_confirm: {
        confirm_url: 'http://localhost:5173/change-email/confirm?token=ghi789',
        new_email: 'new@example.com',
      },
      email_changed_notification: {
        old_email: 'old@example.com',
        new_email: 'new@example.com',
      },
      booking_request_coach: {
        student_name: 'Ada Student',
        lesson_title: 'Intro Lesson',
        booking_id: 244,
        scheduled_at: '2026-08-25T15:00:00.000Z',
        coach_acceptance_deadline_label: 'Thursday, August 27 · 8:00 AM',
        ...STRUCTURED_WHEN,
      },
      booking_confirmed: {
        coach_name: 'Coach Seven',
        lesson_title: 'Intro Lesson',
        booking_id: 244,
        scheduled_at: '2026-08-25T15:00:00.000Z',
        ...STRUCTURED_WHEN,
      },
      booking_declined: {
        lesson_title: 'Intro Lesson',
        scheduled_at: '2026-08-25T15:00:00.000Z',
        headline: 'Coach declined your booking.',
        coach_name: 'Coach Seven',
        booking_id: 244,
        message_to_student: 'Sorry — try another day.',
        ...STRUCTURED_WHEN,
      },
      booking_cancelled: {
        lesson_title: 'Intro Lesson',
        scheduled_at: '2026-08-25T15:00:00.000Z',
        booking_id: 244,
        headline: 'Your lesson was cancelled by the coach.',
        cancelled_by: 'coach',
        coach_name: 'Coach Seven',
        ...STRUCTURED_WHEN,
      },
      pre_lesson_24h: {
        audience: 'student',
        coach_name: 'Coach Seven',
        lesson_title: 'Intro Lesson',
        booking_id: 244,
        scheduled_at: '2026-08-25T15:00:00.000Z',
        ...STRUCTURED_WHEN,
      },
      stripe_payouts_disabled: {},
      stripe_payouts_enabled: {},
      student_no_show: {
        booking_id: 244,
        headline: 'You were marked as a no-show',
        summary: 'Your coach marked you as not attending this lesson. If this is incorrect, you have 24 hours after the lesson to dispute it.',
        coach_name: 'Coach Seven',
        lesson_title: 'Intro Lesson',
        ...STRUCTURED_WHEN,
      },
      coach_no_show: {
        booking_id: 244,
        headline: 'Your coach was marked as a no-show',
        summary: 'This lesson was recorded as a coach no-show. Your payment will be refunded after the 24-hour review period, unless a dispute is still open.',
        audience: 'student',
        coach_name: 'Coach Seven',
        lesson_title: 'Intro Lesson',
        ...STRUCTURED_WHEN,
      },
      dispute_resolved: {
        booking_id: 244,
        headline: 'Dispute resolved',
        summary: 'This dispute was reviewed and the booking was determined to be a coach no-show. Your payment will be refunded.',
        audience: 'student',
        coach_name: 'Coach Seven',
        lesson_title: 'Intro Lesson',
        ...STRUCTURED_WHEN,
      },
      dispute_opened: {
        booking_id: 244,
        headline: 'An issue was reported for your lesson',
        summary: 'The student opened a dispute on this booking (coach no-show). Payment is on hold until it is reviewed.',
        audience: 'coach',
        student_name: 'Ada Student',
        lesson_title: 'Intro Lesson',
        ...STRUCTURED_WHEN,
      },
      password_changed: {},
      review_received: {
        booking_id: 244,
        headline: 'You received a new review',
        summary: 'Ada left a 5-star review on your lesson.',
        student_name: 'Ada',
        rating: 5,
        comment: 'Great lesson!',
        lesson_title: 'Intro Lesson',
        ...STRUCTURED_WHEN,
      },
      booking_request_expired: {
        booking_id: 244,
        lesson_title: 'Intro Lesson',
        scheduled_at: '2026-08-25T15:00:00.000Z',
        headline: 'Booking request expired',
        summary:
          'Your coach did not respond in time, so this booking request expired. Your payment authorization was released — you were not charged.',
        coach_name: 'Coach Seven',
        ...STRUCTURED_WHEN,
      },
      confirm_attendance_reminder: {
        booking_id: 244,
        headline: 'Confirm your lesson attendance',
        summary:
          'Your lesson with Ada Student has ended. Please confirm whether the lesson happened or mark the student as a no-show within 24 hours.',
        student_name: 'Ada Student',
        lesson_title: 'Intro Lesson',
        ...STRUCTURED_WHEN,
      },
      refund_succeeded: {
        booking_id: 244,
        headline: 'Refund completed',
        summary:
          'Your refund of $42.50 has been completed. It may take a few business days to appear on your statement.',
        coach_name: 'Coach Seven',
        lesson_title: 'Intro Lesson',
        ...STRUCTURED_WHEN,
      },
    };

    for (const type of SUPPORTED_EMAIL_TYPES) {
      const payload = samples[type] ?? {};
      const html = getEmailContent(type, payload);
      assert.match(html, /PickleCoach/, `${type}: header`);
      assert.match(
        html,
        /You're receiving this because you have a PickleCoach account\./,
        `${type}: footer`,
      );
      assert.doesNotMatch(html, /&lt;h2/, `${type}: body must not be HTML-escaped`);
      assert.doesNotMatch(html, RAW_DATETIME_RE, `${type}: no raw toLocaleString datetime`);
      assert.doesNotMatch(html, ISO_IN_BODY_RE, `${type}: no raw ISO scheduled_at in body`);

      const fragment = getEmailBodyFragment(type, payload);
      assert.ok(fragment.trim().length > 0, `${type}: fragment`);
      assert.ok(html.includes(fragment.trim()), `${type}: fragment embedded in shell`);
    }

    const resetHtml = getEmailContent('password_reset', samples.password_reset);
    assert.match(resetHtml, /reset-password\?token=abc123/);
    assert.ok(resetHtml.includes(EMAIL_BUTTON_STYLE), 'password_reset: button style');
  });

  it('subjects remain unchanged', () => {
    assert.equal(getEmailSubject('password_reset'), 'Reset Your PickleCoach Password');
    assert.equal(getEmailSubject('password_changed'), 'Your PickleCoach password was changed');
    assert.equal(getEmailSubject('booking_request_coach'), 'New booking request — PickleCoach');
    assert.equal(getEmailSubject('stripe_payouts_disabled'), 'Action needed: payouts paused on your PickleCoach account');
    assert.equal(getEmailSubject('student_no_show'), 'You were marked as a no-show');
    assert.equal(getEmailSubject('dispute_resolved'), 'Dispute resolved');
    assert.equal(getEmailSubject('dispute_opened'), 'An issue was reported');
    assert.equal(getEmailSubject('review_received'), 'You received a new review');
    assert.equal(getEmailSubject('unknown_type_xyz'), 'Notification from PickleCoach');
  });

  it('unknown type uses generic body inside shell', () => {
    const html = getEmailContent('some_future_type', {});
    assert.match(html, /You have a new notification from PickleCoach\./);
    assert.match(html, /PickleCoach/);
  });

  it('booking_request_coach uses configured timeout hours from payload', () => {
    const twentyFour = getEmailBodyFragment('booking_request_coach', {
      student_name: 'Ada Student',
      lesson_title: 'Intro Lesson',
      booking_id: 244,
      coach_acceptance_timeout_hours: 24,
      ...STRUCTURED_WHEN,
    });
    assert.match(
      twentyFour,
      /Please accept or decline this request in PickleCoach within 24 hours of this request/,
    );
    assert.match(twentyFour, /at least 2 hours before the lesson starts/);
    assert.match(twentyFour, /payment authorization is released/);

    const withDeadline = getEmailBodyFragment('booking_request_coach', {
      student_name: 'Ada Student',
      coach_acceptance_deadline_label: 'Thursday, August 27 · 8:00 AM',
      booking_id: 244,
      ...STRUCTURED_WHEN,
    });
    assert.match(withDeadline, /Please accept or decline by Thursday, August 27 · 8:00 AM/);
    assert.match(withDeadline, /expire automatically/);
    assert.match(withDeadline, /View booking request/);
    assert.match(withDeadline, /Booking #244/);

    assert.equal(
      getEmailSubject('booking_request_coach', {
        coach_acceptance_deadline_label: 'Thursday, August 27 · 8:00 AM',
      }),
      'Booking request — respond by Thursday, August 27 · 8:00 AM',
    );

    const twelve = getEmailBodyFragment('booking_request_coach', {
      student_name: 'Ada Student',
      coach_acceptance_timeout_hours: 12,
      ...STRUCTURED_WHEN,
    });
    assert.match(twelve, /within 12 hours of this request/);
    assert.doesNotMatch(twelve, /within 24 hours of this request/);
  });

  it('stripe payout templates are not generic fallback fragments', () => {
    for (const type of ['stripe_payouts_disabled', 'stripe_payouts_enabled']) {
      const fragment = getEmailBodyFragment(type, {});
      assert.doesNotMatch(fragment, /You have a new notification from PickleCoach/);
      assert.notEqual(getEmailSubject(type), 'Notification from PickleCoach');
      assert.match(fragment, /Open coach onboarding/);
    }
  });

  it('pre_lesson_24h student email lists coach, lesson, when, and booking court', () => {
    const fragment = getEmailBodyFragment('pre_lesson_24h', {
      audience: 'student',
      coach_name: 'John Smith',
      lesson_title: 'Beginner Pickleball',
      lesson_date: 'Wednesday, August 26',
      lesson_time: '6:00 PM EDT',
      lesson_when: 'Wednesday, August 26 · 6:00 PM EDT',
      location_line: 'Fort Lauderdale, FL 33301 · Central Park Pickleball Courts',
      court_name: 'Central Park Pickleball Courts',
      court_address: '123 Main St, Fort Lauderdale, FL 33301',
      booking_id: 99,
    });
    assert.match(fragment, /Tomorrow's lesson/);
    assert.match(fragment, /John Smith/);
    assert.match(fragment, /Beginner Pickleball/);
    assert.match(fragment, /Wednesday, August 26 · 6:00 PM EDT/);
    assert.match(fragment, /Central Park Pickleball Courts/);
    assert.match(fragment, /View booking/);
    assert.match(fragment, /24 hours/);
    assert.match(fragment, /report an issue/i);
    assert.doesNotMatch(fragment, />Student</);
  });

  it('pre_lesson_24h coach email lists student and the same booking court details', () => {
    const fragment = getEmailBodyFragment('pre_lesson_24h', {
      audience: 'coach',
      student_name: 'Jane Doe',
      lesson_title: 'Beginner Pickleball',
      lesson_date: 'Wednesday, August 26',
      lesson_time: '6:00 PM EDT',
      lesson_when: 'Wednesday, August 26 · 6:00 PM EDT',
      location_line: 'Fort Lauderdale, FL 33301 · Central Park Pickleball Courts',
      court_name: 'Central Park Pickleball Courts',
      court_address: '123 Main St, Fort Lauderdale, FL 33301',
    });
    assert.match(fragment, /Jane Doe/);
    assert.match(fragment, /Beginner Pickleball/);
    assert.match(fragment, /Central Park Pickleball Courts/);
    assert.doesNotMatch(fragment, />Coach</);
    assert.doesNotMatch(fragment, /report an issue/i);
  });
});

describe('booking email presentation polish', () => {
  it('confirmed email uses structured when, CTA, muted booking id, and review-window copy', () => {
    const html = getEmailContent('booking_confirmed', {
      coach_name: 'Chris Martinez',
      lesson_title: 'Intro Lesson',
      booking_id: 286,
      scheduled_at: '2026-09-04T14:00:00.000Z',
      lesson_date: 'Friday, September 4',
      lesson_time: '10:00 AM EDT',
      lesson_when: 'Friday, September 4 · 10:00 AM EDT',
      location_line: 'Davie, FL 33328 · Tree Tops Park Courts',
      timezone: 'America/New_York',
    });
    assert.match(html, /Booking confirmed/);
    assert.match(html, /Friday, September 4/);
    assert.match(html, /10:00 AM EDT/);
    assert.match(html, /Tree Tops Park Courts/);
    assert.match(html, /24 hours/);
    assert.match(html, /report an issue/i);
    assert.match(html, /View booking/);
    assert.match(html, /\/bookings\/286/);
    assert.match(html, /Booking #286/);
    assert.match(html, /When[\s\S]*Friday, September 4 · 10:00 AM EDT/);
    assert.doesNotMatch(html, />Time</);
    assert.doesNotMatch(html, RAW_DATETIME_RE);
    assert.doesNotMatch(html, /9\/4\/2026/);
  });

  it('declined email CTA goes to discover and explains authorization release', () => {
    const html = getEmailContent('booking_declined', {
      booking_id: 286,
      lesson_title: 'Intro Lesson',
      headline: 'Coach declined your booking.',
      message_to_student: 'Not free that day',
      ...STRUCTURED_WHEN,
    });
    assert.match(html, /Find another lesson/);
    assert.match(html, /\/discover/);
    assert.match(html, /payment authorization was released/);
  });

  it('every booking email type has a primary CTA button', () => {
    for (const type of BOOKING_EMAIL_TYPES) {
      const fragment = getEmailBodyFragment(type, {
        booking_id: 286,
        lesson_title: 'Intro Lesson',
        coach_name: 'Chris',
        student_name: 'Ada',
        audience: 'student',
        headline: 'Test',
        summary: 'Summary',
        ...STRUCTURED_WHEN,
      });
      assert.ok(fragment.includes(EMAIL_BUTTON_STYLE), `${type}: CTA button style`);
      assert.match(fragment, /<a href="/, `${type}: CTA href`);
    }
  });

  it('password_changed / dispute_opened / review_received emails are actionable', () => {
    const pw = getEmailBodyFragment('password_changed', {});
    assert.match(pw, /password was changed/i);
    assert.match(pw, /Open account settings/);
    assert.match(pw, /\/settings/);

    const dispute = getEmailBodyFragment('dispute_opened', {
      booking_id: 286,
      audience: 'coach',
      student_name: 'Ada',
      headline: 'An issue was reported for your lesson',
      summary: 'The student opened a dispute on this booking (coach no-show). Payment is on hold until it is reviewed.',
      ...STRUCTURED_WHEN,
    });
    assert.match(dispute, /Payment is on hold|Payout is blocked/);
    assert.match(dispute, /View booking/);
    assert.match(dispute, /Booking #286/);

    const review = getEmailBodyFragment('review_received', {
      booking_id: 286,
      student_name: 'Ada',
      rating: 5,
      comment: 'Clear drills <script>',
      lesson_title: 'Intro Lesson',
      ...STRUCTURED_WHEN,
    });
    assert.match(review, /5★/);
    assert.match(review, /Clear drills &lt;script&gt;/);
    assert.match(review, /View booking/);
  });

  it('HTML-escapes user-controlled payload fields', () => {
    const evil = {
      student_name: '<script>alert(1)</script>',
      coach_name: 'Coach <b>X</b>',
      lesson_title: 'Lesson & "Drill"',
      message_to_student: '<img src=x onerror=alert(1)>',
      reason_notes: 'a < b',
      headline: 'Declined <oops>',
      booking_id: 99,
      ...STRUCTURED_WHEN,
    };
    for (const type of ['booking_request_coach', 'booking_declined', 'booking_cancelled']) {
      const html = getEmailContent(type, {
        ...evil,
        cancelled_by: 'coach',
        reason_notes: evil.reason_notes,
      });
      assert.doesNotMatch(html, /<script>/, `${type}: raw script`);
      assert.doesNotMatch(html, /<img src=x/, `${type}: raw img`);
      assert.match(html, /&lt;script&gt;|&lt;b&gt;|&amp;|&lt;img|&lt;oops&gt;|a &lt; b/, `${type}: escaped`);
    }
    assert.equal(escapeHtml(`a < b & "c"`), 'a &lt; b &amp; &quot;c&quot;');
  });

  it('emailAppUrl uses FRONTEND_URL first origin', () => {
    const prev = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.example.com,https://other.example.com';
    try {
      assert.equal(emailAppUrl('/bookings/1'), 'https://app.example.com/bookings/1');
    } finally {
      if (prev == null) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = prev;
    }
  });
});

describe('timezone-aware schedule labels', () => {
  it('formats lesson when and deadlines in America/New_York with zone abbr', () => {
    const iso = '2026-09-04T14:00:00.000Z'; // 10:00 AM Eastern (EDT)
    assert.equal(formatLessonWhenForEmail(iso, 'America/New_York'), 'Friday, September 4 · 10:00 AM Eastern Time');
    assert.equal(
      formatLessonWhenForEmail(iso, 'America/Los_Angeles'),
      'Friday, September 4 · 7:00 AM Pacific Time',
    );
    assert.equal(
      formatDeadlineLabelForEmail('2026-09-01T15:32:00.000Z', 'America/New_York'),
      'Tuesday, September 1 · 11:32 AM Eastern Time',
    );
  });
});
