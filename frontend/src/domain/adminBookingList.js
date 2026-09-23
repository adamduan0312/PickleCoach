/**
 * Admin Bookings list organization — each tab has its own operational rule.
 *
 * | Tab                   | Inside the tab                                      |
 * | --------------------- | --------------------------------------------------- |
 * | All                   | Action priority → lifecycle → date/time             |
 * | Pending               | Acceptance deadline → lesson date/time              |
 * | Confirmed             | Upcoming soonest first (then started/past recent)   |
 * | Awaiting verification | Oldest lesson needing verification → newest         |
 * | Completed             | Most recently completed → oldest                    |
 * | Cancelled             | Most recently cancelled → oldest                    |
 * | Disputed              | Open/needs action → dispute age → lesson date       |
 * | Student no-show       | Most recent → oldest                                |
 * | Coach no-show         | Most recent → oldest                                |
 *
 * Booking status and in-app issue remain separate columns — never combined.
 *
 * All (no visual sections) bands:
 *   1. Action required — pending → awaiting_verification → disputed
 *   2. Upcoming — confirmed
 *   3. Finished — completed → student_no_show → coach_no_show
 *   4. Closed — cancelled
 */

import { coachAcceptanceDeadlineAt } from './bookingStatus.js';

const ACTION_REQUIRED_STATUS_RANK = {
  pending: 0,
  awaiting_verification: 1,
  disputed: 2,
};

const FINISHED_STATUS_RANK = {
  completed: 0,
  student_no_show: 1,
  coach_no_show: 2,
};

/** open / under_review need admin attention before anything else in Disputed. */
const DISPUTE_ACTION_RANK = {
  open: 0,
  under_review: 1,
};

/**
 * Lifecycle band for Admin All view.
 * @returns {0|1|2|3}
 */
export function adminBookingLifecycleGroup(booking) {
  const status = booking?.status;
  if (status === 'pending' || status === 'awaiting_verification' || status === 'disputed') {
    return 0;
  }
  if (status === 'confirmed') return 1;
  if (
    status === 'completed'
    || status === 'student_no_show'
    || status === 'coach_no_show'
  ) {
    return 2;
  }
  if (status === 'cancelled') return 3;
  return 2;
}

function ms(value) {
  if (value == null || value === '') return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function lessonStartMs(booking) {
  const t = ms(booking?.scheduled_at);
  return Number.isFinite(t) ? t : 0;
}

function cmpAsc(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function cmpDesc(a, b) {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/** Pending primary key: acceptance deadline (fallback created_at / lesson). */
function pendingDeadlineMs(booking) {
  const deadline = ms(coachAcceptanceDeadlineAt(booking));
  if (Number.isFinite(deadline)) return deadline;
  const created = ms(booking?.created_at);
  if (Number.isFinite(created)) return created;
  return lessonStartMs(booking);
}

function cancelledAtMs(booking) {
  const cancelled = ms(booking?.cancelled_at);
  if (Number.isFinite(cancelled)) return cancelled;
  return lessonStartMs(booking);
}

function disputeActionRank(booking) {
  const raw = String(booking?.active_issue?.status || '').toLowerCase();
  if (raw && DISPUTE_ACTION_RANK[raw] != null) return DISPUTE_ACTION_RANK[raw];
  // Stripe / booking-status disputed without an in-app issue still needs attention.
  if (booking?.status === 'disputed') return 0;
  return 2;
}

function disputeAgeMs(booking) {
  const opened = ms(booking?.active_issue?.opened_at);
  if (Number.isFinite(opened)) return opened;
  const created = ms(booking?.created_at);
  if (Number.isFinite(created)) return created;
  return lessonStartMs(booking);
}

/**
 * Compare two bookings that share the same status (tab filter or All subtype).
 */
function compareWithinStatus(a, b, status, nowMs) {
  switch (status) {
    case 'pending': {
      const byDeadline = cmpAsc(pendingDeadlineMs(a), pendingDeadlineMs(b));
      if (byDeadline !== 0) return byDeadline;
      return cmpAsc(lessonStartMs(a), lessonStartMs(b));
    }
    case 'confirmed': {
      const ta = lessonStartMs(a);
      const tb = lessonStartMs(b);
      const aUpcoming = ta >= nowMs;
      const bUpcoming = tb >= nowMs;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      return aUpcoming ? cmpAsc(ta, tb) : cmpDesc(ta, tb);
    }
    case 'awaiting_verification':
      return cmpAsc(lessonStartMs(a), lessonStartMs(b));
    case 'disputed': {
      const byAction = cmpAsc(disputeActionRank(a), disputeActionRank(b));
      if (byAction !== 0) return byAction;
      const byAge = cmpAsc(disputeAgeMs(a), disputeAgeMs(b));
      if (byAge !== 0) return byAge;
      return cmpAsc(lessonStartMs(a), lessonStartMs(b));
    }
    case 'completed':
    case 'student_no_show':
    case 'coach_no_show':
      return cmpDesc(lessonStartMs(a), lessonStartMs(b));
    case 'cancelled':
      return cmpDesc(cancelledAtMs(a), cancelledAtMs(b));
    default:
      return cmpDesc(lessonStartMs(a), lessonStartMs(b));
  }
}

function compareWithinAllGroup(a, b, group, nowMs) {
  if (group === 0) {
    const ra = ACTION_REQUIRED_STATUS_RANK[a.status] ?? 99;
    const rb = ACTION_REQUIRED_STATUS_RANK[b.status] ?? 99;
    if (ra !== rb) return ra - rb;
    return compareWithinStatus(a, b, a.status, nowMs);
  }
  if (group === 2) {
    const ra = FINISHED_STATUS_RANK[a.status] ?? 99;
    const rb = FINISHED_STATUS_RANK[b.status] ?? 99;
    if (ra !== rb) return ra - rb;
    return compareWithinStatus(a, b, a.status, nowMs);
  }
  return compareWithinStatus(a, b, a.status, nowMs);
}

/**
 * Sort admin booking rows for the current tab.
 * @param {Array<object>} bookings
 * @param {string} [statusFilter] empty string = All
 * @param {number} [nowMs]
 */
export function sortAdminBookingsForList(bookings, statusFilter = '', nowMs = Date.now()) {
  if (!Array.isArray(bookings) || bookings.length < 2) return bookings || [];

  const filteredStatus = statusFilter || '';

  return [...bookings].sort((a, b) => {
    if (!filteredStatus) {
      const ga = adminBookingLifecycleGroup(a);
      const gb = adminBookingLifecycleGroup(b);
      if (ga !== gb) return ga - gb;
      return compareWithinAllGroup(a, b, ga, nowMs);
    }
    return compareWithinStatus(a, b, filteredStatus, nowMs);
  });
}

/**
 * Short operational hint under the status tabs.
 * @param {Array<object>} bookings already filtered to the current tab
 * @param {string} statusFilter
 */
export function adminBookingsListHint(bookings, statusFilter = '') {
  const rows = Array.isArray(bookings) ? bookings : [];
  const n = rows.length;
  if (n === 0) return '';

  if (!statusFilter) {
    const pending = rows.filter((b) => b.status === 'pending').length;
    const awaiting = rows.filter((b) => b.status === 'awaiting_verification').length;
    const disputed = rows.filter((b) => b.status === 'disputed').length;
    const parts = [];
    if (pending) parts.push(`${pending} pending`);
    if (awaiting) parts.push(`${awaiting} awaiting verification`);
    if (disputed) parts.push(`${disputed} disputed`);
    if (parts.length === 0) {
      return `${n} booking${n === 1 ? '' : 's'} · action required → upcoming → finished → closed`;
    }
    return `Action required: ${parts.join(' · ')} · then upcoming, finished, closed`;
  }

  switch (statusFilter) {
    case 'pending':
      return `${n} awaiting coach response · acceptance deadline, then lesson time`;
    case 'confirmed':
      return `${n} confirmed · soonest upcoming lesson first`;
    case 'awaiting_verification':
      return `${n} awaiting attendance/review · oldest outstanding first`;
    case 'disputed':
      return `${n} disputed · open/needs action, then oldest dispute`;
    case 'completed':
      return `${n} completed · most recently completed first`;
    case 'cancelled':
      return `${n} cancelled · most recently cancelled first`;
    case 'student_no_show':
      return `${n} student no-show · most recent first`;
    case 'coach_no_show':
      return `${n} coach no-show · most recent first`;
    default:
      return `${n} booking${n === 1 ? '' : 's'}`;
  }
}
