/**
 * Seed one or more bookings in `confirmed` status where lesson end time is just in the past.
 *
 * This is useful for testing no-show endpoints that require:
 * - status includes `confirmed`
 * - lesson has already ended
 *
 * Usage:
 *   node scripts/seed-confirmed-ended-booking.js
 *   node scripts/seed-confirmed-ended-booking.js --ended-minutes-ago=1
 *   node scripts/seed-confirmed-ended-booking.js --count=5
 *   node scripts/seed-confirmed-ended-booking.js --lesson-id=2
 *   node scripts/seed-confirmed-ended-booking.js --coach-id=4 --student-id=7
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
  `seed_confirmed_ended_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function pickLesson(lessonId, coachId) {
  if (lessonId) {
    const lesson = await Lesson.findOne({
      where: { id: lessonId, is_active: true, deleted_at: null },
    });
    if (!lesson) return null;
    const coachRole = await UserRole.findOne({ where: { user_id: lesson.coach_id, role: 'coach' } });
    const adminRole = await UserRole.findOne({ where: { user_id: lesson.coach_id, role: 'admin' } });
    if (!coachRole || adminRole) return null;
    return lesson;
  }

  const where = { is_active: true, deleted_at: null };
  if (coachId) where.coach_id = coachId;

  const lessons = await Lesson.findAll({ where, order: [['id', 'ASC']] });
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

async function pickStudents({ count, coachId, preferredStudentId = null }) {
  const selected = [];
  const selectedIds = new Set();

  if (preferredStudentId != null) {
    const preferred = await pickStudent(preferredStudentId, coachId);
    if (!preferred) {
      return null;
    }
    selected.push(preferred);
    selectedIds.add(preferred.id);
  }

  if (selected.length >= count) {
    return selected.slice(0, count);
  }

  const pool = await User.findAll({
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

  for (const candidate of pool) {
    const roles = (candidate.userRoles || []).map((r) => r.role);
    if (!roles.includes('student')) continue;
    if (roles.includes('admin')) continue;
    if (candidate.id === coachId) continue;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    if (selected.length >= count) break;
  }

  if (selected.length < count) return null;
  return selected;
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
  const endedMinutesAgoArg = parseIntArg('ended-minutes-ago');
  const endedMinutesAgo = endedMinutesAgoArg && endedMinutesAgoArg > 0 ? endedMinutesAgoArg : 1;
  const countArg = parseIntArg('count');
  const count = countArg && countArg > 0 ? countArg : 1;

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

    const students = await pickStudents({
      count,
      coachId,
      preferredStudentId: studentIdArg,
    });
    if (!students) {
      console.error(
        `Could not find ${count} valid student(s) (non-admin, active, and not the same user as coach).`,
      );
      process.exit(1);
    }

    const courtId = await pickCoachCourtId(coachId);
    const now = Date.now();
    const created = [];
    for (let i = 0; i < students.length; i += 1) {
      // Stagger each booking by one minute to keep timestamps distinct.
      const lessonEndMs = now - (endedMinutesAgo + i) * 60 * 1000;
      const scheduledAt = new Date(lessonEndMs - lesson.duration_minutes * 60 * 1000);
      const rescheduleDeadline = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
      const student = students[i];
      const booking = await Booking.create({
        lesson_id: lesson.id,
        coach_id: coachId,
        primary_student_id: student.id,
        scheduled_at: scheduledAt,
        duration_minutes: lesson.duration_minutes,
        price: lesson.price,
        status: 'confirmed',
        payout_status: 'none',
        messaging_locked: false,
        reschedule_deadline: rescheduleDeadline,
        court_location_id: courtId,
        idempotency_key: createIdempotencyKey(),
      });
      created.push({
        booking_id: booking.id,
        lesson_id: lesson.id,
        coach_id: coachId,
        coach_name: coach.full_name,
        student_id: student.id,
        student_name: student.full_name,
        court_location_id: courtId,
        status: booking.status,
        scheduled_at: booking.scheduled_at,
        lesson_ends_at: new Date(lessonEndMs).toISOString(),
        ended_minutes_ago: endedMinutesAgo + i,
      });
    }

    console.log(`Seeded ${created.length} confirmed booking(s) that just ended:`);
    console.log(
      JSON.stringify(
        created,
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed confirmed-ended booking:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
