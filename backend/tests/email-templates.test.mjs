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
        coach_name: 'Coach Seven',
        scheduled_at: '2026-08-25T15:00:00.000Z',
      },
      stripe_payouts_disabled: {},
      stripe_payouts_enabled: {},
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
    assert.equal(getEmailSubject('unknown_type_xyz'), 'Notification from PickleCoach');
  });

  it('unknown type uses generic body inside shell', () => {
    const html = getEmailContent('some_future_type', {});
    assert.match(html, /You have a new notification from PickleCoach\./);
    assert.match(html, /PickleCoach/);
  });

  it('stripe payout templates are not generic fallback fragments', () => {
    for (const type of ['stripe_payouts_disabled', 'stripe_payouts_enabled']) {
      const fragment = getEmailBodyFragment(type, {});
      assert.doesNotMatch(fragment, /You have a new notification from PickleCoach/);
      assert.notEqual(getEmailSubject(type), 'Notification from PickleCoach');
    }
  });
});
