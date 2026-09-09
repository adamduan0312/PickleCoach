/**
 * SMS body templates for notification delivery (Twilio).
 * Presentation only — orchestration lives in services/notificationService.js.
 *
 * Not enabled for MVP: product flows do not create channel:'sms' rows yet.
 * Kept as dormant infrastructure so SMS can be wired later without rebuilding templates.
 */

function resolveWhen(payload = {}) {
  if (payload.lesson_when && String(payload.lesson_when).trim()) {
    return String(payload.lesson_when).trim();
  }
  if (payload.lesson_date && payload.lesson_time) {
    return `${payload.lesson_date} at ${payload.lesson_time}`;
  }
  if (payload.lesson_date) return String(payload.lesson_date);
  if (payload.lesson_time) return String(payload.lesson_time);
  return 'see your booking in PickleCoach';
}

export function getSMSContent(type, payload) {
  const when = resolveWhen(payload);
  const place = payload?.court_name ? ` at ${payload.court_name}` : '';
  const counterpart =
    payload?.audience === 'coach'
      ? (payload?.student_name || 'your student')
      : (payload?.coach_name || 'your coach');

  const messages = {
    pre_lesson_24h: `PickleCoach: Lesson tomorrow with ${counterpart} — ${payload?.lesson_title || 'lesson'} on ${when}${place}.`,
    pre_lesson_1h: `PickleCoach: Lesson in 1 hour with ${counterpart} — ${payload?.lesson_title || 'lesson'} at ${when}${place}.`,
    booking_confirmed: `PickleCoach: Booking confirmed — ${payload?.lesson_title || 'lesson'} with ${payload?.coach_name || 'your coach'} on ${when}.`,
    booking_declined: [
      `PickleCoach: ${payload?.headline || 'Coach declined your booking.'}`,
      payload?.reason_line,
      payload?.message_to_student ? `Message: ${payload.message_to_student}` : 'Book another slot in the app.',
    ].filter(Boolean).join(' '),
    booking_cancelled: `PickleCoach: ${payload?.headline || `Booking cancelled — ${payload?.lesson_title || 'lesson'} on ${when}.`}${payload?.reason_line ? ` ${payload.reason_line}.` : ''}`,
    booking_request_coach: `PickleCoach: New booking request from ${payload?.student_name || 'a student'}${payload?.coach_acceptance_deadline_label ? ` — respond by ${payload.coach_acceptance_deadline_label}` : ''}. Open PickleCoach to accept or decline.`,
  };

  return messages[type] || 'You have a new notification from PickleCoach.';
}
