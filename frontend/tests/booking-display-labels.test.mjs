import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  bookingDisplayLabel,
  bookingDisplayTone,
  bookingStatusLabel,
  bookingOutcomeCopy,
  canCoachComplete,
  canCoachMarkNoShow,
  canReportLessonIssue,
  cancelMoneyConsequenceCopy,
  cancelledOutcomeCopy,
  coachAttendanceBlockedByIssue,
  hasOpenIssueReport,
  isCoachPayoutNotDue,
  isCoachPayoutReleased,
  isStudentPaymentRefunded,
  studentReviewWindowBannerCopy,
} from '../src/domain/bookingStatus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('booking list display labels (student vs coach)', () => {
  const cases = [
    ['pending', 'Requested', 'Response needed'],
    ['confirmed', 'Confirmed', 'Confirmed'],
    ['awaiting_verification', 'Awaiting confirmation', 'Action needed'],
    ['completed', 'Completed', 'Completed'],
    ['cancelled', 'Cancelled', 'Cancelled'],
    ['student_no_show', 'Student no-show', 'Student no-show'],
    ['coach_no_show', 'Coach no-show', 'Coach no-show'],
    ['disputed', 'Issue under review', 'Issue under review'],
  ];

  for (const [status, studentLabel, coachLabel] of cases) {
    it(`${status}: student “${studentLabel}”, coach “${coachLabel}”`, () => {
      const booking = { status, active_issue: null };
      assert.equal(bookingDisplayLabel(booking, { audience: 'student' }), studentLabel);
      assert.equal(bookingDisplayLabel(booking, { audience: 'coach' }), coachLabel);
    });
  }

  it('active issue overrides lifecycle status as Issue reported for both audiences', () => {
    const booking = {
      status: 'completed',
      active_issue: { id: 9, status: 'open', opened_by: 'student' },
    };
    assert.equal(bookingDisplayLabel(booking, { audience: 'student' }), 'Issue reported');
    assert.equal(bookingDisplayLabel(booking, { audience: 'coach' }), 'Issue reported');
  });

  it('BookingsListPage uses bookingDisplayLabel for row badges', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingsListPage.jsx'), 'utf8');
    assert.ok(src.includes('bookingDisplayLabel(b, { audience })'));
    assert.ok(src.includes('BOOKING_LIST_STATUS_FILTERS'));
  });
});

describe('booking display labels (issue reported vs disputed)', () => {
  it('labels awaiting_verification by audience', () => {
    assert.equal(bookingStatusLabel('awaiting_verification'), 'Awaiting confirmation');
    assert.equal(bookingStatusLabel('awaiting_verification', { audience: 'student' }), 'Awaiting confirmation');
    assert.equal(bookingStatusLabel('awaiting_verification', { audience: 'coach' }), 'Action needed');
  });

  it('labels Stripe chargeback status as Issue under review for customers', () => {
    assert.equal(bookingStatusLabel('disputed'), 'Issue under review');
    assert.equal(
      bookingDisplayLabel({ status: 'disputed', active_issue: null }),
      'Issue under review',
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

  it('coach decline copy is first-person for the coach', () => {
    const booking = {
      status: 'cancelled',
      cancelled_by: 'coach',
      declined_at: new Date().toISOString(),
      decline_reason_code: 'availability_conflict',
    };
    assert.equal(
      cancelledOutcomeCopy(booking, { audience: 'coach' }),
      'You declined this booking. The student’s payment authorization has been released.',
    );
    assert.equal(
      cancelledOutcomeCopy(booking, { audience: 'student' }),
      'The coach declined this booking. The payment authorization was released.',
    );
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

  it('hides Report an issue when the review countdown has ended (client clock)', () => {
    const reviewUntil = new Date(Date.now() - 60 * 1000).toISOString();
    const booking = {
      status: 'student_no_show',
      active_issue: null,
      scheduled_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 60,
      financial_review: {
        // Stale server flag — countdown already ended.
        window_open: true,
        lesson_ended_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        review_until: reviewUntil,
      },
    };
    assert.equal(canReportLessonIssue(booking), false);
    assert.equal(canReportLessonIssue({
      ...booking,
      financial_review: {
        ...booking.financial_review,
        window_open: true,
        review_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    }), true);
  });

  it('student no-show outcome copy omits report guidance after the window closes', () => {
    const closed = {
      status: 'student_no_show',
      financial_review: {
        window_open: false,
        lesson_ended_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        review_until: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    };
    const open = {
      ...closed,
      financial_review: {
        ...closed.financial_review,
        window_open: true,
        review_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    };
    const closedCopy = bookingOutcomeCopy(closed, { audience: 'student' });
    const openCopy = bookingOutcomeCopy(open, { audience: 'student' });
    assert.match(openCopy, /did not attend/i);
    assert.ok(!/report an issue/i.test(openCopy));
    assert.match(closedCopy, /issue-reporting window has ended/i);
    assert.ok(!/report an issue/i.test(closedCopy));
  });

  it('BookingDetailPage swaps no-show next steps after review closes', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    assert.ok(src.includes("title: 'Issue-reporting period closed'"));
    assert.ok(src.includes('The issue-reporting window for this no-show has ended'));
    assert.ok(src.includes('bookingDetailNextSteps(booking,'));
    assert.ok(src.includes('payment,'));
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

  it('cancel copy follows payment_status, not missing charge_id', () => {
    const pending = { status: 'pending', scheduled_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString() };
    const authPay = { payment_status: 'authorized', total_charge_to_student: 50 };
    assert.match(cancelMoneyConsequenceCopy(pending, authPay, { audience: 'student' }) || '', /authorization|authorized|released/i);

    const captured = { status: 'confirmed', scheduled_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString() };
    const capPay = { payment_status: 'captured', total_charge_to_student: 50, charge_id: null };
    const copy = cancelMoneyConsequenceCopy(captured, capPay, { audience: 'student' }) || '';
    assert.ok(copy.length > 0);
  });

  it('student no-show banner uses Issue-reporting window open without repeating the outcome', () => {
    const booking = {
      status: 'student_no_show',
      active_issue: null,
      financial_review: { window_open: true },
      scheduled_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 60,
    };
    const copy = studentReviewWindowBannerCopy(
      booking,
      { remaining: '15h 52m', deadlineFormatted: 'Sep 10, 3:00 AM' },
    );
    assert.equal(copy.title, 'Issue-reporting window open');
    assert.equal(
      copy.body,
      'Report an issue if this no-show is incorrect. 15h 52m remaining (until Sep 10, 3:00 AM).',
    );
    assert.ok(!/marked as a no-show/i.test(copy.body));
    assert.ok(!/did not attend/i.test(copy.body));
  });

  it('customer UI prefers issue language over dispute in BookingDetailPage', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('Confirm lesson attendance'));
    assert.ok(src.includes('IssueReportedPanel'));
    assert.ok(!src.includes('CoachIssueReportedPanel'));
    assert.ok(src.includes('review and issue-reporting window'));
    assert.ok(!src.includes('review and dispute window'));
    assert.match(src, /isStudent && booking\.status === 'completed'/);
    assert.ok(!src.includes("['completed', 'student_no_show', 'coach_no_show']"));
  });

  it('classifies refunded vs payout-released financial outcomes', () => {
    assert.equal(isStudentPaymentRefunded({ payment_status: 'refunded' }), true);
    assert.equal(isStudentPaymentRefunded({ payment_status: 'captured', refund_status: 'succeeded' }), true);
    assert.equal(isStudentPaymentRefunded({ payment_status: 'captured', refund_status: 'none' }), false);
    assert.equal(isCoachPayoutReleased({ payout_status: 'paid' }), true);
    assert.equal(isCoachPayoutReleased({ payout_status: 'pending' }), false);
    assert.equal(
      isCoachPayoutNotDue(
        { payout_status: 'none' },
        { payment_status: 'refunded', coach_payout_expected: 0 },
      ),
      true,
    );
    assert.equal(
      isCoachPayoutNotDue(
        { payout_status: 'paid' },
        { payment_status: 'captured', coach_payout_expected: 40 },
      ),
      false,
    );
  });
});
