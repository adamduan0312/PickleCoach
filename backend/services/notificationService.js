import { Notification, User } from '../models/index.js';
import { logger } from '../config/logger.js';
import { formatDeclineReasonLabel } from '../utils/declineReasonCodes.js';

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
 * Get email subject based on notification type
 */
const getEmailSubject = (type, payload) => {
  const subjects = {
    'pre_lesson_48h': 'Reminder: Your Pickleball Lesson in 48 Hours',
    'pre_lesson_24h': 'Reminder: Your Pickleball Lesson Tomorrow',
    'pre_lesson_1h': 'Reminder: Your Pickleball Lesson in 1 Hour',
    'booking_confirmed': 'Booking Confirmed',
    'booking_declined': 'Booking Declined',
    'booking_cancelled': 'Booking Cancelled',
    'payment_received': 'Payment Received',
    'payout_processed': 'Payout Processed',
    'password_reset': 'Reset Your PickleCoach Password',
    'email_verification': 'Verify Your PickleCoach Email',
    'email_change_confirm': 'Confirm Your New PickleCoach Email',
    'email_changed_notification': 'Your PickleCoach Email Was Changed',
    booking_request_coach: 'New booking request — PickleCoach',
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
    booking_confirmed: `
      <h2>Booking Confirmed</h2>
      <p>Your lesson with <strong>${payload?.coach_name || 'your coach'}</strong> is confirmed.</p>
      <p><strong>${payload?.lesson_title || 'Lesson'}</strong> — ${scheduledAt}</p>
      <p>Booking ID: ${payload?.booking_id ?? ''}</p>
    `,
    booking_declined: `
      <h2>Booking Declined</h2>
      <p>${payload?.headline || 'Coach declined your booking.'}</p>
      <p><strong>${payload?.lesson_title || 'your lesson'}</strong> — ${scheduledAt}</p>
      ${payload?.reason_line ? `<p><strong>${payload.reason_line}</strong></p>` : ''}
      ${payload?.message_to_student ? `<p><strong>Message:</strong><br>${payload.message_to_student}</p>` : ''}
      <p>You can book another available slot in PickleCoach.</p>
    `,
    booking_cancelled: `
      <h2>Booking Cancelled</h2>
      <p>${payload?.headline || `The lesson <strong>${payload?.lesson_title || 'Lesson'}</strong> scheduled for ${scheduledAt} was cancelled.`}</p>
      ${payload?.reason_line ? `<p><strong>${payload.reason_line}</strong></p>` : ''}
      ${payload?.reason_notes ? `<p>${payload.reason_notes}</p>` : ''}
      ${payload?.refund_line ? `<p>${payload.refund_line}</p>` : ''}
      <p>Booking ID: ${payload?.booking_id ?? ''}</p>
    `,
    'password_reset': `
      <h2>Reset Your Password</h2>
      <p>You requested to reset your password for your PickleCoach account.</p>
      <p>Click the link below to reset your password (expires in ${payload?.expires_in || '1 hour'}):</p>
      <p><a href="${payload?.reset_url || '#'}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${payload?.reset_url || ''}</p>
      <p>If you didn't request this, please ignore this email.</p>
      <p><small>This link will expire in ${payload?.expires_in || '1 hour'}.</small></p>
    `,
    'email_verification': `
      <h2>Verify Your Email</h2>
      <p>Thanks for creating a PickleCoach account.</p>
      <p>Click the link below to verify your email address (expires in ${payload?.expires_in || '24 hours'}):</p>
      <p><a href="${payload?.verify_url || '#'}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${payload?.verify_url || ''}</p>
      <p>If you didn't create this account, you can ignore this email.</p>
    `,
    'email_change_confirm': `
      <h2>Confirm Your New Email</h2>
      <p>You requested to change the email address on your PickleCoach account to <strong>${payload?.new_email || ''}</strong>.</p>
      <p>Click the link below to confirm this change (expires in ${payload?.expires_in || '24 hours'}):</p>
      <p><a href="${payload?.confirm_url || '#'}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Confirm Email Change</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${payload?.confirm_url || ''}</p>
      <p>If you did not request this change, you can ignore this email.</p>
    `,
    'email_changed_notification': `
      <h2>Your Email Address Was Changed</h2>
      <p>The email address on your PickleCoach account was changed from <strong>${payload?.old_email || ''}</strong> to <strong>${payload?.new_email || ''}</strong>.</p>
      <p>If you made this change, no further action is needed.</p>
      <p>If you did <strong>not</strong> make this change, please contact support immediately.</p>
    `,
    booking_request_coach: `
      <h2>You have a new booking request</h2>
      <p><strong>${payload?.student_name || 'A student'}</strong> requested a lesson: <strong>${payload?.lesson_title || 'Lesson'}</strong>.</p>
      <p>Scheduled: ${scheduledAt}</p>
      <p>Booking ID: ${payload?.booking_id ?? ''}</p>
      <p>Please open PickleCoach and accept or decline this request before it expires.</p>
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
    booking_confirmed: `PickleCoach: Booking confirmed — ${payload?.lesson_title || 'lesson'} with ${payload?.coach_name || 'your coach'} at ${scheduledAt}.`,
    booking_declined: [
      `PickleCoach: ${payload?.headline || 'Coach declined your booking.'}`,
      payload?.reason_line,
      payload?.message_to_student ? `Message: ${payload.message_to_student}` : 'Book another slot in the app.',
    ].filter(Boolean).join(' '),
    booking_cancelled: `PickleCoach: ${payload?.headline || `Booking cancelled — ${payload?.lesson_title || 'lesson'} at ${scheduledAt}.`}${payload?.reason_line ? ` ${payload.reason_line}.` : ''}`,
    booking_request_coach: `PickleCoach: New booking request from ${payload?.student_name || 'a student'} — ${payload?.lesson_title || 'lesson'} at ${scheduledAt}. Accept or decline in the app.`,
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

/**
 * Send reminder notification for a booking (email + in-app for student and coach).
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

    if (booking.primaryStudent) {
      const studentPayload = {
        booking_id: booking.id,
        scheduled_at: booking.scheduled_at,
        coach_name: booking.coach?.full_name || 'Coach',
        lesson_title: booking.lesson?.title,
        reminder_type: reminderType,
      };
      await deliverDualChannel(
        booking.primary_student_id,
        `pre_lesson_${hours}h`,
        studentPayload,
        { email: booking.primaryStudent.email },
      );
    }

    if (booking.coach) {
      const coachPayload = {
        booking_id: booking.id,
        scheduled_at: booking.scheduled_at,
        student_name: booking.primaryStudent?.full_name || 'Student',
        lesson_title: booking.lesson?.title,
        reminder_type: reminderType,
      };
      await deliverDualChannel(
        booking.coach_id,
        `pre_lesson_${hours}h`,
        coachPayload,
        { email: booking.coach.email },
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

  const payload = {
    booking_id: booking.id,
    scheduled_at: booking.scheduled_at,
    student_name: booking.primaryStudent?.full_name || 'A student',
    lesson_title: booking.lesson?.title || 'Lesson',
    coach_name: booking.coach?.full_name,
  };

  logger.info({
    component: 'booking',
    event: 'new_booking_request_for_coach',
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: booking.primary_student_id,
    scheduled_at: booking.scheduled_at,
  });

  const inApp = await createNotification(booking.coach_id, 'booking_request_coach', 'in_app', payload);
  try {
    await sendNotification(inApp.id);
  } catch (error) {
    logger.warn({
      component: 'booking',
      event: 'coach_new_booking_in_app_notify_failed',
      bookingId,
      message: error?.message,
    });
  }

  if (booking.coach?.email) {
    const emailNotif = await createNotification(booking.coach_id, 'booking_request_coach', 'email', payload);
    try {
      await sendNotification(emailNotif.id);
    } catch (error) {
      logger.warn({
        component: 'booking',
        event: 'coach_new_booking_email_failed',
        bookingId,
        message: error?.message,
      });
    }
  }
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

  const payload = {
    booking_id: booking.id,
    scheduled_at: booking.scheduled_at,
    coach_name: booking.coach?.full_name || 'Your coach',
    lesson_title: booking.lesson?.title || 'Lesson',
  };

  await deliverDualChannel(
    booking.primary_student_id,
    'booking_confirmed',
    payload,
    { email: booking.primaryStudent?.email },
  );
};

/** Notify student when coach declines a pending booking. */
export const buildBookingDeclinedNotificationContent = (payload = {}) => {
  const reasonKey = payload.decline_reason_code;
  const reasonLabel = formatDeclineReasonLabel(reasonKey);
  const messageLine =
    payload.message_to_student != null && String(payload.message_to_student).trim()
      ? String(payload.message_to_student).trim()
      : payload.decline_message != null && String(payload.decline_message).trim()
        ? String(payload.decline_message).trim()
        : null;

  const headline = 'Coach declined your booking.';
  const reasonLine = reasonLabel ? `Reason: ${reasonLabel}` : null;

  const summaryParts = [headline];
  if (reasonLine) summaryParts.push(reasonLine);
  if (messageLine) {
    summaryParts.push('Message:');
    summaryParts.push(messageLine);
  }

  return {
    headline,
    reason_line: reasonLine,
    message_to_student: messageLine,
    decline_message: messageLine,
    summary: summaryParts.join('\n'),
  };
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

/** Notify the other party when a booking is cancelled. */
export const CANCELLATION_REASON_LABELS = {
  weather: 'Weather',
  emergency: 'Emergency',
  sickness: 'Sickness',
  travel_delay: 'Travel delay',
  schedule_conflict: 'Schedule conflict',
  forgot: 'Forgot',
  other: 'Other',
};

const CANCELLED_BY_PHRASE = {
  student: 'the student',
  coach: 'the coach',
  admin: 'an administrator',
  system: 'the system',
};

/**
 * Build human-readable cancellation notification copy (in-app summary + email body fragments).
 */
export const buildBookingCancelledNotificationContent = (payload = {}) => {
  const byKey = payload.cancelled_by || payload.cancelledBy;
  const byPhrase = CANCELLED_BY_PHRASE[byKey] || byKey || 'the other party';
  const reasonKey = payload.reason;
  const reasonLabel = reasonKey ? (CANCELLATION_REASON_LABELS[reasonKey] || reasonKey) : null;

  const headline = `Your lesson was cancelled by ${byPhrase}.`;
  const reasonLine = reasonLabel ? `Reason: ${reasonLabel}` : null;
  const notesLine =
    payload.reason_notes && String(payload.reason_notes).trim()
      ? String(payload.reason_notes).trim()
      : null;

  let refundLine = null;
  const refundAmount = payload.refund_amount;
  if (refundAmount != null && Number(refundAmount) > 0) {
    refundLine = `Refund: $${Number(refundAmount).toFixed(2)}`;
    if (payload.refund_status === 'pending_stripe_execution') {
      refundLine += ' (processing)';
    }
  } else if (payload.refund_status === 'voided_authorization') {
    refundLine = 'Your payment authorization was released.';
  }

  const summaryParts = [headline];
  if (reasonLine) summaryParts.push(reasonLine);
  if (notesLine) summaryParts.push(notesLine);
  if (refundLine) summaryParts.push(refundLine);

  return {
    headline,
    reason_line: reasonLine,
    reason_notes: notesLine,
    refund_line: refundLine,
    summary: summaryParts.join('\n'),
  };
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
