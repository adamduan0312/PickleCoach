/**
 * SMS body templates for notification delivery (Twilio).
 * Presentation only — orchestration lives in services/notificationService.js.
 *
 * Not enabled for MVP: product flows do not create channel:'sms' rows yet.
 * Kept as dormant infrastructure so SMS can be wired later without rebuilding templates.
 */

export function getSMSContent(type, payload) {
  const scheduledAt = payload?.scheduled_at ? new Date(payload.scheduled_at).toLocaleString() : 'N/A';

  const messages = {
    pre_lesson_24h: `PickleCoach: Lesson tomorrow at ${scheduledAt}`,
    pre_lesson_1h: `PickleCoach: Lesson in 1 hour at ${scheduledAt}`,
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
}
