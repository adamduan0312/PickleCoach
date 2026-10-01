import { AVAILABILITY_LOOKAHEAD_DAYS } from '../utils/datetime.js';

/** Mirrors backend AVAILABILITY_MAX_MONTHS_AHEAD (utils/availabilityRules.js). */
export const AVAILABILITY_MAX_MONTHS_AHEAD = 24;

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86400000;

export function weekdayLabel(weekday) {
  return WEEKDAY_LABELS[Number(weekday)] || String(weekday);
}

/** "09:00:00" → "9:00 AM", "16:30" → "4:30 PM". */
export function formatTimeOfDay12h(hms) {
  if (!hms) return '';
  const [hRaw, mRaw] = String(hms).split(':');
  const h = Number(hRaw);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(Number(mRaw) || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2027-03-04" → "Mar 4, 2027" (calendar day, no timezone shift). */
export function formatYmdLong(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** Today's calendar date (YYYY-MM-DD) in `timeZone`. */
export function todayInZone(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function ymdToUtcMs(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToYmd(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function addDaysYmd(ymd, days) {
  return utcMsToYmd(ymdToUtcMs(ymd) + days * DAY_MS);
}

/** Same month-clamping rule as the backend ceiling (Jan 31 + 1 month → Feb 28/29). */
export function addMonthsYmd(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const total = (m - 1) + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Latest start/end date the backend accepts. */
export function latestAvailabilityDate(today) {
  return addMonthsYmd(today, AVAILABILITY_MAX_MONTHS_AHEAD);
}

/**
 * When students can first book a window. The booking flow only lists slots in the next
 * AVAILABILITY_LOOKAHEAD_DAYS days, so a window whose first date is further out is stored
 * but not bookable until then.
 * @returns {{ status: 'visible' } | { status: 'later', opensOn: string, firstDate: string } | { status: 'none' }}
 *   `none` = the date range contains no matching weekday on or after today.
 */
export function availabilityBookingOpensOn({ weekday, start_date, end_date }, today, lookaheadDays = AVAILABILITY_LOOKAHEAD_DAYS) {
  const from = start_date && start_date > today ? start_date : today;
  const fromDay = new Date(ymdToUtcMs(from)).getUTCDay();
  const firstDate = addDaysYmd(from, (Number(weekday) - fromDay + 7) % 7);
  if (end_date && firstDate > end_date) return { status: 'none' };
  const opensOn = addDaysYmd(firstDate, -(lookaheadDays - 1));
  if (opensOn <= today) return { status: 'visible' };
  return { status: 'later', opensOn, firstDate };
}

/** Coach-facing note for a window, or null when students can already book it. */
export function availabilityVisibilityNote(window, today) {
  const v = availabilityBookingOpensOn(window, today);
  if (v.status === 'none') {
    return `This date range doesn’t include a ${weekdayLabel(window.weekday)} from today on, so students won’t see any times.`;
  }
  if (v.status === 'later') {
    return `Students can book these times starting ${formatYmdLong(v.opensOn)} (bookings open ${AVAILABILITY_LOOKAHEAD_DAYS} days ahead; first lesson day ${formatYmdLong(v.firstDate)}).`;
  }
  return null;
}

const FORM_FIELDS = new Set(['weekday', 'start_time', 'end_time', 'start_date', 'end_date']);

/** Splits an API error into per-field messages and a general message. */
export function availabilityApiErrors(err) {
  const details = Array.isArray(err?.details) ? err.details : [];
  const fields = {};
  for (const d of details) {
    const field = String(d?.field || '');
    if (FORM_FIELDS.has(field) && !fields[field]) fields[field] = d.message || 'Invalid value.';
  }
  const general = Object.keys(fields).length ? null : (err?.message || 'Could not save availability.');
  return { fields, general };
}

export function availabilityRowLabel(row) {
  const time = `${formatTimeOfDay12h(row.start_time)} – ${formatTimeOfDay12h(row.end_time)}`;
  if (!row.start_date && !row.end_date) return `${time} · every week`;
  if (row.start_date && row.end_date) return `${time} · ${formatYmdLong(row.start_date)} – ${formatYmdLong(row.end_date)}`;
  if (row.start_date) return `${time} · from ${formatYmdLong(row.start_date)}`;
  return `${time} · until ${formatYmdLong(row.end_date)}`;
}
