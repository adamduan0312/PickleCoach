import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bookingDisplayLabel,
  bookingDisplayTone,
  bookingStatusLabel,
  canCoachComplete,
  canCoachMarkNoShow,
  canReportLessonIssue,
  coachAttendanceBlockedByIssue,
  hasOpenIssueReport,
  studentReviewWindowBannerCopy,
} from '../src/domain/bookingStatus.js';

describe('booking display labels (issue reported vs disputed)', () => {
  it('labels awaiting_verification as Awaiting verification', () => {
    assert.equal(bookingStatusLabel('awaiting_verification'), 'Awaiting verification');
  });

  it('labels Stripe chargeback status as Disputed', () => {
    assert.equal(bookingStatusLabel('disputed'), 'Disputed');
    assert.equal(
      bookingDisplayLabel({ status: 'disputed', active_issue: null }),
      'Disputed',
    );
  });

  it('labels open in-app report as Issue reported without changing status', () => {
    const booking = {
      status: 'awaiting_verification',
      active_issue: { id: 12, status: 'open', opened_by: 'student' },
      financial_review: { window_open: true },
      scheduled_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 60,
    };
    assert.equal(hasOpenIssueReport(booking), true);
    assert.equal(bookingDisplayLabel(booking), 'Issue reported');
    assert.equal(bookingDisplayTone(booking), 'warning');
    assert.equal(canReportLessonIssue(booking), false);
  });

  it('student issue banner omits financial review countdown', () => {
    const booking = {
      status: 'awaiting_verification',
      active_issue: { id: 12, status: 'open', opened_by: 'student' },
      financial_review: { window_open: true },
    };
    const copy = studentReviewWindowBannerCopy(
      booking,
      { remaining: '23h 7m', deadlineFormatted: 'Sep 3, 10:13 PM' },
    );
    assert.equal(copy.title, 'Issue reported');
    assert.equal(
      copy.body,
      'Your report is under review. Payout is protected while this issue is being reviewed.',
    );
    assert.ok(!copy.body.includes('23h'));
    assert.ok(!copy.body.includes('Review window'));
  });

  it('hides coach attendance actions while an issue is open', () => {
    const booking = {
      status: 'awaiting_verification',
      active_issue: { id: 12, status: 'open', opened_by: 'student' },
      scheduled_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 60,
    };
    assert.equal(coachAttendanceBlockedByIssue(booking), true);
    assert.equal(canCoachComplete(booking), false);
    assert.equal(canCoachMarkNoShow(booking), false);
  });
});
