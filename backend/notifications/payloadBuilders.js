/**
 * In-app notification payload builders (presentation / UI contract).
 *
 * Every in-app payload should include:
 * - headline (required)
 * - summary (required)
 * - preview (optional)
 * - route (added by withNotificationRoute / createNotification)
 *
 * Extra fields (booking_id, coach_name, …) are optional metadata.
 */

import { formatDeclineReasonLabel } from '../utils/declineReasonCodes.js';

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

export const buildBookingConfirmedNotificationContent = (payload = {}) => {
  const coachName = payload.coach_name || 'your coach';
  const lessonTitle = payload.lesson_title || 'Lesson';
  const headline = 'Booking confirmed';
  const summary = `Your lesson with ${coachName} has been confirmed.`;
  return {
    headline,
    summary,
    preview: lessonTitle,
  };
};

export const buildBookingRequestCoachNotificationContent = (payload = {}) => {
  const studentName = payload.student_name || 'A student';
  const lessonTitle = payload.lesson_title || 'Lesson';
  const headline = 'New booking request';
  const summary = `${studentName} requested ${lessonTitle}.`;
  return {
    headline,
    summary,
    preview: lessonTitle,
  };
};

export const buildPreLessonReminderNotificationContent = (payload = {}) => {
  const reminderType = payload.reminder_type || '24h';
  const lessonTitle = payload.lesson_title || 'Lesson';
  const is1h = reminderType === '1h';
  const headline = is1h ? 'Lesson in 1 hour' : 'Lesson tomorrow';

  let summary;
  if (payload.audience === 'coach') {
    const studentName = payload.student_name || 'your student';
    summary = is1h
      ? `Your lesson with ${studentName} starts in 1 hour.`
      : `Your lesson with ${studentName} is tomorrow.`;
  } else {
    const coachName = payload.coach_name || 'your coach';
    summary = is1h
      ? `Your lesson with ${coachName} starts in 1 hour.`
      : `Your lesson with ${coachName} is tomorrow.`;
  }

  return {
    headline,
    summary,
    preview: lessonTitle,
  };
};

export const buildBookingDeclinedNotificationContent = (payload = {}) => {
  const reasonKey = payload.decline_reason_code;
  const reasonLabel = formatDeclineReasonLabel(reasonKey);
  const messageLine =
    payload.message_to_student != null && String(payload.message_to_student).trim()
      ? String(payload.message_to_student).trim()
      : null;

  // Bell copy stays short; detail lives in structured fields (reason_line, message_to_student).
  const headline = 'Coach declined your booking.';
  const reasonLine = reasonLabel ? `Reason: ${reasonLabel}` : null;

  return {
    headline,
    summary: headline,
    reason_line: reasonLine,
    message_to_student: messageLine,
  };
};

/**
 * Build human-readable cancellation notification copy.
 * Bell: short headline/summary. Detail: reason_line, reason_notes, refund_line (and raw metadata).
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

  return {
    headline,
    summary: headline,
    reason_line: reasonLine,
    reason_notes: notesLine,
    refund_line: refundLine,
  };
};

/**
 * Stripe revoked payout capability (failed verification, disputed identity, …).
 * Fired only on a stripe_ready true→false transition; the coach is already
 * hidden from the marketplace, this is the "here's how to fix it" message.
 */
export const buildStripePayoutsDisabledNotificationContent = () => ({
  headline: 'Payouts paused — action needed',
  summary: 'Stripe paused payouts for your account, so your profile is hidden from the marketplace. Reconnect Stripe to get relisted.',
  route: '/coach/onboarding',
});

/**
 * Stripe payout capability (re)enabled — covers both first-time onboarding
 * completion and recovery after a revocation. Fired only on false→true.
 */
export const buildStripePayoutsEnabledNotificationContent = () => ({
  headline: 'Payouts enabled',
  summary: 'Your Stripe account is ready — you can receive payouts and appear in the marketplace.',
  route: '/coach/onboarding',
});

/**
 * Preview + deep-link fields for the in-app notification bell.
 */
export const buildNewMessageNotificationPayload = ({
  message,
  booking,
  sender,
  conversationId,
} = {}) => {
  const rawText = message?.message_text != null ? String(message.message_text) : '';
  const preview = rawText.length > 140 ? `${rawText.slice(0, 137)}...` : rawText;
  const senderName = sender?.full_name || 'Someone';

  return {
    headline: `${senderName} sent you a message`,
    preview,
    summary: preview ? `${senderName}: ${preview}` : `${senderName} sent you a message`,
    message_id: message?.id ?? null,
    conversation_id: conversationId ?? message?.conversation_id ?? null,
    booking_id: booking?.id ?? null,
    sender_id: sender?.id ?? message?.sender_id ?? null,
    sender_name: senderName,
  };
};
