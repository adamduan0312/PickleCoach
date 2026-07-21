/**
 * In-app notification UI contract: headline + summary (+ optional preview) for every type.
 * Frontend should render without switching on notification.type.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBookingConfirmedNotificationContent,
  buildBookingRequestCoachNotificationContent,
  buildBookingDeclinedNotificationContent,
  buildBookingCancelledNotificationContent,
  buildPreLessonReminderNotificationContent,
  buildNewMessageNotificationPayload,
} from '../notifications/payloadBuilders.js';
import { withNotificationRoute } from '../notifications/notificationRoutes.js';

function assertInAppUiContract(payload, { type, expectPreview = false } = {}) {
  assert.equal(typeof payload.headline, 'string');
  assert.ok(payload.headline.trim().length > 0, `${type}: headline required`);
  assert.equal(typeof payload.summary, 'string');
  assert.ok(payload.summary.trim().length > 0, `${type}: summary required`);
  assert.equal(typeof payload.route, 'string');
  assert.ok(payload.route.startsWith('/'), `${type}: route should be a path`);
  if (expectPreview) {
    assert.ok(payload.preview != null && String(payload.preview).length > 0, `${type}: preview expected`);
  }
}

describe('in-app notification UI contract', () => {
  it('booking_confirmed is self-contained for NotificationCard', () => {
    const base = {
      booking_id: 81,
      coach_name: 'Sarah',
      lesson_title: 'Beginner Clinic',
      scheduled_at: '2026-07-11T15:00:00.000Z',
    };
    const payload = withNotificationRoute('booking_confirmed', {
      ...base,
      ...buildBookingConfirmedNotificationContent(base),
    });
    assertInAppUiContract(payload, { type: 'booking_confirmed', expectPreview: true });
    assert.equal(payload.headline, 'Booking confirmed');
    assert.match(payload.summary, /Sarah/);
    assert.equal(payload.route, '/bookings/81');
    assert.equal(payload.booking_id, 81);
    assert.equal(payload.coach_name, 'Sarah');
  });

  it('booking_request_coach is self-contained', () => {
    const base = {
      booking_id: 81,
      student_name: 'Jamie',
      lesson_title: 'Serve Practice',
    };
    const payload = withNotificationRoute('booking_request_coach', {
      ...base,
      ...buildBookingRequestCoachNotificationContent(base),
    });
    assertInAppUiContract(payload, { type: 'booking_request_coach', expectPreview: true });
    assert.equal(payload.headline, 'New booking request');
    assert.match(payload.summary, /Jamie/);
    assert.equal(payload.route, '/bookings/81');
  });

  it('pre_lesson_24h / pre_lesson_1h are self-contained for student and coach', () => {
    const student24 = withNotificationRoute('pre_lesson_24h', {
      booking_id: 81,
      coach_name: 'Sarah',
      lesson_title: 'Clinic',
      reminder_type: '24h',
      audience: 'student',
      ...buildPreLessonReminderNotificationContent({
        coach_name: 'Sarah',
        lesson_title: 'Clinic',
        reminder_type: '24h',
        audience: 'student',
      }),
    });
    assertInAppUiContract(student24, { type: 'pre_lesson_24h', expectPreview: true });
    assert.equal(student24.headline, 'Lesson tomorrow');
    assert.match(student24.summary, /Sarah/);

    const coach1h = withNotificationRoute('pre_lesson_1h', {
      booking_id: 81,
      student_name: 'Jamie',
      lesson_title: 'Clinic',
      reminder_type: '1h',
      audience: 'coach',
      ...buildPreLessonReminderNotificationContent({
        student_name: 'Jamie',
        lesson_title: 'Clinic',
        reminder_type: '1h',
        audience: 'coach',
      }),
    });
    assertInAppUiContract(coach1h, { type: 'pre_lesson_1h', expectPreview: true });
    assert.equal(coach1h.headline, 'Lesson in 1 hour');
    assert.match(coach1h.summary, /Jamie/);
  });

  it('booking_declined / booking_cancelled / new_message already satisfy the contract', () => {
    const declined = withNotificationRoute('booking_declined', {
      booking_id: 81,
      ...buildBookingDeclinedNotificationContent({ decline_reason_code: 'weather' }),
    });
    assertInAppUiContract(declined, { type: 'booking_declined' });

    const cancelled = withNotificationRoute('booking_cancelled', {
      booking_id: 81,
      ...buildBookingCancelledNotificationContent({ cancelled_by: 'coach', reason: 'weather' }),
    });
    assertInAppUiContract(cancelled, { type: 'booking_cancelled' });

    const message = withNotificationRoute(
      'new_message',
      buildNewMessageNotificationPayload({
        message: { id: 1, message_text: 'See you tomorrow!' },
        booking: { id: 5 },
        sender: { id: 20, full_name: 'Sarah' },
        conversationId: 42,
      }),
    );
    assertInAppUiContract(message, { type: 'new_message', expectPreview: true });
    assert.equal(message.route, '/messages/42');
  });
});
