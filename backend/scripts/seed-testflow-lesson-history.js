/**
 * Add lessons + bookings for the test-flow coach (additive — does not wipe).
 * Includes one soft-deleted lesson with historical bookings for nested-lesson GET tests.
 *
 * Prerequisites: `npm run seed:test-flows` (or existing test-flow users + coach stack).
 *
 * Usage (from backend/):
 *   node scripts/seed-testflow-lesson-history.js
 */
import dotenv from 'dotenv';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

import {
  sequelize,
  User,
  UserRole,
  CoachCourtLocation,
  CourtLocation,
  Lesson,
  Booking,
  Payment,
} from '../models/index.js';

const COACH_EMAIL = 'coach.testflow@picklecoach.example.org';
const STUDENT_EMAIL = 'student.testflow@picklecoach.example.org';

const dayMs = 24 * 60 * 60 * 1000;
const minMs = 60 * 1000;

const idemKey = (label) =>
  `seed_testflow_hist_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function createNoStripePayment(booking) {
  const price = Number(booking.price);
  return Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: booking.primary_student_id,
    lesson_price: price.toFixed(2),
    platform_fee_percent: 8.0,
    platform_fee_amount: ((price * 8) / 100).toFixed(2),
    total_charge_to_student: (price * 1.08).toFixed(2),
    coach_payout_expected: ((price * 92) / 100).toFixed(2),
    escrow_status: 'held',
    payment_status: 'captured',
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: null,
    charge_id: null,
  });
}

async function createBooking({ lesson, coach, student, court, status, scheduledAt, label, withPayment }) {
  const booking = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: scheduledAt,
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status,
    payout_status: status === 'completed' ? 'pending' : 'none',
    messaging_locked: ['pending', 'disputed', 'cancelled'].includes(status),
    idempotency_key: idemKey(label),
  });
  if (withPayment) {
    await createNoStripePayment(booking);
  }
  return booking;
}

async function main() {
  await sequelize.authenticate();

  const coach = await User.findOne({
    where: { email: COACH_EMAIL },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  if (!coach) {
    throw new Error(`Coach not found (${COACH_EMAIL}). Run: npm run seed:test-flows`);
  }

  const student = await User.findOne({ where: { email: STUDENT_EMAIL } });
  if (!student) {
    throw new Error(`Student not found (${STUDENT_EMAIL}). Run: npm run seed:test-flows`);
  }

  const link = await CoachCourtLocation.findOne({
    where: { coach_id: coach.id },
    include: [
      {
        model: CourtLocation,
        as: 'court',
        where: { deleted_at: null },
        required: true,
      },
    ],
  });
  if (!link?.court) {
    throw new Error('No court linked to test-flow coach. Run: npm run seed:test-flows');
  }
  const court = link.court;

  const now = Date.now();

  const lessonActiveA = await Lesson.create({
    coach_id: coach.id,
    title: 'Power Serve Workshop',
    description: 'Active lesson — extra catalog item for test-flow coach.',
    price: 95,
    duration_minutes: 60,
    max_students: 2,
    is_active: true,
  });

  const lessonActiveB = await Lesson.create({
    coach_id: coach.id,
    title: 'Doubles Positioning Clinic',
    description: 'Active lesson — partner movement and court coverage.',
    price: 110,
    duration_minutes: 90,
    max_students: 4,
    is_active: true,
  });

  const lessonToDelete = await Lesson.create({
    coach_id: coach.id,
    title: 'Advanced Strategy Session',
    description: 'Will be soft-deleted after bookings exist — booking history should still nest this lesson.',
    price: 125,
    duration_minutes: 60,
    max_students: 1,
    is_active: true,
  });

  const bookings = {};

  bookings.active_a_pending = await createBooking({
    lesson: lessonActiveA,
    coach,
    student,
    court,
    status: 'pending',
    scheduledAt: new Date(now + 10 * dayMs),
    label: 'active_a_pending',
    withPayment: false,
  });

  bookings.active_a_confirmed = await createBooking({
    lesson: lessonActiveA,
    coach,
    student,
    court,
    status: 'confirmed',
    scheduledAt: new Date(now + 14 * dayMs),
    label: 'active_a_confirmed',
    withPayment: true,
  });

  bookings.active_b_completed = await createBooking({
    lesson: lessonActiveB,
    coach,
    student,
    court,
    status: 'completed',
    scheduledAt: new Date(now - 2 * dayMs),
    label: 'active_b_completed',
    withPayment: true,
  });

  const deletedLessonSchedules = [
    { key: 'deleted_lesson_completed_1', status: 'completed', daysAgo: 14 },
    { key: 'deleted_lesson_completed_2', status: 'completed', daysAgo: 30 },
    { key: 'deleted_lesson_cancelled', status: 'cancelled', daysAgo: 21 },
    { key: 'deleted_lesson_confirmed_past', status: 'confirmed', daysAgo: 5 },
  ];

  for (const spec of deletedLessonSchedules) {
    const end = new Date(now - spec.daysAgo * dayMs);
    const scheduledAt = new Date(end.getTime() - lessonToDelete.duration_minutes * minMs);
    bookings[spec.key] = await createBooking({
      lesson: lessonToDelete,
      coach,
      student,
      court,
      status: spec.status,
      scheduledAt,
      label: spec.key,
      withPayment: ['completed', 'confirmed'].includes(spec.status),
    });
  }

  const deletedAt = new Date();
  await lessonToDelete.update({ deleted_at: deletedAt, is_active: false });

  const fmt = (b) => ({
    id: b.id,
    status: b.status,
    lesson_id: b.lesson_id,
    scheduled_at: new Date(b.scheduled_at).toISOString(),
  });

  const summary = {
    coach: { id: coach.id, email: COACH_EMAIL },
    student: { id: student.id, email: STUDENT_EMAIL },
    court: { id: court.id, name: court.name },
    lessons: {
      power_serve_workshop: {
        id: lessonActiveA.id,
        title: lessonActiveA.title,
        is_active: true,
        deleted_at: null,
      },
      doubles_positioning: {
        id: lessonActiveB.id,
        title: lessonActiveB.title,
        is_active: true,
        deleted_at: null,
      },
      advanced_strategy_deleted: {
        id: lessonToDelete.id,
        title: lessonToDelete.title,
        is_active: false,
        deleted_at: deletedAt.toISOString(),
        note: 'GET /api/lessons/:id → 404; nested on booking GETs → still returned',
      },
    },
    bookings: Object.fromEntries(Object.entries(bookings).map(([k, v]) => [k, fmt(v)])),
    verify: {
      login_coach: { email: COACH_EMAIL, password: 'Test1234!Ab' },
      login_student: { email: STUDENT_EMAIL, password: 'Test1234!Ab' },
      endpoints: [
        'GET /api/bookings',
        'GET /api/bookings/:id',
        'GET /api/coaches/bookings',
        'GET /api/admin/bookings',
        'GET /api/admin/bookings/:id',
      ],
      sample_deleted_lesson_booking_id: bookings.deleted_lesson_completed_1.id,
      expect_nested_lesson_deleted_at: deletedAt.toISOString(),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log('\nDone. Soft-deleted lesson still appears nested on booking GET responses.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
