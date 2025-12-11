import { Booking, Lesson, BookingPlayer, RescheduleHistory, sequelize } from '../models/index.js';
import { Op } from 'sequelize';

export const checkBookingAvailability = async (lessonId, scheduledAt, durationMinutes) => {
  const lesson = await Lesson.findByPk(lessonId);
  if (!lesson || !lesson.is_active) {
    return { available: false, reason: 'Lesson not found or inactive' };
  }

  const scheduledDate = new Date(scheduledAt);
  const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

  // Check for overlapping bookings
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
