import {
  canCoachComplete,
  canCoachMarkNoShow,
  canReportLessonIssue,
  coachAcceptanceDeadlineAt,
  hasOpenIssueReport,
  isFinancialReviewWindowOpen,
  isPostLessonReviewEligible,
} from './bookingStatus.js';
import { WEATHER_ACTION_NEEDED_LABEL, weatherRequestAwaitsResponse } from './cancellationPolicy.js';

/**
 * Actionable dashboard reminders from booking list data.
 * One banner per category; the CTA opens the next booking in that category’s queue.
 */

function sortByDeadlineAsc(a, b) {
  const da = coachAcceptanceDeadlineAt(a);
  const db = coachAcceptanceDeadlineAt(b);
  const ta = da ? new Date(da).getTime() : Number.POSITIVE_INFINITY;
  const tb = db ? new Date(db).getTime() : Number.POSITIVE_INFINITY;
  return ta - tb;
}

function sortByScheduledAsc(a, b) {
  return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
}

/** Weather requests expire at lesson start, so this banner leads. */
function weatherRequestReminder(list, audience, now) {
  const waiting = list.filter((b) => weatherRequestAwaitsResponse(b, audience, now)).sort(sortByScheduledAsc);
  if (waiting.length === 0) return null;
  const many = waiting.length > 1;
  const asker = audience === 'coach' ? 'Your student' : 'Your coach';
  return {
    id: `${audience}-weather-request`,
    tone: 'warning',
    title: many ? `Action needed — ${waiting.length} weather cancellation requests` : WEATHER_ACTION_NEEDED_LABEL,
    body: many
      ? 'Agree to cancel for weather or keep each lesson before it starts. Open the next request to respond.'
      : `${asker} asked to cancel an upcoming lesson for weather. Agree or keep the lesson before it starts.`,
    to: `/bookings/${waiting[0].id}`,
    cta: many ? 'Respond to next request' : 'Respond',
  };
}

/**
 * @returns {Array<{ id: string, tone: 'warning'|'info', title: string, body: string, to: string, cta: string }>}
 */
export function coachDashboardReminders(bookings, now = Date.now()) {
  const list = Array.isArray(bookings) ? bookings : [];
  const out = [];
  const weather = weatherRequestReminder(list, 'coach', now);
  if (weather) out.push(weather);

  const pending = list.filter((b) => b?.status === 'pending').sort(sortByDeadlineAsc);
  if (pending.length > 0) {
    const first = pending[0];
    const many = pending.length > 1;
    out.push({
      id: 'coach-respond',
      tone: 'warning',
      title: many
        ? `Response needed on ${pending.length} booking requests`
        : 'Response needed on a booking request',
      body: many
        ? 'Accept or decline each request before its deadline so the student’s payment authorization isn’t released. Open the next request to continue.'
        : 'Accept or decline before the deadline so the student’s payment authorization isn’t released.',
      to: `/bookings/${first.id}`,
      cta: many ? 'Review next request' : 'Review request',
    });
  }

  const attendance = list
    .filter((b) => canCoachComplete(b, now) || canCoachMarkNoShow(b, now))
    .sort(sortByScheduledAsc);
  if (attendance.length > 0) {
    const first = attendance[0];
    const many = attendance.length > 1;
    out.push({
      id: 'coach-attendance',
      tone: 'warning',
      title: many
        ? `Confirm attendance for ${attendance.length} finished lessons`
        : 'Confirm attendance for a finished lesson',
      body: many
        ? 'Review each finished lesson and record what happened: Complete if it happened, or Student no-show if they did not attend. This records attendance; it does not determine your payout.'
        : 'Mark Complete if the lesson happened, or Student no-show if they did not attend. This records attendance; it does not determine your payout.',
      to: `/bookings/${first.id}`,
      cta: many ? 'Review next lesson' : 'Confirm attendance',
    });
  }

  return out;
}

/**
 * @returns {Array<{ id: string, tone: 'warning'|'info', title: string, body: string, to: string, cta: string }>}
 */
export function studentDashboardReminders(bookings, now = Date.now()) {
  const list = Array.isArray(bookings) ? bookings : [];
  const out = [];
  const weather = weatherRequestReminder(list, 'student', now);
  if (weather) out.push(weather);

  const pending = list.filter((b) => b?.status === 'pending').sort(sortByDeadlineAsc);
  if (pending.length > 0) {
    const first = pending[0];
    const many = pending.length > 1;
    out.push({
      id: 'student-pending',
      tone: 'info',
      title: many
        ? `Waiting for coaches to accept ${pending.length} requests`
        : 'Waiting for the coach to accept',
      body: many
        ? 'Your cards are only authorized for now. If a coach declines or doesn’t respond in time, that authorization is released. Open the next request to review it.'
        : 'Your card is only authorized for now. If the coach declines or doesn’t respond in time, the authorization is released.',
      to: `/bookings/${first.id}`,
      cta: many ? 'View next request' : 'View request',
    });
  }

  const review = list
    .filter((b) => {
      if (!isPostLessonReviewEligible(b, now)) return false;
      if (!isFinancialReviewWindowOpen(b, now)) return false;
      // After an issue is already open, the booking detail owns next steps.
      if (hasOpenIssueReport(b)) return false;
      return true;
    })
    .sort(sortByScheduledAsc);
  if (review.length > 0) {
    const first = review[0];
    const many = review.length > 1;
    const canReport = canReportLessonIssue(first, now);
    out.push({
      id: 'student-review-window',
      tone: 'warning',
      title: many
        ? `Review window open for ${review.length} recent lessons`
        : 'Review window open for a recent lesson',
      body: many
        ? (canReport
          ? 'Check each booking while its review window is open. If something went wrong, report an issue before that window closes.'
          : 'Check each booking while its review window is still open.')
        : (canReport
          ? 'Check your booking. If something went wrong, report an issue before the review window closes.'
          : 'Check your booking while the review window is still open.'),
      to: `/bookings/${first.id}`,
      cta: many ? 'Check next booking' : 'Check booking',
    });
  }

  return out;
}
