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
 * @returns {string} e.g. "6:00 PM"
 */
export function formatLessonTimeForEmail(scheduledAt, timeZone = DEFAULT_TZ) {
  if (!scheduledAt) return 'N/A';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TZ,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(scheduledAt));
  } catch {
    return new Date(scheduledAt).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
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

  return {
    lesson_title: booking.lesson?.title || 'Lesson',
    lesson_date: formatLessonDateForEmail(booking.scheduled_at, tz),
    lesson_time: formatLessonTimeForEmail(booking.scheduled_at, tz),
    court_name: serialized?.name || null,
    court_address: formatReminderCourtAddress(serialized),
    court_is_private: serialized ? Boolean(serialized.is_private) : null,
    court_address_revealed: Boolean(serialized?.address_line1),
    timezone: tz,
  };
}
