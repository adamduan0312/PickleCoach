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
  const deadlineLabel = payload.coach_acceptance_deadline_label;
  const headline = deadlineLabel
    ? `Booking request — respond by ${deadlineLabel}`
    : 'New booking request';
  const summary = deadlineLabel
    ? `${studentName} requested ${lessonTitle}. Please accept or decline by ${deadlineLabel}.`
    : `New booking request from ${studentName}. Open PickleCoach to accept or decline.`;
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

  if (payload.court_name) {
    summary = `${summary} ${payload.court_name}.`;
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

/** Student: coach never accepted/declined; pending booking expired and auth voided. */
export const buildBookingRequestExpiredNotificationContent = () => ({
  headline: 'Booking request expired',
  summary:
    'Your coach did not respond in time, so this booking request expired. Your payment authorization was released — you were not charged.',
});

/** Coach: student left a review on a completed lesson. */
export const buildReviewReceivedNotificationContent = ({ rating, studentName } = {}) => {
  const stars = rating != null && Number.isFinite(Number(rating)) ? Number(rating) : null;
  const from = studentName || 'A student';
  const headline = 'New review received';
  const summary =
    stars != null
      ? `${from} left a ${stars}-star review on your lesson.`
      : `${from} left a review on your lesson.`;
  return { headline, summary, preview: stars != null ? `${stars}★` : undefined };
};

/** Student: Stripe confirmed a refund on the original charge. */
export const buildRefundSucceededNotificationContent = ({ refundAmount } = {}) => {
  const amount = refundAmount != null && Number(refundAmount) > 0
    ? Number(refundAmount).toFixed(2)
    : null;
  return {
    headline: 'Refund completed',
    summary: amount
      ? `Your refund of $${amount} has been completed. It may take a few business days to appear on your statement.`
      : 'Your refund has been completed. It may take a few business days to appear on your statement.',
  };
};

export const DISPUTE_TYPE_LABELS = {
  coach_no_show_claim: 'coach no-show',
  student_no_show_claim: 'student no-show',
  misconduct: 'misconduct',
  lesson_not_completed: 'lesson not completed',
  other: 'other',
};

/** Student recipient when the booking is marked `student_no_show`. */
/** Coach: lesson ended — confirm attendance or report student no-show (in-app only). */
export const buildConfirmAttendanceReminderNotificationContent = (payload = {}) => {
  const studentName = payload.student_name || 'your student';
  const lessonTitle = payload.lesson_title || 'Lesson';
  return {
    headline: 'Confirm attendance',
    summary: `Did the lesson with ${studentName} happen? Mark the lesson complete or report a student no-show.`,
    preview: lessonTitle,
  };
};

/** Student: coach marked the lesson complete (in-app only). */
export const buildLessonCompletedNotificationContent = (payload = {}) => {
  const coachName = payload.coach_name || 'your coach';
  const lessonTitle = payload.lesson_title || 'Lesson';
  return {
    headline: 'Lesson completed',
    summary: `Your lesson with ${coachName} was marked complete. You can now leave a review. Payment remains subject to the 24-hour review window.`,
    preview: lessonTitle,
  };
};

export const buildStudentNoShowNotificationContent = ({ markedBy } = {}) => {
  const headline = 'You were marked as a no-show';
  const summary =
    markedBy === 'admin'
      ? 'An administrator marked you as not attending this lesson. If this is incorrect, you have 24 hours after the lesson to dispute it.'
      : 'Your coach marked you as not attending this lesson. If this is incorrect, you have 24 hours after the lesson to dispute it.';
  return { headline, summary };
};

/** Student or coach recipient when the booking is marked `coach_no_show`. */
export const buildCoachNoShowNotificationContent = ({ audience } = {}) => {
  if (audience === 'coach') {
    return {
      headline: 'You were marked as a no-show',
      summary:
        'This lesson was recorded as a coach no-show. You will not receive a payout for this booking.',
    };
  }
  return {
    headline: 'Your coach was marked as a no-show',
    summary:
      'This lesson was recorded as a coach no-show. Your payment will be refunded after the 24-hour review period, unless a dispute is still open.',
  };
};

export const buildDisputeOpenedNotificationContent = ({ openedBy, disputeTypeCode } = {}) => {
  const typeLabel = DISPUTE_TYPE_LABELS[disputeTypeCode] || 'an issue';
  const who =
    openedBy === 'student' ? 'The student' : openedBy === 'coach' ? 'Your coach' : 'Support';
  return {
    headline: 'A dispute was opened',
    summary: `${who} opened a dispute on this booking (${typeLabel}). Payment is on hold until it is reviewed.`,
    preview: typeLabel,
  };
};

function attendanceDeterminationPhrase(status) {
  if (status === 'coach_no_show') return 'a coach no-show';
  if (status === 'student_no_show') return 'a student no-show';
  if (status === 'completed') return 'completed';
  return null;
}

function disputeResolvedMoneyLine({ audience, financialAction, bookingStatus }) {
  const refunding =
    financialAction === 'refund_student' || financialAction === 'refund_student_partial';
  const partial = financialAction === 'refund_student_partial';

  if (audience === 'student') {
    if (refunding) {
      return partial ? 'A partial refund will be issued.' : 'Your payment will be refunded.';
    }
    if (bookingStatus === 'student_no_show' || bookingStatus === 'completed') {
      return "Your coach's payout will proceed.";
    }
    return 'No refund will be issued.';
  }

  if (refunding) {
    return partial
      ? 'A partial refund will be issued to the student. You will not receive a full payout for this booking.'
      : 'The student will be refunded. You will not receive a payout for this booking.';
  }
  return 'Your payout will proceed.';
}

/** Student or coach recipient after admin resolve. */
export const buildDisputeResolvedNotificationContent = ({
  audience,
  outcome,
  financialAction,
  bookingStatus,
  decision,
} = {}) => {
  const headline = 'Dispute resolved';
  const status = bookingStatus || outcome || null;
  const money = disputeResolvedMoneyLine({ audience, financialAction, bookingStatus: status });
  const determination = attendanceDeterminationPhrase(status);

  let summary;
  if (determination === 'completed') {
    summary = `This dispute was reviewed and the booking was determined to have been completed. ${money}`;
  } else if (determination) {
    summary = `This dispute was reviewed and the booking was determined to be ${determination}. ${money}`;
  } else {
    const reviewed =
      decision === 'rejected'
        ? 'This dispute was reviewed and was not upheld.'
        : 'This dispute was reviewed.';
    summary = `${reviewed} ${money}`;
  }

  return { headline, summary };
};

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
