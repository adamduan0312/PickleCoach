/**
 * Coach weekly availability windows: calendar-date rules and conflict copy.
 * Dates are plain YYYY-MM-DD calendar days in the coach's timezone.
 */

/** How far ahead a window's start/end date may be set. Open-ended windows (no end date) stay allowed. */
export const AVAILABILITY_MAX_MONTHS_AHEAD = 24;

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** True for a real calendar day (rejects 2026-13-45, 2026-02-30, 2025-02-29). */
export function isRealCalendarDate(ymd) {
  if (typeof ymd !== 'string') return false;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= daysInMonth;
}

/** Adds calendar months, clamping to the last day of the target month (Jan 31 + 1 → Feb 28/29). */
export function addMonthsYmd(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const totalMonths = (m - 1) + months;
  const ty = y + Math.floor(totalMonths / 12);
  const tm = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

/** "2027-03-04" → "Mar 4, 2027" (calendar day, no timezone shift). */
export function formatYmdLong(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Date rules that depend on "today" in the coach's timezone (format/order are checked by Joi).
 * @param {{ start_date: string | null, end_date: string | null }} dates
 * @param {{ today: string }} ctx today as YYYY-MM-DD in the coach's timezone
 * @returns {{ ok: true } | { ok: false, field: string, message: string }}
 */
export function validateAvailabilityDates({ start_date, end_date }, { today }) {
  if (end_date && end_date < today) {
    return {
      ok: false,
      field: 'end_date',
      message: `End date ${formatYmdLong(end_date)} has already passed. Choose today or a later date, or leave it blank.`,
    };
  }
  const latest = addMonthsYmd(today, AVAILABILITY_MAX_MONTHS_AHEAD);
  for (const [field, value, label] of [['start_date', start_date, 'Start date'], ['end_date', end_date, 'End date']]) {
    if (value && value > latest) {
      return {
        ok: false,
        field,
        message: `${label} can be at most ${AVAILABILITY_MAX_MONTHS_AHEAD} months ahead (latest ${formatYmdLong(latest)}).`,
      };
    }
  }
  return { ok: true };
}

/** "09:00:00" → "9:00 AM", "12:30" → "12:30 PM", "00:00" → "12:00 AM". */
export function formatTimeOfDay12h(hms) {
  const [hRaw, mRaw] = String(hms).split(':');
  const h = Number(hRaw);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(Number(mRaw) || 0).padStart(2, '0')} ${suffix}`;
}

function hmsKey(t) {
  const [h = '0', m = '0', s = '0'] = String(t).split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
}

function rangeLabel(start, end) {
  return `${formatTimeOfDay12h(start)}–${formatTimeOfDay12h(end)}`;
}

function dateRangeSuffix(startDate, endDate) {
  if (!startDate && !endDate) return '';
  if (startDate && endDate) return ` (${formatYmdLong(startDate)} – ${formatYmdLong(endDate)})`;
  if (startDate) return ` (from ${formatYmdLong(startDate)})`;
  return ` (until ${formatYmdLong(endDate)})`;
}

/**
 * Explains an overlap with one existing window and the two explicit fixes (no auto-merge):
 * extend the existing window, or add only the uncovered part(s).
 * @param {{ weekday: number, existing: { start_time: string, end_time: string, start_date?: string | null, end_date?: string | null }, requested: { start_time: string, end_time: string } }} args
 */
export function availabilityConflictMessage({ weekday, existing, requested }) {
  const es = hmsKey(existing.start_time);
  const ee = hmsKey(existing.end_time);
  const rs = hmsKey(requested.start_time);
  const re = hmsKey(requested.end_time);
  const windowLabel = `your ${WEEKDAY_LABELS[weekday] || 'weekly'} ${rangeLabel(es, ee)} window${dateRangeSuffix(existing.start_date, existing.end_date)}`;

  const uncovered = [];
  if (rs < es) uncovered.push(rangeLabel(rs, es));
  if (re > ee) uncovered.push(rangeLabel(ee, re));
  if (uncovered.length === 0) {
    return `This time is already covered by ${windowLabel}.`;
  }

  const merged = rangeLabel(rs < es ? rs : es, re > ee ? re : ee);
  return `This overlaps ${windowLabel}. Edit that window to ${merged}, or add ${uncovered.join(' and ')} instead.`;
}
