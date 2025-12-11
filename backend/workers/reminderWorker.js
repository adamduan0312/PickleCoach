import { Booking, User } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as notificationService from '../services/notificationService.js';

/**
 * Send reminder notifications for upcoming bookings
 * Runs every minute
 */
export const sendReminderNotifications = async () => {
  const now = new Date();
  
  // 48 hours before
  const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const in48HoursEnd = new Date(in48Hours.getTime() + 60 * 1000); // 1 minute window
  
  // 24 hours before
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in24HoursEnd = new Date(in24Hours.getTime() + 60 * 1000);
  
  // 1 hour before
  const in1Hour = new Date(now.getTime() + 60 * 60 * 1000);
  const in1HourEnd = new Date(in1Hour.getTime() + 60 * 1000);

  try {
    // Find bookings that need 48h reminders
    const bookings48h = await Booking.findAll({
      where: {
        status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
        scheduled_at: {
          [Op.between]: [in48Hours, in48HoursEnd],
        },
      },
      include: [
        { model: User, as: 'coach' },
        { model: User, as: 'primaryStudent' },
      ],
    });

    for (const booking of bookings48h) {
      await notificationService.sendReminderNotification(booking, '48h');
    }

    // Find bookings that need 24h reminders
    const bookings24h = await Booking.findAll({
      where: {
        status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
        scheduled_at: {
          [Op.between]: [in24Hours, in24HoursEnd],
        },
      },
      include: [
        { model: User, as: 'coach' },
        { model: User, as: 'primaryStudent' },
      ],
    });

    for (const booking of bookings24h) {
      await notificationService.sendReminderNotification(booking, '24h');
    }

    // Find bookings that need 1h reminders
    const bookings1h = await Booking.findAll({
      where: {
        status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
        scheduled_at: {
          [Op.between]: [in1Hour, in1HourEnd],
        },
      },
      include: [
        { model: User, as: 'coach' },
        { model: User, as: 'primaryStudent' },
      ],
    });

    for (const booking of bookings1h) {
      await notificationService.sendReminderNotification(booking, '1h');
    }

    logger.info(`Reminder worker processed: ${bookings48h.length} 48h, ${bookings24h.length} 24h, ${bookings1h.length} 1h reminders`);
  } catch (error) {
    logger.error('Error in reminder worker:', error);
    throw error;
  }
};

