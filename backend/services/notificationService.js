/**
 * Notification orchestration: create, send, channel decisions, feature notify* helpers.
 *
 * Presentation lives under ../notifications/:
 * - emailTemplates.js / smsTemplates.js — delivery copy
 * - payloadBuilders.js — in-app headline/summary/preview
 * - notificationRoutes.js — payload.route deep links
 */
import { Notification, User } from '../models/index.js';
import { logger } from '../config/logger.js';
import { withNotificationRoute } from '../notifications/notificationRoutes.js';
import { getEmailSubject, getEmailContent } from '../notifications/emailTemplates.js';
import { getSMSContent } from '../notifications/smsTemplates.js';
import {
  buildBookingConfirmedNotificationContent,
  buildBookingRequestCoachNotificationContent,
  buildPreLessonReminderNotificationContent,
  buildBookingDeclinedNotificationContent,
  buildBookingCancelledNotificationContent,
  buildNewMessageNotificationPayload,
} from '../notifications/payloadBuilders.js';

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
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
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
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: TWILIO_PHONE_NUMBER,
          To: to,
          Body: message,
        }),
      },
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

export const createNotification = async (userId, type, channel, payload, options = {}) => {
  // In-app: include payload.route at the call site when adding new types (see notifications/notificationRoutes.js).
  const { entity_type = null, entity_id = null } = options;
  return await Notification.create({
    user_id: userId,
    type,
    channel,
    entity_type,
    entity_id,
    payload: withNotificationRoute(type, payload || {}),
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
    } else if (notification.channel === 'in_app') {
      // Stored for in-app feed; no external provider
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
 * Deliver in-app notification always; email when the user has an email on file.
 */
const deliverDualChannel = async (userId, type, payload, { email } = {}) => {
  const inApp = await createNotification(userId, type, 'in_app', payload);
  try {
    await sendNotification(inApp.id);
  } catch (error) {
    logger.warn({ component: 'notification', event: 'in_app_send_failed', userId, type, message: error?.message });
  }

  if (email) {
    const emailNotif = await createNotification(userId, type, 'email', payload);
    try {
      await sendNotification(emailNotif.id);
    } catch (error) {
      logger.warn({ component: 'notification', event: 'email_send_failed', userId, type, message: error?.message });
    }
  }
};

/** MVP lesson reminders: email only at 24h; 1h is in-app only (avoids late, low-value emails). */
export function reminderIncludesEmail(reminderType) {
  return reminderType === '24h';
}

/**
 * Send reminder notification for a booking.
 * MVP: 24h → in-app + email; 1h → in-app only (student and coach).
 * @param {Object} booking - Booking object with coach and primaryStudent
 * @param {string} reminderType - '24h' or '1h'
 */
export const sendReminderNotification = async (booking, reminderType) => {
  try {
    const hoursMap = {
      '24h': 24,
      '1h': 1,
    };

    const hours = hoursMap[reminderType];
    if (!hours) {
      logger.warn({ component: 'notification', event: 'unknown_reminder_type', reminderType });
      return;
    }

    const includeEmail = reminderIncludesEmail(reminderType);

    if (booking.primaryStudent) {
      const studentBase = {
        booking_id: booking.id,
        scheduled_at: booking.scheduled_at,
        coach_name: booking.coach?.full_name || 'Coach',
        lesson_title: booking.lesson?.title,
        reminder_type: reminderType,
        audience: 'student',
      };
      await deliverDualChannel(
        booking.primary_student_id,
        `pre_lesson_${hours}h`,
        {
          ...studentBase,
          ...buildPreLessonReminderNotificationContent(studentBase),
        },
        { email: includeEmail ? booking.primaryStudent.email : undefined },
      );
    }

    if (booking.coach) {
      const coachBase = {
        booking_id: booking.id,
        scheduled_at: booking.scheduled_at,
        student_name: booking.primaryStudent?.full_name || 'Student',
        lesson_title: booking.lesson?.title,
        reminder_type: reminderType,
        audience: 'coach',
      };
      await deliverDualChannel(
        booking.coach_id,
        `pre_lesson_${hours}h`,
        {
          ...coachBase,
          ...buildPreLessonReminderNotificationContent(coachBase),
        },
        { email: includeEmail ? booking.coach.email : undefined },
      );
    }
  } catch (error) {
    logger.error('Error sending reminder notification:', error);
    throw error;
  }
};

/**
 * Notify coach when a student creates a pending booking (log + in-app + email when SendGrid is configured).
 */
export const notifyCoachNewBookingRequest = async (bookingId) => {
  const { Booking, User, Lesson } = await import('../models/index.js');

  const booking = await Booking.findByPk(bookingId, {
    include: [
      { model: User, as: 'coach', attributes: ['id', 'full_name', 'email'] },
      { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'email'] },
      { model: Lesson, as: 'lesson', attributes: ['id', 'title'] },
    ],
  });

  if (!booking) {
    logger.warn({ component: 'booking', event: 'notify_coach_new_booking_missing', bookingId });
    return;
  }

  const basePayload = {
    booking_id: booking.id,
    scheduled_at: booking.scheduled_at,
    student_name: booking.primaryStudent?.full_name || 'A student',
    lesson_title: booking.lesson?.title || 'Lesson',
    coach_name: booking.coach?.full_name,
  };
  const payload = {
    ...basePayload,
    ...buildBookingRequestCoachNotificationContent(basePayload),
  };

  logger.info({
    component: 'booking',
    event: 'new_booking_request_for_coach',
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: booking.primary_student_id,
    scheduled_at: booking.scheduled_at,
  });

  await deliverDualChannel(
    booking.coach_id,
    'booking_request_coach',
    payload,
    { email: booking.coach?.email },
  );
};

const loadBookingNotificationContext = async (bookingId) => {
  const { Booking, User, Lesson } = await import('../models/index.js');
  return Booking.findByPk(bookingId, {
    include: [
      { model: User, as: 'coach', attributes: ['id', 'full_name', 'email'] },
      { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'email'] },
      { model: Lesson, as: 'lesson', attributes: ['id', 'title'] },
    ],
  });
};

/** Notify student when coach accepts a pending booking. */
export const notifyBookingAccepted = async (bookingId) => {
  const booking = await loadBookingNotificationContext(bookingId);
  if (!booking?.primary_student_id) return;

  const basePayload = {
    booking_id: booking.id,
    scheduled_at: booking.scheduled_at,
    coach_name: booking.coach?.full_name || 'Your coach',
    lesson_title: booking.lesson?.title || 'Lesson',
  };
  const payload = {
    ...basePayload,
    ...buildBookingConfirmedNotificationContent(basePayload),
  };

  await deliverDualChannel(
    booking.primary_student_id,
    'booking_confirmed',
    payload,
    { email: booking.primaryStudent?.email },
  );
};

export const notifyBookingDeclined = async (bookingId) => {
  const booking = await loadBookingNotificationContext(bookingId);
  if (!booking?.primary_student_id) return;

  const basePayload = {
    booking_id: booking.id,
    scheduled_at: booking.scheduled_at,
    coach_name: booking.coach?.full_name || 'Your coach',
    lesson_title: booking.lesson?.title || 'Lesson',
    decline_reason_code: booking.decline_reason_code || null,
    message_to_student: booking.decline_message_to_student || null,
  };

  const payload = {
    ...basePayload,
    ...buildBookingDeclinedNotificationContent(basePayload),
  };

  await deliverDualChannel(
    booking.primary_student_id,
    'booking_declined',
    payload,
    { email: booking.primaryStudent?.email },
  );
};

export const notifyBookingCancelled = async (bookingId, {
  cancelledBy,
  reason,
  reason_notes,
  refund_amount,
  penalty_amount,
  refund_status,
} = {}) => {
  const booking = await loadBookingNotificationContext(bookingId);
  if (!booking) return;

  const payload = {
    booking_id: booking.id,
    scheduled_at: booking.scheduled_at,
    lesson_title: booking.lesson?.title || 'Lesson',
    coach_name: booking.coach?.full_name,
    student_name: booking.primaryStudent?.full_name,
    cancelled_by: cancelledBy || booking.cancelled_by,
    reason: reason || null,
    reason_notes: reason_notes || null,
    refund_amount: refund_amount ?? null,
    penalty_amount: penalty_amount ?? null,
    refund_status: refund_status ?? null,
    ...buildBookingCancelledNotificationContent({
      cancelled_by: cancelledBy || booking.cancelled_by,
      reason,
      reason_notes,
      refund_amount,
      refund_status,
    }),
  };

  const by = cancelledBy || booking.cancelled_by;
  if (by === 'coach' || by === 'admin' || by === 'system') {
    if (booking.primary_student_id) {
      await deliverDualChannel(
        booking.primary_student_id,
        'booking_cancelled',
        payload,
        { email: booking.primaryStudent?.email },
      );
    }
    return;
  }

  if (by === 'student' && booking.coach_id) {
    await deliverDualChannel(
      booking.coach_id,
      'booking_cancelled',
      payload,
      { email: booking.coach?.email },
    );
  }
};

/**
 * Other booking participant who should receive a new-message ping (in-app only).
 * @returns {number|null}
 */
export const resolveMessageNotificationRecipient = (booking, senderId) => {
  if (!booking || senderId == null) return null;
  const coachId = booking.coach_id;
  const studentId = booking.primary_student_id;
  if (senderId === coachId && studentId != null && studentId !== coachId) return studentId;
  if (senderId === studentId && coachId != null && coachId !== studentId) return coachId;
  return null;
};

/**
 * In-app only: notify the other booking participant that a new chat message arrived.
 * No email/SMS — chat volume would be noisy; the frontend can poll GET /notifications.
 */
export const notifyNewMessage = async ({ booking, message, sender, conversationId } = {}) => {
  const recipientId = resolveMessageNotificationRecipient(booking, sender?.id ?? message?.sender_id);
  if (!recipientId) return null;

  const notification = await createNotification(
    recipientId,
    'new_message',
    'in_app',
    buildNewMessageNotificationPayload({
      message,
      booking,
      sender,
      conversationId,
    }),
    {
      entity_type: 'message',
      entity_id: message?.id ?? null,
    },
  );

  try {
    await sendNotification(notification.id);
  } catch (error) {
    logger.warn({
      component: 'notification',
      event: 'new_message_in_app_send_failed',
      recipientId,
      messageId: message?.id,
      message: error?.message,
    });
  }

  return notification;
};
