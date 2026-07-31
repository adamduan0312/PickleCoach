import { Booking, Lesson, CoachAvailability, User, sequelize } from '../models/index.js';
import { Op } from 'sequelize';
import { calendarDateInTimezone, toYmdApi } from '../utils/dateOnly.js';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Get weekday (0-6) for a date in a given IANA timezone (e.g. 'America/Los_Angeles').
 * Uses coach timezone so "Monday" means Monday in the coach's locale.
 */
function getWeekdayInTimezone(date, timezone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const dayStr = formatter.format(date); // 'Mon', 'Tue', ...
  const shortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const idx = shortNames.indexOf(dayStr);
  return idx >= 0 ? idx : new Date(date).getUTCDay();
}

/**
 * Check if coach is available at the requested time slot
 * Validates against CoachAvailability records (coach-maintained availability)
 * Weekday is evaluated in the coach's timezone so "available Mondays" matches the coach's local Monday.
 */
export const checkCoachAvailability = async (coachId, scheduledAt, durationMinutes) => {
  const scheduledDate = new Date(scheduledAt);
  const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

  const coach = await User.findByPk(coachId, { attributes: ['timezone'] });
  const coachTimezone = (coach && coach.timezone) || 'UTC';
  const weekday = getWeekdayInTimezone(scheduledDate, coachTimezone);

  // Find all availability records for this coach that are active for this weekday
  const availabilities = await CoachAvailability.findAll({
    where: {
      coach_id: coachId,
      weekday,
    },
  });

  if (availabilities.length === 0) {
    const coachAvailRows = await CoachAvailability.findAll({
      where: { coach_id: coachId },
      attributes: ['weekday'],
      raw: true,
    });
    const availableWeekdays = [...new Set((coachAvailRows || []).map((r) => r.weekday).filter((w) => w != null))];
    const requestedDayName = WEEKDAY_NAMES[weekday] || 'unknown';
    const availableDayNames = availableWeekdays.map((w) => WEEKDAY_NAMES[w]).filter(Boolean);
    const reason = availableDayNames.length
      ? `Coach is not available on this day (requested: ${requestedDayName} in coach timezone; coach availability: ${availableDayNames.join(', ')})`
      : 'Coach has no availability defined';
    return { available: false, reason };
  }

  // Get time-of-day "HH:mm:ss" in coach timezone for a Date (formatToParts ensures 2-digit)
  const toTimeStringInTz = (date) => {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: coachTimezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const parts = formatter.formatToParts(date);
    const h = parts.find((p) => p.type === 'hour')?.value?.padStart(2, '0') ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value?.padStart(2, '0') ?? '00';
    const s = parts.find((p) => p.type === 'second')?.value?.padStart(2, '0') ?? '00';
    return `${h}:${m}:${s}`;
  };
  const normalizeTime = (t) => (t && t.length === 5 ? `${t}:00` : t || '00:00:00'); // "09:00" -> "09:00:00"

  // Check if any availability window covers the requested time slot
  for (const availability of availabilities) {
    // DATEONLY range: compare calendar day in coach timezone to stored YYYY-MM-DD (no local Date parsing).
    const calYmd = calendarDateInTimezone(scheduledDate, coachTimezone);
    const slotStart = toYmdApi(availability.start_date);
    if (slotStart && calYmd < slotStart) {
      continue;
    }
    const slotEnd = toYmdApi(availability.end_date);
    if (slotEnd && calYmd > slotEnd) {
      continue;
    }

    if (availability.start_time && availability.end_time) {
      const startBound = normalizeTime(availability.start_time);
      const endBound = normalizeTime(availability.end_time);
      const scheduledStartStr = toTimeStringInTz(scheduledDate);
      const scheduledEndStr = toTimeStringInTz(endTime);
      if (scheduledStartStr >= startBound && scheduledEndStr <= endBound) {
        return { available: true };
      }
      continue;
    }

    // Weekday + date range matched; no time window → all day
    return { available: true };
  }

  return { available: false, reason: 'Coach is not available during this time slot' };
};

/**
 * @param {number} lessonId
 * @param {string|Date} scheduledAt
 * @param {number} durationMinutes
 * @param {{ transaction?: import('sequelize').Transaction, coachId?: number }} [options]
 *   When `transaction` is set (e.g. confirm under coach-profile lock), overlap queries
 *   participate in that transaction so concurrent confirms serialize correctly.
 */
export const checkBookingAvailability = async (lessonId, scheduledAt, durationMinutes, options = {}) => {
  const { transaction = null, coachId: coachIdOpt = null } = options;
  const findOpts = transaction ? { transaction } : {};

  const lesson = await Lesson.findByPk(lessonId, findOpts);
  if (!lesson || !lesson.is_active) {
    return { available: false, reason: 'Lesson not found or inactive' };
  }

  const coachId = coachIdOpt != null ? coachIdOpt : lesson.coach_id;

  // Check coach availability first (coach-maintained availability)
  const coachAvailability = await checkCoachAvailability(coachId, scheduledAt, durationMinutes);
  if (!coachAvailability.available) {
    return coachAvailability;
  }

  const scheduledDate = new Date(scheduledAt);
  const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

  // Overlap by coach (not just lesson): one coach cannot hold two concurrent slots.
  const overlappingBookings = await Booking.findAll({
    where: {
      coach_id: coachId,
      status: { [Op.in]: ['pending', 'confirmed', 'awaiting_verification'] },
      scheduled_at: {
        [Op.lt]: endTime,
      },
      [Op.and]: [
        sequelize.literal(`DATE_ADD(scheduled_at, INTERVAL duration_minutes MINUTE) > '${scheduledDate.toISOString()}'`),
      ],
    },
    ...findOpts,
  });

  if (overlappingBookings.length > 0) {
    return { available: false, reason: 'This time slot is no longer available.' };
  }

  return { available: true };
};
