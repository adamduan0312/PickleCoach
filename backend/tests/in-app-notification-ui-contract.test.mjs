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
  buildStudentNoShowNotificationContent,
  buildCoachNoShowNotificationContent,
  buildDisputeOpenedNotificationContent,
  buildDisputeResolvedNotificationContent,
  buildBookingRequestExpiredNotificationContent,
  buildReviewReceivedNotificationContent,
  buildRefundSucceededNotificationContent,
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
      coach_acceptance_deadline_label: 'Thursday, Aug 27, 8:00 AM',
    };
    const payload = withNotificationRoute('booking_request_coach', {
      ...base,
      ...buildBookingRequestCoachNotificationContent(base),
    });
    assertInAppUiContract(payload, { type: 'booking_request_coach', expectPreview: true });
    assert.equal(payload.headline, 'Booking request — respond by Thursday, Aug 27, 8:00 AM');
    assert.match(payload.summary, /Jamie/);
    assert.match(payload.summary, /Thursday, Aug 27, 8:00 AM/);
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

  it('student_no_show / coach_no_show / dispute_opened / dispute_resolved satisfy the contract', () => {
    const studentNs = withNotificationRoute('student_no_show', {
      booking_id: 81,
      ...buildStudentNoShowNotificationContent({ markedBy: 'coach' }),
    });
    assertInAppUiContract(studentNs, { type: 'student_no_show' });
    assert.equal(studentNs.headline, 'You were marked as a no-show');
    assert.match(studentNs.summary, /24 hours/);

    const coachNsStudent = withNotificationRoute('coach_no_show', {
      booking_id: 81,
      ...buildCoachNoShowNotificationContent({ audience: 'student' }),
    });
    assertInAppUiContract(coachNsStudent, { type: 'coach_no_show' });
    assert.match(coachNsStudent.headline, /coach was marked/i);

    const opened = withNotificationRoute('dispute_opened', {
      booking_id: 81,
      dispute_id: 21,
      ...buildDisputeOpenedNotificationContent({
        openedBy: 'student',
        disputeTypeCode: 'coach_no_show_claim',
      }),
    });
    assertInAppUiContract(opened, { type: 'dispute_opened', expectPreview: true });
    assert.equal(opened.route, '/bookings/81');

    const resolved = withNotificationRoute('dispute_resolved', {
      booking_id: 81,
      dispute_id: 21,
      ...buildDisputeResolvedNotificationContent({
        audience: 'student',
        outcome: 'coach_no_show',
        financialAction: 'refund_student',
        bookingStatus: 'coach_no_show',
      }),
    });
    assertInAppUiContract(resolved, { type: 'dispute_resolved' });
    assert.match(resolved.summary, /refunded/);
  });

  it('booking_request_expired / review_received / refund_succeeded satisfy the contract', () => {
    const expired = withNotificationRoute('booking_request_expired', {
      booking_id: 81,
      ...buildBookingRequestExpiredNotificationContent(),
    });
    assertInAppUiContract(expired, { type: 'booking_request_expired' });
    assert.match(expired.summary, /authorization was released/);
    assert.equal(expired.route, '/bookings/81');

    const review = withNotificationRoute('review_received', {
      booking_id: 81,
      route: '/reviews/15',
      ...buildReviewReceivedNotificationContent({ rating: 5, studentName: 'Ada' }),
    });
    assertInAppUiContract(review, { type: 'review_received', expectPreview: true });
    assert.equal(review.route, '/reviews/15');

    const refund = withNotificationRoute('refund_succeeded', {
      booking_id: 81,
      ...buildRefundSucceededNotificationContent({ refundAmount: 42.5 }),
    });
    assertInAppUiContract(refund, { type: 'refund_succeeded' });
    assert.match(refund.summary, /\$42\.50/);
    assert.equal(refund.route, '/bookings/81');
  });
});
