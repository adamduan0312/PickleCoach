import { Notification, User } from '../models/index.js';
import { logger } from '../config/logger.js';

/**
 * Send email via SendGrid (if configured)
 */
const sendEmail = async (to, subject, htmlContent) => {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  
  if (!SENDGRID_API_KEY) {
    logger.warn('SendGrid API key not configured, skipping email send');
    return false;
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: process.env.SENDGRID_FROM_EMAIL || 'noreply@picklecoach.com' },
        subject,
        content: [{ type: 'text/html', value: htmlContent }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('SendGrid error:', error);
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error sending email via SendGrid:', error);
    return false;
  }
};

/**
 * Send SMS via Twilio (if configured)
 */
const sendSMS = async (to, message) => {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    logger.warn('Twilio credentials not configured, skipping SMS send');
    return false;
  }

  try {
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: TWILIO_PHONE_NUMBER,
          To: to,
          Body: message,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error('Twilio error:', error);
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error sending SMS via Twilio:', error);
    return false;
  }
};

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
  const notification = await Notification.findByPk(notificationId, {
    include: [{ model: User, as: 'user', attributes: ['email', 'phone'] }],
  });
  
  if (!notification) {
    throw new Error('Notification not found');
  }

  let sent = false;

  try {
    if (notification.channel === 'email' && notification.user?.email) {
      const subject = getEmailSubject(notification.type, notification.payload);
      const htmlContent = getEmailContent(notification.type, notification.payload);
      sent = await sendEmail(notification.user.email, subject, htmlContent);
    } else if (notification.channel === 'sms' && notification.user?.phone) {
      const message = getSMSContent(notification.type, notification.payload);
      sent = await sendSMS(notification.user.phone, message);
    } else if (notification.channel === 'push') {
      // Push notifications would be handled by FCM or similar
      // For now, mark as sent if channel is push
      sent = true;
    }

    await notification.update({
      status: sent ? 'sent' : 'failed',
      sent_at: sent ? new Date() : null,
      error_message: sent ? null : 'Failed to send notification',
    });

    return notification;
  } catch (error) {
    logger.error('Error sending notification:', error);
    await notification.update({
      status: 'failed',
      error_message: error.message,
    });
    throw error;
  }
};

/**
 * Get email subject based on notification type
 */
const getEmailSubject = (type, payload) => {
  const subjects = {
    'pre_lesson_48h': 'Reminder: Your Pickleball Lesson in 48 Hours',
    'pre_lesson_24h': 'Reminder: Your Pickleball Lesson Tomorrow',
    'pre_lesson_1h': 'Reminder: Your Pickleball Lesson in 1 Hour',
    'booking_confirmed': 'Booking Confirmed',
    'booking_cancelled': 'Booking Cancelled',
    'payment_received': 'Payment Received',
    'payout_processed': 'Payout Processed',
  };
  return subjects[type] || 'Notification from PickleCoach';
};

/**
 * Get email content based on notification type
 */
const getEmailContent = (type, payload) => {
  const scheduledAt = payload?.scheduled_at ? new Date(payload.scheduled_at).toLocaleString() : 'N/A';
  
  const templates = {
    'pre_lesson_48h': `
      <h2>Lesson Reminder</h2>
      <p>This is a reminder that you have a pickleball lesson scheduled for ${scheduledAt}.</p>
      <p>Coach: ${payload?.coach_name || 'Your coach'}</p>
      <p>See you soon!</p>
    `,
    'pre_lesson_24h': `
      <h2>Lesson Reminder - Tomorrow</h2>
      <p>Your pickleball lesson is scheduled for tomorrow at ${scheduledAt}.</p>
      <p>Coach: ${payload?.coach_name || 'Your coach'}</p>
      <p>Don't forget!</p>
    `,
    'pre_lesson_1h': `
      <h2>Lesson Starting Soon</h2>
      <p>Your pickleball lesson starts in 1 hour at ${scheduledAt}.</p>
      <p>Coach: ${payload?.coach_name || 'Your coach'}</p>
      <p>See you there!</p>
    `,
  };
  
  return templates[type] || `<p>You have a new notification from PickleCoach.</p>`;
};

/**
 * Get SMS content based on notification type
 */
const getSMSContent = (type, payload) => {
  const scheduledAt = payload?.scheduled_at ? new Date(payload.scheduled_at).toLocaleString() : 'N/A';
  
  const messages = {
    'pre_lesson_48h': `PickleCoach: Lesson reminder - ${scheduledAt} with ${payload?.coach_name || 'your coach'}`,
    'pre_lesson_24h': `PickleCoach: Lesson tomorrow at ${scheduledAt}`,
    'pre_lesson_1h': `PickleCoach: Lesson in 1 hour at ${scheduledAt}`,
  };
  
  return messages[type] || 'You have a new notification from PickleCoach.';
};

export const sendBookingReminder = async (bookingId, hoursBefore = 48) => {
  try {
    const { Booking } = await import('../models/index.js');
    
    const booking = await Booking.findByPk(bookingId, {
      include: [
        { model: (await import('../models/index.js')).User, as: 'coach', attributes: ['id', 'full_name', 'email'] },
        { model: (await import('../models/index.js')).User, as: 'primaryStudent', attributes: ['id', 'full_name', 'email'] },
      ],
    });

    if (!booking) {
      logger.warn(`Booking ${bookingId} not found for reminder`);
      return;
    }

    // Determine reminder type based on hours before
    let reminderType = '48h';
    if (hoursBefore <= 1) {
      reminderType = '1h';
    } else if (hoursBefore <= 24) {
      reminderType = '24h';
    }

    await sendReminderNotification(booking, reminderType);
  } catch (error) {
    logger.error(`Error sending booking reminder for booking ${bookingId}:`, error);
    throw error;
  }
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
      const studentNotification = await createNotification(
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
      
      // Actually send the email
      try {
        await sendNotification(studentNotification.id);
      } catch (error) {
        logger.error(`Failed to send reminder email to student ${booking.primary_student_id}:`, error);
      }
    }

    // Send to coach
    if (booking.coach) {
      const coachNotification = await createNotification(
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
      
      // Actually send the email
      try {
        await sendNotification(coachNotification.id);
      } catch (error) {
        logger.error(`Failed to send reminder email to coach ${booking.coach_id}:`, error);
      }
    }
  } catch (error) {
    console.error('Error sending reminder notification:', error);
    throw error;
  }
};
