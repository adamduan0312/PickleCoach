/**
 * Nav attention indicators: Messages unread + Bookings actionable (independent of bell).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  bookingsNeedNavAttention,
  coachBookingNeedsNavAttention,
  studentNeedsAttention,
} from '../src/domain/bookingStatus.js';
import {
  buildPrimaryNavLinks,
  navItemAriaLabel,
  navItemShowsAttentionDot,
} from '../src/domain/navAttention.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('buildPrimaryNavLinks', () => {
  it('omits Notifications text link for student and coach', () => {
    const student = buildPrimaryNavLinks({ mode: 'student', student: true, coach: false, admin: false });
    const coach = buildPrimaryNavLinks({ mode: 'coach', student: false, coach: true, admin: false });
    assert.equal(student.some((l) => l.to === '/notifications' || l.label === 'Notifications'), false);
    assert.equal(coach.some((l) => l.to === '/notifications' || l.label === 'Notifications'), false);
    assert.ok(student.some((l) => l.to === '/messages' && l.attention === 'messages'));
    assert.ok(student.some((l) => l.to === '/bookings' && l.attention === 'bookings'));
    assert.ok(coach.some((l) => l.to === '/coach/bookings' && l.attention === 'bookings'));
  });

  it('shows Browse coaches in Coach mode for research (even without student role)', () => {
    const coachOnly = buildPrimaryNavLinks({ mode: 'coach', student: false, coach: true, admin: false });
    const dual = buildPrimaryNavLinks({ mode: 'coach', student: true, coach: true, admin: false });
    const student = buildPrimaryNavLinks({ mode: 'student', student: true, coach: true, admin: false });
    assert.ok(coachOnly.some((l) => l.to === '/discover' && l.label === 'Browse coaches'));
    assert.ok(dual.some((l) => l.to === '/discover' && l.label === 'Browse coaches'));
    assert.ok(student.some((l) => l.to === '/discover' && l.label === 'Find a coach'));
  });

  it('does not put bookings attention on admin Bookings', () => {
    const admin = buildPrimaryNavLinks({ mode: 'admin', student: false, coach: false, admin: true });
    assert.equal(admin.some((l) => l.attention === 'bookings'), false);
    assert.ok(admin.some((l) => l.to === '/messages' && l.attention === 'messages'));
  });
});

describe('nav attention aria + flags', () => {
  it('exposes accessible labels only when the dot is active', () => {
    assert.equal(navItemAriaLabel('Messages', 'messages', { messages: true }), 'Messages — unread messages');
    assert.equal(navItemAriaLabel('Bookings', 'bookings', { bookings: true }), 'Bookings — action required');
    assert.equal(navItemAriaLabel('Messages', 'messages', { messages: false }), 'Messages');
    assert.equal(navItemShowsAttentionDot('messages', { messages: true }), true);
    assert.equal(navItemShowsAttentionDot('messages', { messages: false }), false);
    assert.equal(navItemShowsAttentionDot('bookings', { bookings: true }), true);
    assert.equal(navItemShowsAttentionDot(undefined, { messages: true, bookings: true }), false);
  });
});

describe('bookingsNeedNavAttention', () => {
  const endedReview = {
    financial_review: {
      lesson_ended_at: '2020-01-01T00:00:00.000Z',
      window_open: true,
    },
    scheduled_at: '2020-01-01T00:00:00.000Z',
    duration_minutes: 60,
  };

  it('coach: pending, awaiting_verification (actionable), issue, and disputed light the dot', () => {
    assert.equal(coachBookingNeedsNavAttention({ status: 'pending' }), true);
    assert.equal(
      coachBookingNeedsNavAttention({ status: 'awaiting_verification', ...endedReview }),
      true,
    );
    assert.equal(
      coachBookingNeedsNavAttention({ status: 'confirmed', active_issue: { id: 1 }, ...endedReview }),
      true,
    );
    assert.equal(coachBookingNeedsNavAttention({ status: 'disputed' }), true);
  });

  it('coach: confirmed/completed/cancelled/declined and non-actionable no-shows do not', () => {
    assert.equal(coachBookingNeedsNavAttention({ status: 'confirmed' }), false);
    assert.equal(coachBookingNeedsNavAttention({ status: 'completed' }), false);
    assert.equal(coachBookingNeedsNavAttention({ status: 'cancelled' }), false);
    assert.equal(coachBookingNeedsNavAttention({ status: 'student_no_show', ...endedReview }), false);
    assert.equal(coachBookingNeedsNavAttention({ status: 'coach_no_show', ...endedReview }), false);
    // Confirmed after lesson end still has complete action in detail UI, but nav rule is awaiting_verification only.
    assert.equal(
      coachBookingNeedsNavAttention({ status: 'confirmed', ...endedReview }),
      false,
    );
  });

  it('coach: multiple attention bookings — clearing one leaves the dot if another remains', () => {
    const pendingAndAwaiting = [
      { status: 'pending' },
      { status: 'awaiting_verification', ...endedReview },
    ];
    assert.equal(bookingsNeedNavAttention(pendingAndAwaiting, 'coach'), true);
    assert.equal(
      bookingsNeedNavAttention([{ status: 'confirmed' }, { status: 'awaiting_verification', ...endedReview }], 'coach'),
      true,
    );
    assert.equal(
      bookingsNeedNavAttention([{ status: 'confirmed' }, { status: 'completed' }], 'coach'),
      false,
    );
  });

  it('student: confirmed alone does not light My bookings; actionable states do', () => {
    assert.equal(studentNeedsAttention({ status: 'confirmed' }), false);
    assert.equal(studentNeedsAttention({ status: 'pending' }), false);
    assert.equal(studentNeedsAttention({ status: 'awaiting_verification' }), false);
    assert.equal(studentNeedsAttention({ status: 'completed' }), false);
    assert.equal(studentNeedsAttention({ status: 'cancelled' }), false);
    assert.equal(studentNeedsAttention({ status: 'disputed' }), true);
    assert.equal(
      studentNeedsAttention({ status: 'completed', active_issue: { id: 9 } }),
      true,
    );
    assert.equal(
      bookingsNeedNavAttention([{ status: 'confirmed' }, { status: 'disputed' }], 'student'),
      true,
    );
    assert.equal(
      bookingsNeedNavAttention([{ status: 'confirmed' }], 'student'),
      false,
    );
  });
});

describe('AppShell wiring contracts', () => {
  const shellSrc = readFileSync(join(__dirname, '../src/components/layout/AppShell.jsx'), 'utf8');
  const apiSrc = readFileSync(join(__dirname, '../src/api/index.js'), 'utf8');

  it('keeps the bell to /notifications and does not add a Notifications text nav item', () => {
    assert.match(shellSrc, /to="\/notifications"/);
    assert.match(shellSrc, /notificationsApi\.unreadCount/);
    assert.match(shellSrc, /buildPrimaryNavLinks/);
    assert.doesNotMatch(shellSrc, /label:\s*'Notifications'/);
    assert.doesNotMatch(shellSrc, /to:\s*'\/notifications'/);
  });

  it('loads Messages and Bookings attention independently of the bell', () => {
    assert.match(shellSrc, /messagesApi\.unreadCount/);
    assert.match(shellSrc, /bookingsNeedNavAttention/);
    assert.match(shellSrc, /setMessagesAttention/);
    assert.match(shellSrc, /setBookingsAttention/);
    assert.match(apiSrc, /unreadCount:\s*\(\)\s*=>\s*apiRequest\('\/messages\/unread-count'\)/);
  });

  it('coach Bookings attention fetches the full booking list (not pending-only)', () => {
    assert.match(shellSrc, /coachesApi\.myBookings\(\)/);
    assert.doesNotMatch(shellSrc, /myBookings\(\{\s*status:\s*'pending'\s*\}\)/);
  });
});
