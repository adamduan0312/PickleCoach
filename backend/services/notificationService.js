import { Notification } from '../models/index.js';

export const createNotification = async (userId, type, channel, payload) => {
  return await Notification.create({
    user_id: userId,
    type,
    channel,
    payload,
    status: 'pending',
  });
};

export const sendNotification = async (notificationId) => {
  const notification = await Notification.findByPk(notificationId);
  if (!notification) {
    throw new Error('Notification not found');
  }

  // TODO: Implement actual notification sending logic (email, SMS, push)
  // For now, just mark as sent
  await notification.update({
    status: 'sent',
    sent_at: new Date(),
  });

  return notification;
};

export const sendBookingReminder = async (bookingId, hoursBefore = 48) => {
  // TODO: Implement booking reminder logic
  // This would typically be called by a scheduled job
};

/**
 * Send reminder notification for a booking
 * @param {Object} booking - Booking object with coach and primaryStudent
 * @param {string} reminderType - '48h', '24h', or '1h'
 */
export const sendReminderNotification = async (booking, reminderType) => {
  try {
    const hoursMap = {
      '48h': 48,
      '24h': 24,
      '1h': 1,
    };

    const hours = hoursMap[reminderType] || 48;

    // Send to student
    if (booking.primaryStudent) {
      await createNotification(
        booking.primary_student_id,
        `pre_lesson_${hours}h`,
        'email',
        {
          booking_id: booking.id,
          scheduled_at: booking.scheduled_at,
          coach_name: booking.coach?.full_name || 'Coach',
          reminder_type: reminderType,
        }
      );
    }

    // Send to coach
    if (booking.coach) {
      await createNotification(
        booking.coach_id,
        `pre_lesson_${hours}h`,
        'email',
        {
          booking_id: booking.id,
          scheduled_at: booking.scheduled_at,
          student_name: booking.primaryStudent?.full_name || 'Student',
          reminder_type: reminderType,
        }
      );
    }

    // TODO: Actually send email/SMS via SendGrid/Twilio
    // For now, notifications are created in the database
  } catch (error) {
    console.error('Error sending reminder notification:', error);
    throw error;
  }
};
