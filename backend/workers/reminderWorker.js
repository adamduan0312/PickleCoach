import { Booking, User, Lesson, CourtLocation } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as notificationService from '../services/notificationService.js';

const reminderIncludes = [
  { model: User, as: 'coach', attributes: ['id', 'full_name', 'email', 'timezone'] },
  { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'email', 'timezone'] },
  { model: Lesson, as: 'lesson', attributes: ['id', 'title'] },
  {
    model: CourtLocation,
    as: 'courtLocation',
    attributes: ['id', 'name', 'address_line1', 'city', 'state', 'postal_code', 'country', 'is_private'],
  },
];

/**
 * Send reminder notifications for upcoming bookings.
 * MVP: 24h (in-app + email) and 1h (in-app only). Runs every minute.
 * Court comes from booking.court_location_id (the court chosen at checkout).
 */
export const sendReminderNotifications = async () => {
  const now = new Date();

  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in24HoursEnd = new Date(in24Hours.getTime() + 60 * 1000);

  const in1Hour = new Date(now.getTime() + 60 * 60 * 1000);
  const in1HourEnd = new Date(in1Hour.getTime() + 60 * 1000);

  try {
    const bookings24h = await Booking.findAll({
      where: {
        status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
        scheduled_at: {
          [Op.between]: [in24Hours, in24HoursEnd],
        },
      },
      include: reminderIncludes,
    });

    for (const booking of bookings24h) {
      await notificationService.sendReminderNotification(booking, '24h');
    }

    const bookings1h = await Booking.findAll({
      where: {
        status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
        scheduled_at: {
          [Op.between]: [in1Hour, in1HourEnd],
        },
      },
      include: reminderIncludes,
    });

    for (const booking of bookings1h) {
      await notificationService.sendReminderNotification(booking, '1h');
    }

    logger.info(`Reminder worker processed: ${bookings24h.length} 24h, ${bookings1h.length} 1h reminders`);
  } catch (error) {
    logger.error('Error in reminder worker:', error);
    throw error;
  }
};
