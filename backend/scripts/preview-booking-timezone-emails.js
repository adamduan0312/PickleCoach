/**
 * Send preview copies of booking emails for an existing booking so both sides can
 * check timezone wording. Does not create notification rows or touch idempotency.
 *
 * Sends:
 *   - Coach: new booking request (coach's timezone, with respond-by deadline)
 *   - Student: 24h lesson reminder (student's timezone)
 *
 * Run (from backend/):
 *   NODE_ENV=development node scripts/preview-booking-timezone-emails.js <bookingId>
 */
import dotenv from 'dotenv';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const { sequelize, Booking, User, Lesson, CourtLocation } = await import('../models/index.js');
const { getEmailSubject, getEmailContent } = await import('../notifications/emailTemplates.js');
const { withNotificationRoute } = await import('../notifications/notificationRoutes.js');
const {
  buildBookingRequestCoachNotificationContent,
  buildPreLessonReminderNotificationContent,
} = await import('../notifications/payloadBuilders.js');
const { buildLessonReminderDetailFields, formatDeadlineLabelForEmail } = await import('../utils/lessonReminderCopy.js');
const {
  getCoachAcceptanceTimeoutHours,
  getMinBookingLeadHours,
  getCoachAcceptanceDeadlineAt,
} = await import('../utils/coachAcceptanceTimeout.js');

async function sendEmail(to, subject, html) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY is not configured');
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.SENDGRID_FROM_EMAIL || 'noreply@picklecoach.com' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
}

async function main() {
  const bookingId = Number(process.argv[2]);
  if (!bookingId) throw new Error('Usage: node scripts/preview-booking-timezone-emails.js <bookingId>');
  sequelize.options.logging = false;

  const booking = await Booking.findByPk(bookingId, {
    include: [
      { model: User, as: 'coach', attributes: ['id', 'full_name', 'email', 'timezone'] },
      { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'email', 'timezone'] },
      { model: Lesson, as: 'lesson', attributes: ['id', 'title'] },
      { model: CourtLocation, as: 'courtLocation' },
    ],
  });
  if (!booking) throw new Error(`Booking #${bookingId} not found`);

  const coachTz = booking.coach?.timezone || 'UTC';
  const studentTz = booking.primaryStudent?.timezone || 'UTC';

  const deadlineAt = getCoachAcceptanceDeadlineAt({
    requestAt: booking.created_at,
    scheduledAt: booking.scheduled_at,
  });
  const coachBase = {
    booking_id: booking.id,
    scheduled_at: booking.scheduled_at,
    coach_name: booking.coach?.full_name,
    student_name: booking.primaryStudent?.full_name || 'A student',
    ...buildLessonReminderDetailFields(booking, coachTz, { audience: 'coach' }),
    coach_acceptance_timeout_hours: getCoachAcceptanceTimeoutHours(),
    min_booking_lead_hours: getMinBookingLeadHours(),
    coach_acceptance_deadline_at: deadlineAt.toISOString(),
    coach_acceptance_deadline_label: formatDeadlineLabelForEmail(deadlineAt, coachTz),
  };
  const coachPayload = withNotificationRoute('booking_request_coach', {
    ...coachBase,
    ...buildBookingRequestCoachNotificationContent(coachBase),
  });

  const studentBase = {
    booking_id: booking.id,
    scheduled_at: booking.scheduled_at,
    coach_name: booking.coach?.full_name || 'Coach',
    student_name: booking.primaryStudent?.full_name || 'Student',
    reminder_type: '24h',
    audience: 'student',
    ...buildLessonReminderDetailFields(booking, studentTz, { audience: 'student' }),
  };
  const studentPayload = withNotificationRoute('pre_lesson_24h', {
    ...studentBase,
    ...buildPreLessonReminderNotificationContent(studentBase),
  });

  const sends = [
    { to: booking.coach.email, type: 'booking_request_coach', payload: coachPayload, tz: coachTz },
    { to: booking.primaryStudent.email, type: 'pre_lesson_24h', payload: studentPayload, tz: studentTz },
  ];

  console.log(`Booking #${booking.id} scheduled_at (UTC): ${new Date(booking.scheduled_at).toISOString()}\n`);
  for (const s of sends) {
    const subject = `[Preview] ${getEmailSubject(s.type, s.payload)}`;
    await sendEmail(s.to, subject, getEmailContent(s.type, s.payload));
    console.log(`Sent to ${s.to} (${s.tz})`);
    console.log(`  Subject: ${subject}`);
    console.log(`  When:    ${s.payload.lesson_when}`);
    if (s.payload.coach_acceptance_deadline_label) {
      console.log(`  Respond by: ${s.payload.coach_acceptance_deadline_label}`);
    }
    console.log('');
  }
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('preview-booking-timezone-emails failed:', err.message);
    try { await sequelize.close(); } catch { /* ignore */ }
    process.exit(1);
  });
