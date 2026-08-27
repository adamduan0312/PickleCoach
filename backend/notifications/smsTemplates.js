/**
 * SMS body templates for notification delivery (Twilio).
 * Presentation only — orchestration lives in services/notificationService.js.
 *
 * Not enabled for MVP: product flows do not create channel:'sms' rows yet.
 * Kept as dormant infrastructure so SMS can be wired later without rebuilding templates.
 */

export function getSMSContent(type, payload) {
  const scheduledAt = payload?.scheduled_at ? new Date(payload.scheduled_at).toLocaleString() : 'N/A';
  const when =
    payload?.lesson_date && payload?.lesson_time
      ? `${payload.lesson_date} at ${payload.lesson_time}`
      : scheduledAt;
  const place = payload?.court_name ? ` at ${payload.court_name}` : '';
  const counterpart =
    payload?.audience === 'coach'
      ? (payload?.student_name || 'your student')
      : (payload?.coach_name || 'your coach');

  const messages = {
    pre_lesson_24h: `PickleCoach: Lesson tomorrow with ${counterpart} — ${payload?.lesson_title || 'lesson'} on ${when}${place}.`,
    pre_lesson_1h: `PickleCoach: Lesson in 1 hour with ${counterpart} — ${payload?.lesson_title || 'lesson'} at ${when}${place}.`,
    booking_confirmed: `PickleCoach: Booking confirmed — ${payload?.lesson_title || 'lesson'} with ${payload?.coach_name || 'your coach'} at ${scheduledAt}.`,
    booking_declined: [
      `PickleCoach: ${payload?.headline || 'Coach declined your booking.'}`,
      payload?.reason_line,
      payload?.message_to_student ? `Message: ${payload.message_to_student}` : 'Book another slot in the app.',
    ].filter(Boolean).join(' '),
    booking_cancelled: `PickleCoach: ${payload?.headline || `Booking cancelled — ${payload?.lesson_title || 'lesson'} at ${scheduledAt}.`}${payload?.reason_line ? ` ${payload.reason_line}.` : ''}`,
    booking_request_coach: `PickleCoach: New booking request from ${payload?.student_name || 'a student'}${payload?.coach_acceptance_deadline_label ? ` — respond by ${payload.coach_acceptance_deadline_label}` : ''}. Open PickleCoach to accept or decline.`,
  };

  return messages[type] || 'You have a new notification from PickleCoach.';
}
