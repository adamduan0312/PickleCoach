/**
 * Seed a single booking for dispute testing (without going through booking/payment flow).
 *
 * Prefer the modern pipeline for frontend/API work:
 *   npm run seed:test-flows
 *   npm run seed:all:dev
 *
 * Usage:
 *   node scripts/seed-test-booking.js
 *   node scripts/seed-test-booking.js --lesson-id=2
 *   node scripts/seed-test-booking.js --coach-id=4 --student-id=7
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  Booking,
  Lesson,
  User,
  UserRole,
  CoachCourtLocation,
  CourtLocation,
} from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

const getArg = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
};

const parseIntArg = (name) => {
  const raw = getArg(name);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
};

const createIdempotencyKey = () =>
  `seed_dispute_booking_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function pickLesson(lessonId, coachId) {
  if (lessonId) {
    const lesson = await Lesson.findOne({
      where: {
        id: lessonId,
        is_active: true,
        deleted_at: null,
      },
    });
    if (!lesson) return null;
    const coachRole = await UserRole.findOne({ where: { user_id: lesson.coach_id, role: 'coach' } });
    const adminRole = await UserRole.findOne({ where: { user_id: lesson.coach_id, role: 'admin' } });
    if (!coachRole || adminRole) return null;
    return lesson;
  }

  const where = {
    is_active: true,
    deleted_at: null,
  };
  if (coachId) where.coach_id = coachId;

  const lessons = await Lesson.findAll({
    where,
    order: [['id', 'ASC']],
  });
  for (const lesson of lessons) {
    const coachRole = await UserRole.findOne({ where: { user_id: lesson.coach_id, role: 'coach' } });
    const adminRole = await UserRole.findOne({ where: { user_id: lesson.coach_id, role: 'admin' } });
    if (coachRole && !adminRole) return lesson;
  }
  return null;
}

async function pickStudent(studentId, coachId) {
  if (studentId) {
    const user = await User.findByPk(studentId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    if (!user) return null;
    const roles = (user.userRoles || []).map((r) => r.role);
    if (!roles.includes('student')) return null;
    if (roles.includes('admin')) return null;
    if (user.id === coachId) return null;
    return user;
  }

  return User.findOne({
    where: {
      id: { [Op.ne]: coachId },
      is_active: true,
      deleted_at: null,
    },
    include: [
      {
        model: UserRole,
        as: 'userRoles',
        where: { role: 'student' },
        required: true,
        attributes: ['role'],
      },
    ],
    order: [['id', 'ASC']],
  });
}

async function pickCoachCourtId(coachId) {
  const link = await CoachCourtLocation.findOne({
    where: { coach_id: coachId },
    include: [
      {
        model: CourtLocation,
        as: 'court',
        where: { deleted_at: null },
        required: true,
        attributes: ['id'],
      },
    ],
    order: [['id', 'ASC']],
  });
  return link?.court?.id ?? null;
}

async function main() {
  const lessonId = parseIntArg('lesson-id');
  const coachIdArg = parseIntArg('coach-id');
  const studentIdArg = parseIntArg('student-id');

  try {
    await sequelize.authenticate();

    const lesson = await pickLesson(lessonId, coachIdArg);
    if (!lesson) {
      console.error('No active lesson found. Create an active lesson first or pass --lesson-id=<id>.');
      process.exit(1);
    }

    const coachId = lesson.coach_id;
    const coach = await User.findByPk(coachId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    const coachRoles = (coach?.userRoles || []).map((r) => r.role);
    if (!coach || !coachRoles.includes('coach') || coachRoles.includes('admin')) {
      console.error('Selected lesson belongs to invalid coach role setup (must be coach and not admin).');
      process.exit(1);
    }

    const student = await pickStudent(studentIdArg, coachId);
    if (!student) {
      console.error('No valid student found (or selected student is invalid/same as coach).');
      process.exit(1);
    }

    const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const courtId = await pickCoachCourtId(coachId);

    const booking = await Booking.create({
      lesson_id: lesson.id,
      coach_id: coachId,
      primary_student_id: student.id,
      scheduled_at: scheduledAt,
      duration_minutes: lesson.duration_minutes,
      price: lesson.price,
      status: 'pending',
      payout_status: 'none',
      court_location_id: courtId,
      idempotency_key: createIdempotencyKey(),
    });

    console.log('Seeded booking for dispute testing:');
    console.log(JSON.stringify({
      booking_id: booking.id,
      lesson_id: lesson.id,
      coach_id: coachId,
      coach_name: coach.full_name,
      student_id: student.id,
      student_name: student.full_name,
      court_location_id: courtId,
      scheduled_at: booking.scheduled_at,
    }, null, 2));
    console.log('\nNext steps:');
    console.log('- Create dispute (as student/coach/admin): POST /api/disputes with booking_id and dispute_type_id');
    console.log('- Resolve dispute (as admin): PUT /api/disputes/:id/resolve');
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed test booking:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();

