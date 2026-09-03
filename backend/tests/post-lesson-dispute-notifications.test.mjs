/**
 * Post-lesson attendance + dispute notifications: copy, recipients, controller wiring.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildStudentNoShowNotificationContent,
  buildCoachNoShowNotificationContent,
  buildDisputeOpenedNotificationContent,
  buildDisputeResolvedNotificationContent,
  buildBookingRequestExpiredNotificationContent,
  buildReviewReceivedNotificationContent,
  buildRefundSucceededNotificationContent,
  buildConfirmAttendanceReminderNotificationContent,
  buildLessonCompletedNotificationContent,
} from '../notifications/payloadBuilders.js';
import { resolveDisputeOpenedRecipients } from '../services/notificationService.js';
import { getEmailSubject } from '../notifications/emailTemplates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('buildConfirmAttendanceReminderNotificationContent', () => {
  it('coach copy prompts complete or student no-show', () => {
    const content = buildConfirmAttendanceReminderNotificationContent({ student_name: 'Mira Miami' });
    assert.equal(content.headline, 'Confirm attendance');
    assert.match(content.summary, /Mira Miami/);
    assert.match(content.summary, /Mark the lesson complete or report a student no-show/);
  });
});

describe('buildLessonCompletedNotificationContent', () => {
  it('student copy mentions review and 24-hour review window', () => {
    const content = buildLessonCompletedNotificationContent({ coach_name: 'Coach Ada' });
    assert.equal(content.headline, 'Lesson completed');
    assert.match(content.summary, /Coach Ada/);
    assert.match(content.summary, /leave a review/);
    assert.match(content.summary, /24-hour review window/);
  });
});

describe('buildStudentNoShowNotificationContent', () => {
  it('coach mark tells the student they can dispute within 24 hours', () => {
    const content = buildStudentNoShowNotificationContent({ markedBy: 'coach' });
    assert.equal(content.headline, 'You were marked as a no-show');
    assert.match(content.summary, /Your coach marked you/);
    assert.match(content.summary, /24 hours after the lesson to dispute/);
  });

  it('admin mark names the administrator', () => {
    const content = buildStudentNoShowNotificationContent({ markedBy: 'admin' });
    assert.match(content.summary, /administrator marked you/);
  });
});

describe('buildCoachNoShowNotificationContent', () => {
  it('student copy mentions refund after review', () => {
    const content = buildCoachNoShowNotificationContent({ audience: 'student' });
    assert.match(content.headline, /coach was marked as a no-show/i);
    assert.match(content.summary, /refunded after the 24-hour review/);
  });

  it('coach copy mentions no payout', () => {
    const content = buildCoachNoShowNotificationContent({ audience: 'coach' });
    assert.equal(content.headline, 'You were marked as a no-show');
    assert.match(content.summary, /will not receive a payout/);
  });
});

describe('buildDisputeOpenedNotificationContent', () => {
  it('student opener → coach-facing copy', () => {
    const content = buildDisputeOpenedNotificationContent({
      openedBy: 'student',
      disputeTypeCode: 'coach_no_show_claim',
    });
    assert.equal(content.headline, 'A dispute was opened');
    assert.match(content.summary, /The student opened/);
    assert.match(content.summary, /coach no-show/);
    assert.equal(content.preview, 'coach no-show');
  });

  it('coach opener → student-facing copy', () => {
    const content = buildDisputeOpenedNotificationContent({
      openedBy: 'coach',
      disputeTypeCode: 'student_no_show_claim',
    });
    assert.match(content.summary, /Your coach opened/);
    assert.match(content.summary, /student no-show/);
  });

  it('admin opener uses Support', () => {
    const content = buildDisputeOpenedNotificationContent({
      openedBy: 'admin',
      disputeTypeCode: 'misconduct',
    });
    assert.match(content.summary, /Support opened/);
  });
});

describe('buildDisputeResolvedNotificationContent', () => {
  it('student: coach no-show + refund', () => {
    const content = buildDisputeResolvedNotificationContent({
      audience: 'student',
      outcome: 'coach_no_show',
      financialAction: 'refund_student',
      bookingStatus: 'coach_no_show',
    });
    assert.equal(content.headline, 'Dispute resolved');
    assert.match(content.summary, /coach no-show/);
    assert.match(content.summary, /Your payment will be refunded/);
  });

  it('student: completed → coach payout proceeds', () => {
    const content = buildDisputeResolvedNotificationContent({
      audience: 'student',
      outcome: null,
      financialAction: 'no_change',
      bookingStatus: 'completed',
    });
    assert.match(content.summary, /determined to have been completed/);
    assert.match(content.summary, /coach's payout will proceed/);
  });

  it('coach: student no-show → payout proceeds', () => {
    const content = buildDisputeResolvedNotificationContent({
      audience: 'coach',
      outcome: 'student_no_show',
      financialAction: 'no_change',
      bookingStatus: 'student_no_show',
    });
    assert.match(content.summary, /student no-show/);
    assert.match(content.summary, /Your payout will proceed/);
  });
});

describe('buildBookingRequestExpiredNotificationContent', () => {
  it('explains expiry and that the payment hold was released', () => {
    const content = buildBookingRequestExpiredNotificationContent();
    assert.equal(content.headline, 'Booking request expired');
    assert.match(content.summary, /did not respond in time/);
    assert.match(content.summary, /authorization was released/);
    assert.match(content.summary, /not charged/);
  });
});

describe('buildReviewReceivedNotificationContent', () => {
  it('includes rating and student name when provided', () => {
    const content = buildReviewReceivedNotificationContent({
      rating: 5,
      studentName: 'Ada',
    });
    assert.equal(content.headline, 'New review received');
    assert.match(content.summary, /Ada left a 5-star review/);
    assert.equal(content.preview, '5★');
  });

  it('falls back when rating is missing', () => {
    const content = buildReviewReceivedNotificationContent({ studentName: 'Ada' });
    assert.match(content.summary, /Ada left a review/);
    assert.equal(content.preview, undefined);
  });
});

describe('buildRefundSucceededNotificationContent', () => {
  it('includes dollar amount when provided', () => {
    const content = buildRefundSucceededNotificationContent({ refundAmount: 42.5 });
    assert.equal(content.headline, 'Refund completed');
    assert.match(content.summary, /\$42\.50/);
    assert.match(content.summary, /few business days/);
  });

  it('omits amount when missing', () => {
    const content = buildRefundSucceededNotificationContent({});
    assert.match(content.summary, /Your refund has been completed/);
    assert.doesNotMatch(content.summary, /\$/);
  });
});

describe('resolveDisputeOpenedRecipients', () => {
  it('student opener → coach only', () => {
    assert.deepEqual(
      resolveDisputeOpenedRecipients({ openedBy: 'student', coachId: 10, studentId: 20 }),
      [10],
    );
  });

  it('coach opener → student only', () => {
    assert.deepEqual(
      resolveDisputeOpenedRecipients({ openedBy: 'coach', coachId: 10, studentId: 20 }),
      [20],
    );
  });

  it('admin opener → both', () => {
    assert.deepEqual(
      resolveDisputeOpenedRecipients({ openedBy: 'admin', coachId: 10, studentId: 20 }),
      [10, 20],
    );
  });

  it('does not notify the opener when coach and student are the same user', () => {
    assert.deepEqual(
      resolveDisputeOpenedRecipients({ openedBy: 'student', coachId: 10, studentId: 10 }),
      [],
    );
  });
});

describe('controller wiring', () => {
  it('bookingController notifies student no-show and coach no-show', () => {
    const src = readFileSync(join(__dirname, '../controllers/bookingController.js'), 'utf8');
    assert.match(src, /notifyStudentNoShow\(id, \{ markedBy: 'coach' \}\)/);
    assert.match(src, /notifyStudentNoShow\(id, \{ markedBy: 'admin' \}\)/);
    assert.match(src, /notifyCoachNoShow\(id\)/);
    assert.match(src, /notifyStudentLessonCompleted\(id\)/);
    assert.match(src, /lesson_completed_notify_failed/);
    assert.match(src, /student_no_show_notify_failed/);
    assert.match(src, /coach_no_show_notify_failed/);
  });

  it('autoConfirmWorker notifies coach confirm-attendance reminder', () => {
    const src = readFileSync(join(__dirname, '../workers/autoConfirmWorker.js'), 'utf8');
    assert.match(src, /notifyCoachConfirmAttendanceReminder/);
    assert.match(src, /confirm_attendance_reminder_notify_failed/);
  });

  it('disputeController notifies open and resolve', () => {
    const src = readFileSync(join(__dirname, '../controllers/disputeController.js'), 'utf8');
    assert.match(src, /notifyDisputeOpened/);
    assert.match(src, /notifyDisputeResolved/);
    assert.match(src, /dispute_opened_notify_failed/);
    assert.match(src, /dispute_resolved_notify_failed/);
  });

  it('paymentService notifies booking expiry and refund succeeded', () => {
    const src = readFileSync(join(__dirname, '../services/paymentService.js'), 'utf8');
    assert.match(src, /notifyBookingRequestExpired/);
    assert.match(src, /booking_request_expired_notify_failed/);
    assert.match(src, /notifyRefundSucceeded/);
    assert.match(src, /refund_succeeded_notify_failed/);
    assert.match(src, /refundIncreased/);
  });

  it('reviewController notifies coach on create', () => {
    const src = readFileSync(join(__dirname, '../controllers/reviewController.js'), 'utf8');
    assert.match(src, /notifyReviewReceived/);
    assert.match(src, /review_received_notify_failed/);
  });
});

describe('email subjects for dual-channel types', () => {
  it('uses dedicated subjects (not the generic fallback)', () => {
    assert.equal(getEmailSubject('student_no_show'), 'You were marked as a no-show');
    assert.equal(
      getEmailSubject('coach_no_show', { headline: 'Your coach was marked as a no-show' }),
      'Your coach was marked as a no-show',
    );
    assert.equal(getEmailSubject('dispute_resolved'), 'Dispute resolved');
    assert.equal(getEmailSubject('booking_request_expired'), 'Booking request expired');
    assert.equal(getEmailSubject('refund_succeeded'), 'Refund completed');
  });
});
