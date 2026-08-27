/**
 * Phase D2 — shared email HTML shell (presentation only).
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
} from '../notifications/emailTemplates.js';

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
      },
      booking_confirmed: {
        coach_name: 'Coach Seven',
        lesson_title: 'Intro Lesson',
        booking_id: 244,
        scheduled_at: '2026-08-25T15:00:00.000Z',
      },
      booking_declined: {
        lesson_title: 'Intro Lesson',
        scheduled_at: '2026-08-25T15:00:00.000Z',
        headline: 'Coach declined your booking.',
      },
      booking_cancelled: {
        lesson_title: 'Intro Lesson',
        scheduled_at: '2026-08-25T15:00:00.000Z',
        booking_id: 244,
      },
      pre_lesson_24h: {
        audience: 'student',
        coach_name: 'Coach Seven',
        lesson_title: 'Intro Lesson',
        lesson_date: 'Tuesday, August 25',
        lesson_time: '11:00 AM',
        court_name: 'Central Park Pickleball Courts',
        court_address: '123 Main St, Fort Lauderdale, FL 33301',
        scheduled_at: '2026-08-25T15:00:00.000Z',
      },
      stripe_payouts_disabled: {},
      stripe_payouts_enabled: {},
      student_no_show: {
        booking_id: 244,
        headline: 'You were marked as a no-show',
        summary: 'Your coach marked you as not attending this lesson. If this is incorrect, you have 24 hours after the lesson to dispute it.',
      },
      coach_no_show: {
        booking_id: 244,
        headline: 'Your coach was marked as a no-show',
        summary: 'This lesson was recorded as a coach no-show. Your payment will be refunded after the 24-hour review period, unless a dispute is still open.',
      },
      dispute_resolved: {
        booking_id: 244,
        headline: 'Dispute resolved',
        summary: 'This dispute was reviewed and the booking was determined to be a coach no-show. Your payment will be refunded.',
      },
      booking_request_expired: {
        booking_id: 244,
        lesson_title: 'Intro Lesson',
        scheduled_at: '2026-08-25T15:00:00.000Z',
        headline: 'Booking request expired',
        summary:
          'Your coach did not respond in time, so this booking request expired. Your payment authorization was released — you were not charged.',
      },
      refund_succeeded: {
        booking_id: 244,
        headline: 'Refund completed',
        summary:
          'Your refund of $42.50 has been completed. It may take a few business days to appear on your statement.',
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
    assert.equal(getEmailSubject('booking_request_coach'), 'New booking request — PickleCoach');
    assert.equal(getEmailSubject('stripe_payouts_disabled'), 'Action needed: payouts paused on your PickleCoach account');
    assert.equal(getEmailSubject('student_no_show'), 'You were marked as a no-show');
    assert.equal(getEmailSubject('dispute_resolved'), 'Dispute resolved');
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
    });
    assert.match(
      twentyFour,
      /Please accept or decline this request in PickleCoach within 24 hours of this request/,
    );
    assert.match(twentyFour, /at least 2 hours before the lesson starts/);
    assert.match(twentyFour, /payment authorization is released/);

    const withDeadline = getEmailBodyFragment('booking_request_coach', {
      student_name: 'Ada Student',
      coach_acceptance_deadline_label: 'Thursday, Aug 27, 8:00 AM',
    });
    assert.match(withDeadline, /Please accept or decline by Thursday, Aug 27, 8:00 AM/);
    assert.match(withDeadline, /expires automatically/);

    assert.equal(
      getEmailSubject('booking_request_coach', {
        coach_acceptance_deadline_label: 'Thursday, Aug 27, 8:00 AM',
      }),
      'Booking request — respond by Thursday, Aug 27, 8:00 AM',
    );

    const twelve = getEmailBodyFragment('booking_request_coach', {
      student_name: 'Ada Student',
      coach_acceptance_timeout_hours: 12,
    });
    assert.match(twelve, /within 12 hours of this request/);
    assert.doesNotMatch(twelve, /within 24 hours of this request/);
  });

  it('stripe payout templates are not generic fallback fragments', () => {
    for (const type of ['stripe_payouts_disabled', 'stripe_payouts_enabled']) {
      const fragment = getEmailBodyFragment(type, {});
      assert.doesNotMatch(fragment, /You have a new notification from PickleCoach/);
      assert.notEqual(getEmailSubject(type), 'Notification from PickleCoach');
    }
  });

  it('pre_lesson_24h student email lists coach, lesson, when, and booking court', () => {
    const fragment = getEmailBodyFragment('pre_lesson_24h', {
      audience: 'student',
      coach_name: 'John Smith',
      lesson_title: 'Beginner Pickleball',
      lesson_date: 'Wednesday, August 26',
      lesson_time: '6:00 PM',
      court_name: 'Central Park Pickleball Courts',
      court_address: '123 Main St, Fort Lauderdale, FL 33301',
    });
    assert.match(fragment, /Coach:<\/strong> John Smith/);
    assert.match(fragment, /Lesson:<\/strong> Beginner Pickleball/);
    assert.match(fragment, /Date:<\/strong> Wednesday, August 26/);
    assert.match(fragment, /Time:<\/strong> 6:00 PM/);
    assert.match(fragment, /Location:<\/strong> Central Park Pickleball Courts/);
    assert.match(fragment, /Address:<\/strong> 123 Main St, Fort Lauderdale, FL 33301/);
    assert.doesNotMatch(fragment, /Student:/);
  });

  it('pre_lesson_24h coach email lists student and the same booking court details', () => {
    const fragment = getEmailBodyFragment('pre_lesson_24h', {
      audience: 'coach',
      student_name: 'Jane Doe',
      lesson_title: 'Beginner Pickleball',
      lesson_date: 'Wednesday, August 26',
      lesson_time: '6:00 PM',
      court_name: 'Central Park Pickleball Courts',
      court_address: '123 Main St, Fort Lauderdale, FL 33301',
    });
    assert.match(fragment, /Student:<\/strong> Jane Doe/);
    assert.match(fragment, /Lesson:<\/strong> Beginner Pickleball/);
    assert.match(fragment, /Location:<\/strong> Central Park Pickleball Courts/);
    assert.match(fragment, /Address:<\/strong> 123 Main St, Fort Lauderdale, FL 33301/);
    assert.doesNotMatch(fragment, /Coach:/);
  });
});
