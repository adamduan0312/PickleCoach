import { Booking, Lesson, BookingPlayer, RescheduleHistory, CoachAvailability, sequelize } from '../models/index.js';
import { Op } from 'sequelize';

/**
 * Check if coach is available at the requested time slot
 * Validates against CoachAvailability records (coach-maintained availability)
 */
export const checkCoachAvailability = async (coachId, scheduledAt, durationMinutes) => {
  const scheduledDate = new Date(scheduledAt);
  const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);
  
  // Get weekday (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const weekday = scheduledDate.getDay();
  
  // Get time portion as HH:MM:SS string for comparison
  const scheduledTimeStr = scheduledDate.toTimeString().slice(0, 8); // HH:MM:SS
  const endTimeStr = endTime.toTimeString().slice(0, 8);

  // Find all availability records for this coach that are active
  const availabilities = await CoachAvailability.findAll({
    where: {
      coach_id: coachId,
      is_available: true,
      weekday: weekday,
    },
  });

  if (availabilities.length === 0) {
    return { available: false, reason: 'Coach is not available on this day' };
  }

  // Check if any availability window covers the requested time slot
  for (const availability of availabilities) {
    // Check date range if specified
    if (availability.start_date) {
      const startDate = new Date(availability.start_date);
      startDate.setHours(0, 0, 0, 0);
      if (scheduledDate < startDate) {
        continue; // Scheduled date is before availability start
      }
    }
    
    if (availability.end_date) {
      const endDate = new Date(availability.end_date);
      endDate.setHours(23, 59, 59, 999);
      if (scheduledDate > endDate) {
        continue; // Scheduled date is after availability end
      }
    }

    // Check datetime window if specified
    if (availability.start_datetime && availability.end_datetime) {
      const availabilityStart = new Date(availability.start_datetime);
      const availabilityEnd = new Date(availability.end_datetime);
      
      // Check if the entire booking slot (start to end) falls within availability window
      // Booking starts at or after availability start datetime
      // Booking ends at or before availability end datetime
      if (scheduledDate >= availabilityStart && endTime <= availabilityEnd) {
        return { available: true };
      }
    } else if (!availability.start_datetime && !availability.end_datetime) {
      // No datetime restrictions, available all day (if weekday matches)
      return { available: true };
    }
  }

  return { available: false, reason: 'Coach is not available during this time slot' };
};

export const checkBookingAvailability = async (lessonId, scheduledAt, durationMinutes) => {
  const lesson = await Lesson.findByPk(lessonId);
  if (!lesson || !lesson.is_active) {
    return { available: false, reason: 'Lesson not found or inactive' };
  }

  // Check coach availability first (coach-maintained availability)
  const coachAvailability = await checkCoachAvailability(lesson.coach_id, scheduledAt, durationMinutes);
  if (!coachAvailability.available) {
    return coachAvailability;
  }

  const scheduledDate = new Date(scheduledAt);
  const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

  // Check for overlapping bookings (prevent double-booking)
  const overlappingBookings = await Booking.findAll({
    where: {
      lesson_id: lessonId,
      status: { [Op.in]: ['pending', 'confirmed', 'awaiting_verification'] },
      scheduled_at: {
        [Op.lt]: endTime,
      },
      [Op.and]: [
        sequelize.literal(`DATE_ADD(scheduled_at, INTERVAL duration_minutes MINUTE) > '${scheduledDate.toISOString()}'`),
      ],
    },
  });

  if (overlappingBookings.length > 0) {
    return { available: false, reason: 'Time slot already booked' };
  }

  return { available: true };
};

export const calculateRescheduleDeadline = (scheduledAt, hoursBefore = 24) => {
  const scheduledDate = new Date(scheduledAt);
  return new Date(scheduledDate.getTime() - hoursBefore * 60 * 60 * 1000);
};

export const canReschedule = (booking) => {
  const now = new Date();
  const deadline = booking.reschedule_deadline || calculateRescheduleDeadline(booking.scheduled_at);
  
  if (now > deadline) {
    return { canReschedule: false, reason: 'Reschedule deadline has passed' };
  }

  const totalReschedules = booking.reschedule_count + booking.extra_paid_reschedules;
  const maxReschedules = booking.reschedule_limit + booking.extra_paid_reschedules;

  if (booking.reschedule_count >= booking.reschedule_limit && booking.extra_paid_reschedules === 0) {
    return { canReschedule: false, reason: 'Free reschedule limit reached', requiresPaid: true };
  }

  return { canReschedule: true };
};
