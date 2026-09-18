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
  cancellationHistoryEventLabel,
  cancellationHistoryReasonDisplay,
  cancelReasonLabel,
  coachAttendanceBlockedByIssue,
  coachCanReportStudentNoShowClaim,
  hasOpenIssueReport,
  isCoachPayoutNotDue,
  isCoachPayoutReleased,
  isStudentPaymentRefunded,
  lessonAmountLabel,
  coachCancelMoneyPresentation,
  studentCoachCancelMoneyPresentation,
  paymentAmountCaption,
  paymentStatusLabel,
  studentReviewWindowBannerCopy,
} from '../src/domain/bookingStatus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('booking list display labels (student vs coach)', () => {
  const cases = [
    ['pending', 'Requested', 'Response needed'],
    ['confirmed', 'Confirmed', 'Confirmed'],
    ['awaiting_verification', 'Awaiting confirmation', 'Confirmation needed'],
    ['completed', 'Completed', 'Completed'],
    ['cancelled', 'Cancelled', 'Cancelled'],
    ['student_no_show', 'Student no-show', 'Student no-show'],
    ['coach_no_show', 'Coach no-show', 'Coach no-show'],
    ['disputed', 'Payment dispute under review', 'Payment dispute under review'],
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
    const listSrc = readFileSync(join(__dirname, '../src/pages/bookings/BookingsListPage.jsx'), 'utf8');
    const statusSrc = readFileSync(join(__dirname, '../src/domain/bookingStatus.js'), 'utf8');
    assert.ok(listSrc.includes('bookingDisplayLabel(b, { audience })'));
    assert.ok(listSrc.includes('STUDENT_BOOKING_LIST_FILTERS'));
    assert.ok(listSrc.includes('COACH_BOOKING_LIST_FILTERS'));
    assert.ok(statusSrc.includes("label: 'Action needed'"));
    assert.ok(statusSrc.includes("value: 'awaiting_confirmation'"));
    assert.ok(!statusSrc.includes("label: 'Issues'"));
    assert.ok(!statusSrc.includes("label: 'Needs attention'"));
  });

  it('coach list report cue is suppressed when an issue or dispute is already open', () => {
    const listSrc = readFileSync(join(__dirname, '../src/pages/bookings/BookingsListPage.jsx'), 'utf8');
    assert.ok(listSrc.includes('left to report'));
    assert.ok(listSrc.includes('!hasOpenIssueReport(b)'));
    assert.ok(listSrc.includes("b.status !== 'disputed'"));
  });
});

describe('booking display labels (issue reported vs disputed)', () => {
  it('labels awaiting_verification by audience', () => {
    assert.equal(bookingStatusLabel('awaiting_verification'), 'Awaiting confirmation');
    assert.equal(bookingStatusLabel('awaiting_verification', { audience: 'student' }), 'Awaiting confirmation');
    assert.equal(bookingStatusLabel('awaiting_verification', { audience: 'coach' }), 'Confirmation needed');
  });

  it('labels Stripe chargeback status as Payment dispute under review for customers', () => {
    assert.equal(bookingStatusLabel('disputed'), 'Payment dispute under review');
    assert.equal(
      bookingDisplayLabel({ status: 'disputed', active_issue: null }),
      'Payment dispute under review',
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

  it('never offers coach student_no_show_claim (Mark Student no-show is the path)', () => {
    const awaiting = {
      status: 'awaiting_verification',
      active_issue: null,
      scheduled_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 60,
    };
    assert.equal(canCoachMarkNoShow(awaiting), true);
    assert.equal(coachCanReportStudentNoShowClaim(awaiting), false);

    const completed = {
      status: 'completed',
      active_issue: null,
      scheduled_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 60,
      financial_review: {
        lesson_ended_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        review_until: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
        window_open: true,
      },
    };
    assert.equal(canCoachMarkNoShow(completed), false);
    assert.equal(coachCanReportStudentNoShowClaim(completed), false);
  });

  it('ReportIssueForm omits student_no_show_claim for coaches', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    assert.match(src, /isCoach\s*\n?\s*\? \['misconduct', 'lesson_not_completed', 'other'\]/);
    assert.ok(!src.includes("? ['student_no_show_claim']"));
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

  it('system expiry cancel copy is first-person for the coach', () => {
    const booking = { status: 'cancelled', cancelled_by: 'system' };
    assert.equal(
      cancelledOutcomeCopy(booking, { audience: 'coach' }),
      'You didn’t respond before the deadline. The student’s payment authorization was released.',
    );
    assert.equal(
      cancelledOutcomeCopy(booking, { audience: 'student' }),
      'The coach didn’t respond before the deadline. The payment authorization was released.',
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

    const resolvedNoPenalty = bookingOutcomeCopy(
      {
        ...closed,
        resolved_issue: { id: 9, penalize_role: 'none', decision: 'upheld' },
      },
      { audience: 'student' },
    );
    assert.match(resolvedNoPenalty, /No refund was issued/i);
    assert.match(resolvedNoPenalty, /No reliability penalty was applied/i);
    assert.ok(!/may affect your reliability/i.test(resolvedNoPenalty));
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
    assert.ok(!src.includes('to="/issues"'));
  });

  it('IssueReportedPanel hides review-window countdown when an issue or chargeback is open', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    const start = src.indexOf('function IssueReportedPanel');
    const end = src.indexOf('function FinancialReviewBanner');
    assert.ok(start >= 0 && end > start, 'IssueReportedPanel and FinancialReviewBanner must both exist');
    const panel = src.slice(start, end);
    const banner = src.slice(end, src.indexOf('function ReportIssueForm'));

    assert.ok(panel.includes('Settlement is on hold while the issue is open'));
    assert.ok(panel.includes('Your payout is on hold while the issue is open'));
    assert.ok(panel.includes('View issue details'));
    assert.ok(!panel.includes('Issue-reporting window'));
    assert.ok(!panel.includes('financial_review'));
    assert.ok(!panel.includes('formatRemainingUntil'));
    assert.ok(!panel.includes('review_until'));

    // Bookings without an open issue still get review-window messaging from the banner.
    assert.ok(banner.includes('Issue-reporting period'));
    assert.ok(banner.includes('Payout is protected for 24 hours after the lesson'));
    assert.match(banner, /hasOpenIssueReport\(booking\) \|\| booking\.status === 'disputed'/);
  });

  it('IssueDetailPage uses structured Decision / Financial outcome and Under review', () => {
    const src = readFileSync(join(__dirname, '../src/pages/issues/IssueDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('Under review'));
    assert.ok(src.includes('Back to booking'));
    assert.ok(src.includes('/bookings/'));
    assert.ok(src.includes('Dispute financial action'));
    assert.ok(src.includes('Admin notes'));
    assert.ok(src.includes('issueResolutionFacts'));
    assert.ok(src.includes('bookingSettlementFacts'));
    assert.ok(!src.includes('resolutionOutcomeLabel'));
    assert.ok(!src.includes('Approved refund'));
  });

  it('IssueResolvedPanel uses labeled facts and separate coach payout', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('IssueResolvedPanel'));
    assert.ok(src.includes('View resolution details'));
    assert.ok(src.includes('Coach payout'));
    assert.ok(src.includes('issueResolutionFacts'));
    assert.ok(src.includes('Coach payout:'));
    assert.ok(!src.includes('resolvedIssueSummary'));
    assert.ok(!src.includes('no payment is due to the coach'));
  });

  it('customer nav has no Issues or Disputes item', () => {
    const src = readFileSync(join(__dirname, '../src/domain/navAttention.js'), 'utf8');
    assert.ok(src.includes("/admin/disputes"));
    assert.ok(src.includes("label: 'Disputes'"));
    assert.ok(!src.includes("label: 'Issues'"));
    assert.ok(!src.includes("to: '/issues'"));
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
        { payout_status: 'none' },
        { payment_status: 'partially_refunded', coach_payout_expected: '36.80' },
      ),
      false,
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

describe('cancellation history customer-facing copy', () => {
  it('labels cancel reason codes without exposing raw enums as the only text', () => {
    assert.equal(cancelReasonLabel('schedule_conflict'), 'Schedule conflict');
    assert.equal(cancelReasonLabel('other'), 'Other');
    assert.equal(cancelReasonLabel(null), null);
  });

  it('uses You vs third-person based on audience and cancelled_by', () => {
    assert.equal(
      cancellationHistoryEventLabel({ cancelled_by: 'coach' }, { audience: 'student' }),
      'Coach cancelled this booking',
    );
    assert.equal(
      cancellationHistoryEventLabel({ cancelled_by: 'coach' }, { audience: 'coach' }),
      'You cancelled this booking',
    );
    assert.equal(
      cancellationHistoryEventLabel({ cancelled_by: 'student' }, { audience: 'student' }),
      'You cancelled this booking',
    );
    assert.equal(
      cancellationHistoryEventLabel({ cancelled_by: 'student' }, { audience: 'coach' }),
      'Student cancelled this booking',
    );
    assert.equal(
      cancellationHistoryEventLabel({ cancelled_by: 'system' }, { audience: 'student' }),
      'This booking was cancelled automatically',
    );
    assert.equal(
      cancellationHistoryEventLabel({ cancelled_by: 'admin' }, { audience: 'student' }),
      'An administrator cancelled this booking',
    );
  });

  it('prefers readable reason labels and uses notes for other/system text', () => {
    assert.deepEqual(
      cancellationHistoryReasonDisplay({ reason: 'schedule_conflict', reason_notes: null }),
      { primary: 'Schedule conflict', detail: null },
    );
    assert.deepEqual(
      cancellationHistoryReasonDisplay({ reason: 'other', reason_notes: 'schedule conflict' }),
      { primary: 'schedule conflict', detail: null },
    );
    assert.deepEqual(
      cancellationHistoryReasonDisplay({
        reason: 'weather',
        reason_notes: 'Court flooded after the storm',
      }),
      { primary: 'Weather', detail: 'Court flooded after the storm' },
    );
    assert.equal(cancellationHistoryReasonDisplay({ reason: null, reason_notes: null }), null);
    assert.deepEqual(
      cancellationHistoryReasonDisplay({
        reason: 'other',
        reason_notes: 'Coach did not accept or decline before the acceptance deadline (authorization voided)',
      }),
      {
        primary: 'Coach did not accept or decline before the acceptance deadline (authorization voided)',
        detail: null,
      },
    );
  });

  it('BookingDetailPage renders cancellation history through customer-facing helpers', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('cancellationHistoryEventLabel'));
    assert.ok(src.includes('cancellationHistoryReasonDisplay'));
    assert.ok(!src.includes('{row.cancelled_by} · {row.reason}'));
  });
});

describe('lesson amount label', () => {
  it('does not render Amount (amount) for failed payments', () => {
    assert.equal(
      lessonAmountLabel({ total_charge_to_student: '55.00', payment_status: 'failed' }, { status: 'cancelled' }),
      'Amount',
    );
    assert.equal(paymentStatusLabel({ payment_status: 'failed' }), 'Payment failed');
  });

  it('keeps charge-state labels for authorized and captured payments', () => {
    assert.equal(
      lessonAmountLabel({ total_charge_to_student: '55.00', payment_status: 'authorized' }, { status: 'confirmed' }),
      'Amount authorized',
    );
    assert.equal(
      lessonAmountLabel({ total_charge_to_student: '55.00', payment_status: 'captured' }, { status: 'completed' }),
      'Amount charged',
    );
  });
});

describe('coach cancel money presentation', () => {
  it('returns null unless the booking is a coach cancellation', () => {
    assert.equal(
      coachCancelMoneyPresentation(
        { status: 'cancelled', cancelled_by: 'student' },
        { payment_status: 'captured', coach_payout_expected: '50.60' },
      ),
      null,
    );
    assert.equal(
      coachCancelMoneyPresentation(
        { status: 'confirmed', cancelled_by: 'coach' },
        { payment_status: 'captured', coach_payout_expected: '50.60' },
      ),
      null,
    );
  });

  it('marks captured coach cancels as student refund pending and payout not payable', () => {
    assert.deepEqual(
      coachCancelMoneyPresentation(
        {
          status: 'cancelled',
          cancelled_by: 'coach',
          payout_status: 'none',
          cancellationHistory: [{ cancelled_by: 'coach', refund_amount: '55.00' }],
        },
        {
          total_charge_to_student: '55.00',
          payment_status: 'captured',
          refund_status: 'none',
          coach_payout_expected: '50.60',
        },
      ),
      {
        amountLabel: 'Amount',
        paymentStatusLine: 'Student refund pending',
        payoutLabel: 'Coach payout',
        payoutKind: 'not_payable',
      },
    );
  });

  it('shows student refunded and $0 payout after refund completes', () => {
    assert.deepEqual(
      coachCancelMoneyPresentation(
        { status: 'cancelled', cancelled_by: 'coach', payout_status: 'none' },
        {
          total_charge_to_student: '55.00',
          payment_status: 'refunded',
          refund_status: 'succeeded',
          coach_payout_expected: '0.00',
        },
      ),
      {
        amountLabel: 'Amount',
        paymentStatusLine: 'Student refunded',
        payoutLabel: 'Coach payout',
        payoutKind: 'zero',
      },
    );
  });

  it('treats authorize-only / voiding coach cancels as not payable', () => {
    assert.deepEqual(
      coachCancelMoneyPresentation(
        { status: 'cancelled', cancelled_by: 'coach', payout_status: 'none' },
        {
          total_charge_to_student: '55.00',
          payment_status: 'pending_void',
          refund_status: 'none',
          coach_payout_expected: '50.60',
        },
      ),
      {
        amountLabel: 'Amount authorized',
        paymentStatusLine: 'Authorization releasing',
        payoutLabel: 'Coach payout',
        payoutKind: 'not_payable',
      },
    );
  });

  it('does not claim authorization release for bare failed payments', () => {
    assert.deepEqual(
      coachCancelMoneyPresentation(
        { status: 'cancelled', cancelled_by: 'coach', payout_status: 'none' },
        {
          total_charge_to_student: '55.00',
          payment_status: 'failed',
          refund_status: 'none',
          coach_payout_expected: '50.60',
        },
      ),
      {
        amountLabel: 'Amount',
        paymentStatusLine: 'No successful charge was made',
        payoutLabel: 'Coach payout',
        payoutKind: 'not_payable',
      },
    );
  });

  it('treats failed + released escrow as authorization release for coaches', () => {
    const view = coachCancelMoneyPresentation(
      { status: 'cancelled', cancelled_by: 'coach', payout_status: 'none' },
      {
        total_charge_to_student: '55.00',
        payment_status: 'failed',
        refund_status: 'none',
        escrow_status: 'released',
        coach_payout_expected: '50.60',
      },
    );
    assert.equal(view.payoutKind, 'not_payable');
    assert.equal(view.paymentStatusLine, 'Authorization released');
  });

  it('BookingDetailPage uses coachCancelMoneyPresentation for coach lesson money', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('coachCancelMoneyPresentation'));
    assert.ok(src.includes("payoutKind === 'not_payable'"));
  });
});

describe('student coach-cancel money presentation', () => {
  it('shows authorization release when payment was never captured', () => {
    const booking = { status: 'cancelled', cancelled_by: 'coach', payout_status: 'none' };
    const payment = {
      total_charge_to_student: '55.00',
      payment_status: 'pending_void',
      refund_status: 'none',
    };
    const view = studentCoachCancelMoneyPresentation(booking, payment);
    assert.equal(view.refundValueText, 'No charge');
    assert.equal(view.refundStatusLine, 'Payment authorization released');
    assert.match(view.lead, /No charge was made/i);
    assert.match(view.lead, /authorization was released/i);
    assert.equal(
      cancelledOutcomeCopy(booking, { audience: 'student', payment }),
      view.lead,
    );
  });

  it('uses safer no-charge copy for bare failed payments', () => {
    const booking = { status: 'cancelled', cancelled_by: 'coach', payout_status: 'none' };
    const payment = {
      total_charge_to_student: '55.00',
      payment_status: 'failed',
      refund_status: 'none',
    };
    const view = studentCoachCancelMoneyPresentation(booking, payment);
    assert.equal(view.refundValueText, 'No charge');
    assert.equal(view.refundStatusLine, 'No successful charge was made');
    assert.match(view.lead, /No successful charge was made/i);
    assert.doesNotMatch(view.lead, /authorization was released/i);
  });

  it('shows authorization release for failed payment with released escrow', () => {
    const view = studentCoachCancelMoneyPresentation(
      { status: 'cancelled', cancelled_by: 'coach' },
      {
        total_charge_to_student: '55.00',
        payment_status: 'failed',
        refund_status: 'none',
        escrow_status: 'released',
      },
    );
    assert.equal(view.refundStatusLine, 'Payment authorization released');
    assert.match(view.lead, /authorization was released/i);
  });

  it('shows refund processing while captured payment awaits refund', () => {
    const booking = {
      status: 'cancelled',
      cancelled_by: 'coach',
      cancellationHistory: [{ cancelled_by: 'coach', refund_amount: '55.00' }],
    };
    const payment = {
      total_charge_to_student: '55.00',
      payment_status: 'captured',
      refund_status: 'none',
    };
    const view = studentCoachCancelMoneyPresentation(booking, payment);
    assert.equal(view.refundValueText, 'Full refund');
    assert.equal(view.refundStatusLine, 'Refund processing');
    assert.match(view.lead, /refund is being processed/i);
  });

  it('shows refund completed with amount after settlement', () => {
    const booking = { status: 'cancelled', cancelled_by: 'coach' };
    const payment = {
      total_charge_to_student: '55.00',
      payment_status: 'refunded',
      refund_status: 'succeeded',
      refunded_amount: '55.00',
    };
    const view = studentCoachCancelMoneyPresentation(booking, payment);
    assert.equal(view.refundValueKind, 'amount');
    assert.equal(view.refundValueAmount, 55);
    assert.equal(view.refundStatusLine, 'Refund completed');
    assert.match(view.lead, /refund has been completed/i);
    assert.doesNotMatch(view.lead, /will be refunded/i);
  });

  it('shows review copy when escrow requires manual review', () => {
    const view = studentCoachCancelMoneyPresentation(
      { status: 'cancelled', cancelled_by: 'coach' },
      {
        total_charge_to_student: '55.00',
        payment_status: 'captured',
        refund_status: 'none',
        escrow_status: 'manual_payout_required',
      },
    );
    assert.match(view.refundStatusLine, /requires review/i);
  });

  it('BookingDetailPage wires studentCoachCancelMoneyPresentation', () => {
    const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('studentCoachCancelMoneyPresentation'));
    assert.ok(src.includes('refundStatusLine'));
  });
});
