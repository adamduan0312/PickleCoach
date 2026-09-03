const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function detectLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

function partNumber(parts, type) {
  const found = parts.find((p) => p.type === type);
  return found ? Number(found.value) : 0;
}

/**
 * Interpret a wall-clock date+time in `timeZone` as a UTC Date.
 * ymd = '2026-08-20', hms = '09:00' or '09:00:00'
 */
export function zonedWallTimeToUtc(ymd, hms, timeZone) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const timeParts = String(hms).split(':').map(Number);
  const hh = timeParts[0] || 0;
  const mm = timeParts[1] || 0;
  const ss = timeParts[2] || 0;
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(utcGuess));
  let hour = partNumber(parts, 'hour');
  if (hour === 24) hour = 0;
  const asIfUtc = Date.UTC(
    partNumber(parts, 'year'),
    partNumber(parts, 'month') - 1,
    partNumber(parts, 'day'),
    hour,
    partNumber(parts, 'minute'),
    partNumber(parts, 'second'),
  );
  return new Date(utcGuess - (asIfUtc - utcGuess));
}

export function formatInZone(iso, timeZone, options = {}) {
  if (!iso) return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone || detectLocalTimezone(),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options,
  }).format(date);
}

export function formatTimeInZone(iso, timeZone) {
  if (!iso) return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone || detectLocalTimezone(),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDateInZone(iso, timeZone) {
  if (!iso) return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone || detectLocalTimezone(),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** Booking list cards — weekday + month + day, no year. */
export function formatListDateInZone(iso, timeZone) {
  if (!iso) return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone || detectLocalTimezone(),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** `Tue, Sep 8 · 10:00 AM` for list/scanning surfaces. */
export function formatListWhenInZone(iso, timeZone) {
  if (!iso) return '—';
  return `${formatListDateInZone(iso, timeZone)} · ${formatTimeInZone(iso, timeZone)}`;
}

/** Milliseconds until `iso`, or 0 if missing/past. */
export function remainingMsUntil(iso, now = new Date()) {
  if (!iso) return 0;
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, date.getTime() - now.getTime());
}

/** Compact remaining time until `iso` (`5h 12m`, `ended`). */
export function formatRemainingUntil(iso, now = new Date()) {
  const ms = remainingMsUntil(iso, now);
  if (ms <= 0) return 'ended';
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours >= 48) {
    const days = Math.round(hours / 24);
    return `${days}d`;
  }
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const h = hours % 24;
    return h ? `${days}d ${h}h` : `${days}d`;
  }
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function relativeFromNow(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return diff > 0 ? `in ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return diff > 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

function ymdInZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function weekdayInZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  });
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[formatter.format(date)] ?? date.getDay();
}

function parseHmsToMinutes(hms) {
  const [h, m, s] = String(hms).split(':').map(Number);
  return (h || 0) * 60 + (m || 0) + (s || 0) / 60;
}

function minutesToHms(total) {
  const h = Math.floor(total / 60);
  const m = Math.floor(total % 60);
  return `${pad2(h)}:${pad2(m)}:00`;
}

/**
 * How far ahead to generate bookable slots from coach availability windows.
 * Display limits (initial batch / "See more") live in the UI — this is not a
 * product cap on how far students may book.
 */
export const AVAILABILITY_LOOKAHEAD_DAYS = 60;

/** First batch of slots shown on the coach profile booking flow. */
export const AVAILABILITY_INITIAL_SLOT_COUNT = 30;

/** Extra slots revealed each time the student taps "See more times". */
export const AVAILABILITY_SLOT_PAGE_SIZE = 30;

/**
 * Build bookable UTC slots from recurring coach availability windows.
 * Availability times are interpreted in the coach's stored timezone.
 * Slots sooner than `minLeadHours` (default 2) are omitted so students cannot
 * request lessons the coach cannot accept in time.
 */
export function buildAvailabilitySlots({
  availabilities = [],
  durationMinutes = 60,
  coachTimezone = 'UTC',
  daysAhead = AVAILABILITY_LOOKAHEAD_DAYS,
  now = new Date(),
  minLeadHours = 2,
}) {
  const duration = Number(durationMinutes) || 60;
  const zone = coachTimezone || 'UTC';
  const leadMs = Math.max(0, Number(minLeadHours) || 0) * 60 * 60 * 1000;
  const earliest = now.getTime() + leadMs;
  const slots = [];
  const seen = new Set();

  for (let dayOffset = 0; dayOffset < daysAhead; dayOffset += 1) {
    const cursor = new Date(now.getTime() + dayOffset * 86400000);
    const ymd = ymdInZone(cursor, zone);
    const weekday = weekdayInZone(cursor, zone);

    for (const row of availabilities) {
      const rowWeekday = Number(row.weekday);
      if (rowWeekday !== weekday) continue;
      if (row.start_date && ymd < String(row.start_date).slice(0, 10)) continue;
      if (row.end_date && ymd > String(row.end_date).slice(0, 10)) continue;

      const startMin = parseHmsToMinutes(row.start_time);
      const endMin = parseHmsToMinutes(row.end_time);
      for (let t = startMin; t + duration <= endMin + 0.01; t += duration) {
        const utc = zonedWallTimeToUtc(ymd, minutesToHms(t), zone);
        if (utc.getTime() < earliest) continue;
        const iso = utc.toISOString();
        if (seen.has(iso)) continue;
        seen.add(iso);
        slots.push({
          scheduled_at: iso,
          weekday,
          weekday_label: WEEKDAYS[weekday],
        });
      }
    }
  }

  slots.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return slots;
}

/**
 * Group slots by calendar day in the viewer timezone for compact date → times UI.
 * @param {Array<{ scheduled_at: string }>} slots
 * @param {string} timeZone
 * @returns {Array<{ dateKey: string, dateLabel: string, slots: typeof slots }>}
 */
export function groupSlotsByDate(slots, timeZone) {
  const groups = [];
  const indexByKey = new Map();
  for (const slot of slots) {
    const dateKey = ymdInZone(new Date(slot.scheduled_at), timeZone);
    let group = indexByKey.get(dateKey);
    if (!group) {
      group = {
        dateKey,
        dateLabel: formatDateInZone(slot.scheduled_at, timeZone),
        slots: [],
      };
      indexByKey.set(dateKey, group);
      groups.push(group);
    }
    group.slots.push(slot);
  }
  return groups;
}

export { WEEKDAYS };
