/**
 * DB fixtures for HTTP booking integration tests.
 */
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import {
  User,
  UserRole,
  CoachProfile,
  CoachAvailability,
  CourtLocation,
  CoachCourtLocation,
  Lesson,
  Booking,
  Payment,
  PaymentAction,
  Payout,
  Dispute,
  CancellationHistory,
  Notification,
  Conversation,
  ConversationRead,
  Message,
} from '../../models/index.js';

const PASSWORD = 'Test1234!Ab';

/**
 * Next occurrence of weekday (0=Sun…6=Sat) at hour:minute in America/New_York, ≥ minDaysAhead.
 */
export function nextSlotInTz({ weekday, hour, minute = 0, minDaysAhead = 2, timeZone = 'America/New_York' }) {
  const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = Date.now();
  for (let dayOffset = minDaysAhead; dayOffset <= 21; dayOffset++) {
    const probe = new Date(now + dayOffset * 86400000);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(probe);
    const wd = parts.find((p) => p.type === 'weekday')?.value;
    if (weekdayShort.indexOf(wd) !== weekday) continue;
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    // Construct as local wall time in TZ via ISO with offset approximation: use Date from noon UTC then adjust
    // Prefer explicit UTC instant: format a candidate and verify hour in TZ.
    for (let utcHour = 0; utcHour < 48; utcHour++) {
      const candidate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), utcHour, minute, 0));
      const hp = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(candidate);
      const hVal = Number(hp.find((p) => p.type === 'hour')?.value);
      const minVal = Number(hp.find((p) => p.type === 'minute')?.value);
      const dayVal = hp.find((p) => p.type === 'day')?.value;
      const wd2 = hp.find((p) => p.type === 'weekday')?.value;
      if (dayVal === d && weekdayShort.indexOf(wd2) === weekday && hVal === hour && minVal === minute) {
        return candidate;
      }
    }
  }
  throw new Error(`Could not find slot weekday=${weekday} ${hour}:${minute} in ${timeZone}`);
}

/**
 * @param {{ studentCount?: number }} [opts]
 * @returns {Promise<{
 *   password: string,
 *   student: import('sequelize').Model,
 *   students: import('sequelize').Model[],
 *   coach: import('sequelize').Model,
 *   lesson: import('sequelize').Model,
 *   court: import('sequelize').Model,
 *   scheduledAt: Date,
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function createBookingJourneyFixture({ studentCount = 1 } = {}) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const passwordHash = bcrypt.hashSync(PASSWORD, 8);
  const nStudents = Math.max(1, Number(studentCount) || 1);

  const coach = await User.create({
    full_name: 'HTTP Int Coach',
    email: `http.int.coach.${suffix}@picklecoach.example.org`,
    password_hash: passwordHash,
    is_active: true,
    email_verified_at: new Date(),
    timezone: 'America/New_York',
  });
  await UserRole.create({ user_id: coach.id, role: 'coach' });

  await CoachProfile.create({
    user_id: coach.id,
    headline: 'Integration Coach',
    bio: 'HTTP integration fixture',
    experience_years: 5,
    skill_rating: 4,
    rating_system: 'self',
    location: 'Brooklyn, NY',
    stripe_account_id: 'acct_1HttpIntTestAccount',
    stripe_ready: true,
    stripe_onboarding_completed_at: new Date(),
  });

  const students = [];
  for (let i = 0; i < nStudents; i++) {
    const student = await User.create({
      full_name: `HTTP Int Student ${i + 1}`,
      email: `http.int.student.${i}.${suffix}@picklecoach.example.org`,
      password_hash: passwordHash,
      is_active: true,
      email_verified_at: new Date(),
      timezone: 'America/New_York',
    });
    await UserRole.create({ user_id: student.id, role: 'student' });
    students.push(student);
  }

  const court = await CourtLocation.create({
    name: `HTTP Int Court ${suffix}`,
    address_line1: '1 Test Ave',
    city: 'Brooklyn',
    state: 'NY',
    postal_code: '11201',
    country: 'US',
    latitude: 40.7,
    longitude: -73.99,
    is_private: false,
    source: 'manual',
    created_by_user_id: coach.id,
  });
  await CoachCourtLocation.create({ coach_id: coach.id, court_id: court.id });

  for (let weekday = 1; weekday <= 5; weekday++) {
    await CoachAvailability.create({
      coach_id: coach.id,
      weekday,
      start_time: '09:00:00',
      end_time: '17:00:00',
    });
  }

  const lesson = await Lesson.create({
    coach_id: coach.id,
    title: 'HTTP Integration Lesson',
    description: 'Authorize → confirm → accept',
    duration_minutes: 60,
    price: 100,
    max_students: 1,
    is_active: true,
  });

  // Next Tuesday 10:00 America/New_York
  const scheduledAt = nextSlotInTz({ weekday: 2, hour: 10, minute: 0, minDaysAhead: 2 });

  const studentIds = students.map((s) => s.id);

  const cleanup = async () => {
    const bookings = await Booking.findAll({
      where: {
        [Op.or]: [{ primary_student_id: studentIds }, { coach_id: coach.id }],
      },
      attributes: ['id'],
    });
    const bookingIds = [...new Set(bookings.map((b) => b.id))];
    if (bookingIds.length) {
      const payments = await Payment.findAll({
        where: { booking_id: bookingIds },
        attributes: ['id'],
      });
      const paymentIds = payments.map((p) => p.id);
      if (paymentIds.length) {
        await PaymentAction.destroy({ where: { payment_id: paymentIds } });
        await Payout.destroy({ where: { payment_id: paymentIds } });
      }
      await PaymentAction.destroy({ where: { booking_id: bookingIds } });
      await Dispute.destroy({ where: { booking_id: bookingIds } });
      await CancellationHistory.destroy({ where: { booking_id: bookingIds } });
      await Payment.destroy({ where: { booking_id: bookingIds } });
      const conversations = await Conversation.findAll({
        where: { booking_id: bookingIds },
        attributes: ['id'],
      });
      const conversationIds = conversations.map((c) => c.id);
      if (conversationIds.length) {
        await Message.destroy({ where: { conversation_id: conversationIds } });
        await ConversationRead.destroy({ where: { conversation_id: conversationIds } });
        await Conversation.destroy({ where: { id: conversationIds } });
      }
      await Booking.destroy({ where: { id: bookingIds } });
    }
    await Notification.destroy({ where: { user_id: [...studentIds, coach.id] } }).catch(() => {});
    await Lesson.destroy({ where: { coach_id: coach.id } });
    await CoachAvailability.destroy({ where: { coach_id: coach.id } });
    await CoachCourtLocation.destroy({ where: { coach_id: coach.id } });
    await CourtLocation.destroy({ where: { id: court.id } });
    await CoachProfile.destroy({ where: { user_id: coach.id } });
    await UserRole.destroy({ where: { user_id: [...studentIds, coach.id] } });
    await User.destroy({ where: { id: [...studentIds, coach.id] } });
  };

  return {
    password: PASSWORD,
    student: students[0],
    students,
    coach,
    lesson,
    court,
    scheduledAt,
    cleanup,
  };
}
