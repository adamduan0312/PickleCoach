/**
 * Booking-detail review-window matrix: open vs closed client-side behavior.
 * Authoritative boundary: financial_review.review_until (not stale window_open).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  bookingDisplayLabel,
  bookingOutcomeCopy,
  canReportLessonIssue,
  isFinancialReviewWindowOpen,
  studentNeedsAttention,
  studentReviewWindowBannerCopy,
} from '../src/domain/bookingStatus.js';
import { formatRemainingUntil } from '../src/utils/datetime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function financialReview({ hoursUntilClose, lessonEndedHoursAgo = 2, window_open }) {
  const now = Date.now();
  const reviewUntil = new Date(now + hoursUntilClose * 3600 * 1000);
  const lessonEndedAt = new Date(now - lessonEndedHoursAgo * 3600 * 1000);
  const scheduledAt = new Date(lessonEndedAt.getTime() - 60 * 60 * 1000);
  return {
    scheduled_at: scheduledAt.toISOString(),
    duration_minutes: 60,
    financial_review: {
      // Intentionally stale vs hoursUntilClose when mismatched — client must use review_until.
      window_open: window_open ?? (hoursUntilClose > 0),
      lesson_ended_at: lessonEndedAt.toISOString(),
      review_until: reviewUntil.toISOString(),
    },
  };
}

function booking(status, hoursUntilClose, extra = {}) {
  return {
    status,
    active_issue: null,
    ...financialReview({ hoursUntilClose }),
    ...extra,
  };
}

describe('review-window matrix (client review_until)', () => {
  it('isFinancialReviewWindowOpen ignores stale window_open=true after deadline', () => {
    const b = booking('completed', -1, {
      financial_review: {
        window_open: true,
        lesson_ended_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
        review_until: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    });
    assert.equal(isFinancialReviewWindowOpen(b), false);
    assert.equal(canReportLessonIssue(b), false);
  });

  it('isFinancialReviewWindowOpen is true before deadline even if window_open=false', () => {
    const b = booking('completed', 12, {
      financial_review: {
        window_open: false,
        lesson_ended_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        review_until: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
      },
    });
    assert.equal(isFinancialReviewWindowOpen(b), true);
    assert.equal(canReportLessonIssue(b), true);
  });

  describe('completed', () => {
    it('before deadline: report available', () => {
      const b = booking('completed', 18);
      assert.equal(canReportLessonIssue(b), true);
      const copy = studentReviewWindowBannerCopy(
        b,
        { remaining: '18h', deadlineFormatted: 'later' },
      );
      assert.equal(copy.title, 'Issue-reporting window open');
      assert.match(copy.body, /complete/i);
    });

    it('after deadline: report hidden', () => {
      const b = booking('completed', -1);
      assert.equal(canReportLessonIssue(b), false);
    });
  });

  describe('student_no_show', () => {
    it('before: attention + report; banner is Issue-reporting window open', () => {
      const b = booking('student_no_show', 15);
      assert.equal(studentNeedsAttention(b), true);
      assert.equal(canReportLessonIssue(b), true);
      assert.equal(bookingDisplayLabel(b, { audience: 'student' }), 'Student no-show');
      const copy = studentReviewWindowBannerCopy(
        b,
        { remaining: '15h 52m', deadlineFormatted: 'Sep 10' },
      );
      assert.equal(copy.title, 'Issue-reporting window open');
      assert.match(copy.body, /Report an issue if this no-show is incorrect/);
      assert.ok(!/marked as a no-show/i.test(copy.body));
      const outcome = bookingOutcomeCopy(b, { audience: 'student' });
      assert.match(outcome, /did not attend/i);
      assert.ok(!/report an issue/i.test(outcome));
    });

    it('after: no attention for contest, no report; outcome notes closed window', () => {
      const b = booking('student_no_show', -1);
      assert.equal(studentNeedsAttention(b), false);
      assert.equal(canReportLessonIssue(b), false);
      assert.equal(bookingDisplayLabel(b, { audience: 'student' }), 'Student no-show');
      const outcome = bookingOutcomeCopy(b, { audience: 'student' });
      assert.match(outcome, /issue-reporting window has ended/i);
    });
  });

  describe('coach_no_show', () => {
    it('before: report available for student', () => {
      const b = booking('coach_no_show', 10);
      assert.equal(canReportLessonIssue(b), true);
      assert.match(bookingOutcomeCopy(b, { audience: 'student' }), /did not attend/i);
    });

    it('after: report hidden; closed settlement copy', () => {
      const b = booking('coach_no_show', -1);
      assert.equal(canReportLessonIssue(b), false);
      assert.match(bookingOutcomeCopy(b, { audience: 'student' }), /issue-reporting period has ended|settlement/i);
    });

    it('coach copy is neutral about how the state was reached and denies payout', () => {
      const b = booking('coach_no_show', -1);
      const copy = bookingOutcomeCopy(b, { audience: 'coach' });
      assert.match(copy, /coach no-show/i);
      assert.match(copy, /no payout is due/i);
      assert.ok(!/coach marked/i.test(copy));
      assert.ok(!/you marked/i.test(copy));
    });
  });

  describe('issue reported', () => {
    it('never offers a second report form; label stays Issue reported across deadline', () => {
      const openIssue = { id: 9, status: 'open', opened_by: 'student' };
      const before = booking('completed', 12, { active_issue: openIssue });
      const after = booking('completed', -1, { active_issue: openIssue });
      assert.equal(canReportLessonIssue(before), false);
      assert.equal(canReportLessonIssue(after), false);
      assert.equal(bookingDisplayLabel(before), 'Issue reported');
      assert.equal(bookingDisplayLabel(after), 'Issue reported');
      assert.equal(studentNeedsAttention(before), true);
      assert.equal(studentNeedsAttention(after), true);
    });
  });

  describe('disputed / issue under review', () => {
    it('customer label Payment dispute under review; no report form before or after deadline', () => {
      const before = booking('disputed', 8);
      const after = booking('disputed', -2);
      assert.equal(bookingDisplayLabel(before), 'Payment dispute under review');
      assert.equal(bookingDisplayLabel(after), 'Payment dispute under review');
      assert.equal(canReportLessonIssue(before), false);
      assert.equal(canReportLessonIssue(after), false);
      assert.equal(studentNeedsAttention(before), true);
      assert.equal(studentNeedsAttention(after), true);
    });
  });

  describe('cancelled / pending / confirmed / awaiting_verification', () => {
    it('cancelled never exposes report form', () => {
      const b = {
        status: 'cancelled',
        cancelled_by: 'student',
        scheduled_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        duration_minutes: 60,
        financial_review: {
          window_open: true,
          lesson_ended_at: new Date(Date.now() - 47 * 3600 * 1000).toISOString(),
          review_until: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
        },
      };
      assert.equal(canReportLessonIssue(b), false);
    });

    it('pending does not expose report form', () => {
      const b = {
        status: 'pending',
        scheduled_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        duration_minutes: 60,
        financial_review: null,
      };
      assert.equal(canReportLessonIssue(b), false);
      assert.equal(bookingDisplayLabel(b, { audience: 'student' }), 'Requested');
      assert.equal(bookingDisplayLabel(b, { audience: 'coach' }), 'Response needed');
    });

    it('confirmed future lesson does not expose report form', () => {
      const b = {
        status: 'confirmed',
        scheduled_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        duration_minutes: 60,
        financial_review: {
          window_open: false,
          lesson_ended_at: new Date(Date.now() + 49 * 3600 * 1000).toISOString(),
          review_until: new Date(Date.now() + 73 * 3600 * 1000).toISOString(),
        },
      };
      assert.equal(canReportLessonIssue(b), false);
    });

    it('awaiting_verification with open window allows report; labels stay audience-specific', () => {
      const b = booking('awaiting_verification', 20);
      assert.equal(canReportLessonIssue(b), true);
      assert.equal(bookingDisplayLabel(b, { audience: 'student' }), 'Awaiting confirmation');
      assert.equal(bookingDisplayLabel(b, { audience: 'coach' }), 'Confirmation needed');
    });

    it('awaiting_verification after deadline hides report', () => {
      assert.equal(canReportLessonIssue(booking('awaiting_verification', -1)), false);
    });
  });

  it('simulated open→closed transition (same booking object, advancing now)', () => {
    const reviewUntil = new Date(Date.now() + 90 * 1000).toISOString();
    const lessonEndedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const b = {
      status: 'student_no_show',
      active_issue: null,
      scheduled_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      duration_minutes: 60,
      financial_review: {
        window_open: true,
        lesson_ended_at: lessonEndedAt,
        review_until: reviewUntil,
      },
    };
    const tOpen = Date.now();
    assert.equal(isFinancialReviewWindowOpen(b, tOpen), true);
    assert.equal(canReportLessonIssue(b, tOpen), true);
    assert.notEqual(formatRemainingUntil(reviewUntil, new Date(tOpen)), 'ended');

    const tClosed = new Date(reviewUntil).getTime() + 1000;
    assert.equal(isFinancialReviewWindowOpen(b, tClosed), false);
    assert.equal(canReportLessonIssue(b, tClosed), false);
    assert.equal(formatRemainingUntil(reviewUntil, new Date(tClosed)), 'ended');
    // Historical label unchanged
    assert.equal(bookingDisplayLabel(b), 'Student no-show');
  });

  it('already-expired booking on initial load never allows report', () => {
    const b = booking('completed', -5, {
      financial_review: {
        window_open: true, // stale server truth on first paint
        lesson_ended_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
        review_until: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      },
    });
    assert.equal(canReportLessonIssue(b, Date.now()), false);
  });
});

describe('BookingDetailPage review-window wiring contracts', () => {
  const src = readFileSync(join(__dirname, '../src/pages/bookings/BookingDetailPage.jsx'), 'utf8');

  it('uses a single page-level useNow for time-sensitive UI', () => {
    const tickCalls = src.match(/useNow\(\d+/g) || [];
    assert.equal(tickCalls.length, 1, 'expected one useNow interval call (page-level)');
    assert.ok(src.includes('const now = useNow(15000)'));
    assert.ok(src.includes('canReportLessonIssue(booking, now)'));
    assert.ok(src.includes('isFinancialReviewWindowOpen'));
  });

  it('does not gate the financial banner on stale review.window_open alone', () => {
    assert.ok(!src.includes('!lessonEnded && !review.window_open'));
    assert.ok(!src.includes('stillOpen && (review.window_open || lessonEnded)'));
    assert.ok(src.includes('isFinancialReviewWindowOpen(booking, now)'));
  });

  it('keeps review form only for completed status', () => {
    assert.match(src, /isStudent && booking\.status === 'completed'/);
  });

  it('distinguishes refunded settlement from payment released in closed-window copy', () => {
    assert.ok(src.includes('Coach payout:'));
    assert.ok(src.includes('coachPayoutLabel'));
    assert.ok(src.includes('isCoachPayoutNotDue'));
    assert.ok(src.includes('isCoachPayoutReleased'));
    assert.ok(src.includes('issue-reporting period has closed'));
    assert.ok(src.includes('Payment released.'));
    assert.ok(src.includes('your payout has been released'));
    assert.ok(src.includes('View resolution details'));
    assert.ok(src.includes('View issue details'));
    assert.ok(src.includes('Issue resolved'));
    assert.ok(src.includes('issueResolutionFacts'));
    assert.ok(src.includes("title: 'Leave a review'"));
    assert.ok(src.includes("audience=\"coach\""));
    assert.ok(src.includes('Student review'));
    assert.ok(!src.includes('no payment is due to the coach'));
  });

  it('open-issue panel tells both roles settlement/payout is on hold', () => {
    assert.ok(src.includes('Your payout is on hold while the issue is open.'));
    assert.ok(src.includes('Settlement is on hold while the issue is open.'));
  });

  it('keeps lesson and issue status separate on open-issue Booking Detail', () => {
    assert.ok(src.includes('Lesson status'));
    assert.ok(src.includes('Issue status'));
    assert.ok(src.includes('Under review'));
    assert.ok(!src.includes('Completed · Issue under review'));
  });

  it('successful booking actions scroll to the top of Booking Detail after refetch', () => {
    assert.ok(src.includes('flushSync'));
    assert.ok(src.includes("window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })"));
    assert.ok(src.includes('pageTopRef'));
    assert.match(src, /ref=\{pageTopRef\}/);
    // Shared via run() so accept/decline/cancel/complete/no-show/report all get it.
    assert.match(src, /async function run[\s\S]*window\.scrollTo\(/);
    assert.ok(src.includes('run(() => disputesApi.create(body))'));
    assert.ok(!src.includes("run(() => disputesApi.create(body), 'Issue reported.')"));
    assert.ok(!src.includes('setFocusIssuePanel'));
    assert.ok(!src.includes('setScrollToTopAfterAction'));
    assert.ok(src.includes('canReportLessonIssue(booking, now)'));
    assert.match(src, /canReportLessonIssue\(booking, now\)[\s\S]*ReportIssueForm/);
  });

  it('does not promise payout release for coach_no_show next steps', () => {
    const start = src.indexOf("if (booking.status === 'coach_no_show')");
    const end = src.indexOf('// student_no_show — coach');
    assert.ok(start > 0 && end > start);
    const coachNoShowBlock = src.slice(start, end);
    assert.ok(coachNoShowBlock.includes('coach no-show'));
    assert.ok(coachNoShowBlock.includes('No payout is due'));
    assert.ok(!coachNoShowBlock.includes('Your payout will be released after the 24-hour'));
    assert.ok(!coachNoShowBlock.includes('Coach marked'));
  });
});
