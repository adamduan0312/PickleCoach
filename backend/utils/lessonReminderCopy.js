/**
 * Shared copy helpers for pre-lesson reminders (email + payload enrichment).
 * Court comes from booking.court_location_id; exact address follows
 * courtAddressVisibility (private courts redact until confirmed / for privileged viewers).
 */

import {
  serializeCourtLocationForBooking,
  buildFullCourtAddress,
} from './courtAddressVisibility.js';

const DEFAULT_TZ = 'UTC';

/**
 * @param {string|Date} scheduledAt
 * @param {string} [timeZone]
 * @returns {string} e.g. "Wednesday, August 26"
 */
export function formatLessonDateForEmail(scheduledAt, timeZone = DEFAULT_TZ) {
  if (!scheduledAt) return 'N/A';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TZ,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date(scheduledAt));
  } catch {
    return new Date(scheduledAt).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }
}

/**
 * @param {string|Date} scheduledAt
 * @param {string} [timeZone]
 * @returns {string} e.g. "6:00 PM EDT"
 */
export function formatLessonTimeForEmail(scheduledAt, timeZone = DEFAULT_TZ) {
  if (!scheduledAt) return 'N/A';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TZ,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(scheduledAt));
  } catch {
    return new Date(scheduledAt).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }
}

/**
 * Single-line when label for emails / subjects.
 * @returns {string} e.g. "Friday, September 4 · 10:00 AM EDT"
 */
export function formatLessonWhenForEmail(scheduledAt, timeZone = DEFAULT_TZ) {
  const date = formatLessonDateForEmail(scheduledAt, timeZone);
  const time = formatLessonTimeForEmail(scheduledAt, timeZone);
  if (date === 'N/A' && time === 'N/A') return 'N/A';
  if (date === 'N/A') return time;
  if (time === 'N/A') return date;
  return `${date} · ${time}`;
}

/**
 * Deadline / respond-by label in the recipient's timezone.
 * @returns {string} e.g. "Tuesday, September 1 · 11:32 AM EDT"
 */
export function formatDeadlineLabelForEmail(deadlineAt, timeZone = DEFAULT_TZ) {
  if (!deadlineAt) return '';
  try {
    const date = new Date(deadlineAt);
    if (Number.isNaN(date.getTime())) return '';
    const weekdayMonthDay = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TZ,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(date);
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TZ,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date);
    return `${weekdayMonthDay} · ${time}`;
  } catch {
    return formatLessonWhenForEmail(deadlineAt, timeZone);
  }
}

/**
 * Address line for reminder email from a visibility-serialized court.
 * Revealed → "123 Main St, Fort Lauderdale, FL 33301"
 * Redacted private → area only "Fort Lauderdale, FL 33301"
 * @param {object|null} serializedCourt — from serializeCourtLocationForBooking
 * @returns {string|null}
 */
export function formatReminderCourtAddress(serializedCourt) {
  if (!serializedCourt) return null;
  return buildFullCourtAddress(serializedCourt) || serializedCourt.area || null;
}

/**
 * Fields shared by student/coach reminder payloads.
 * Uses booking.courtLocation + booking.status with the same reveal rules as booking DTOs.
 *
 * @param {object} booking
 * @param {string} [viewerTimezone]
 * @param {{ audience?: 'student'|'coach' }} [opts]
 *   coach → privileged (always exact address); student → status-gated for private courts
 */
export function buildLessonReminderDetailFields(booking, viewerTimezone, opts = {}) {
  const court = booking.courtLocation || booking.court_location || null;
  const tz = viewerTimezone || DEFAULT_TZ;
  const audience = opts.audience || 'student';
  const serialized = serializeCourtLocationForBooking(court, {
    bookingStatus: booking.status ?? null,
    viewerIsPrivileged: audience === 'coach',
  });

  const lesson_date = formatLessonDateForEmail(booking.scheduled_at, tz);
  const lesson_time = formatLessonTimeForEmail(booking.scheduled_at, tz);
  const court_name = serialized?.name || null;
  const court_address = formatReminderCourtAddress(serialized);
  const area = serialized?.area || null;
  const locationParts = [area, court_name].filter((p) => p != null && String(p).trim() !== '');
  // Prefer "Area · Court"; fall back to address or court alone.
  let location_line = null;
  if (locationParts.length >= 2) {
    location_line = `${locationParts[0]} · ${locationParts[1]}`;
  } else if (locationParts.length === 1) {
    location_line = locationParts[0];
  } else if (court_address) {
    location_line = court_address;
  }

  return {
    lesson_title: booking.lesson?.title || 'Lesson',
    lesson_date,
    lesson_time,
    lesson_when: formatLessonWhenForEmail(booking.scheduled_at, tz),
    court_name,
    court_address,
    location_line,
    court_is_private: serialized ? Boolean(serialized.is_private) : null,
    court_address_revealed: Boolean(serialized?.address_line1),
    timezone: tz,
  };
}
