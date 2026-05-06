/**
 * Seed one booking per lifecycle status with **no Payment rows** — for cancel/refund tests
 * without Stripe charges (avoids fake `ch_test_*` charge IDs).
 *
 * Creates: pending, confirmed, awaiting_verification, completed, cancelled, disputed (+ dispute row),
 * student_no_show, coach_no_show.
 *
 * Usage:
 *   node scripts/seed-bookings-no-charge.js
 *   node scripts/seed-bookings-no-charge.js --lesson-id=2
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
  Dispute,
  DisputeType,
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

const createIdempotencyKey = (label) =>
  `seed_nocharge_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

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

const STATUS_ROWS = [
  {
    key: 'pending',
    status: 'pending',
    payout_status: 'none',
    offsetDays: 10,
    extra: () => ({}),
  },
  {
    key: 'confirmed',
    status: 'confirmed',
    payout_status: 'none',
    offsetDays: 11,
    extra: () => ({}),
  },
  {
    key: 'awaiting_verification',
    status: 'awaiting_verification',
    payout_status: 'awaiting_verification',
    offsetDays: -3,
    extra: () => ({ messaging_locked: false }),
  },
  {
    key: 'completed',
    status: 'completed',
    payout_status: 'paid',
    offsetDays: -7,
    extra: () => ({ messaging_locked: false }),
  },
  {
    key: 'cancelled',
    status: 'cancelled',
    payout_status: 'none',
    offsetDays: 14,
    extra: () => ({
      cancelled_by: 'student',
      cancelled_at: new Date(),
    }),
  },
  {
    key: 'disputed',
    status: 'disputed',
    payout_status: 'none',
    offsetDays: -5,
    extra: () => ({ messaging_locked: true }),
  },
  {
    key: 'student_no_show',
    status: 'student_no_show',
    payout_status: 'forfeited',
    offsetDays: -4,
    extra: () => ({ messaging_locked: true }),
  },
  {
    key: 'coach_no_show',
    status: 'coach_no_show',
    payout_status: 'forfeited',
    offsetDays: -6,
    extra: () => ({ messaging_locked: true }),
  },
];

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

    const disputeType = await DisputeType.findOne({ order: [['id', 'ASC']] });
    if (!disputeType) {
      console.error('No dispute types found. Run migrations/seeds first.');
      process.exit(1);
    }

    const courtId = await pickCoachCourtId(coachId);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const created = await sequelize.transaction(async (t) => {
      const rows = [];
      for (const spec of STATUS_ROWS) {
        const scheduledAt = new Date(now + spec.offsetDays * dayMs + rows.length * 60 * 60 * 1000);
        const rescheduleDeadline = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);

        const booking = await Booking.create(
          {
            lesson_id: lesson.id,
            coach_id: coachId,
            primary_student_id: student.id,
            scheduled_at: scheduledAt,
            duration_minutes: lesson.duration_minutes,
            price: lesson.price,
            status: spec.status,
            payout_status: spec.payout_status,
            reschedule_deadline: rescheduleDeadline,
            court_location_id: courtId,
            idempotency_key: createIdempotencyKey(spec.key),
            ...spec.extra(),
          },
          { transaction: t },
        );

        let disputeId = null;
        if (spec.key === 'disputed') {
          const dispute = await Dispute.create(
            {
              booking_id: booking.id,
              dispute_type_id: disputeType.id,
              opened_by: 'student',
              status: 'under_review',
            },
            { transaction: t },
          );
          disputeId = dispute.id;
        }

        rows.push({
          label: spec.key,
          booking_id: booking.id,
          status: booking.status,
          payout_status: booking.payout_status,
          scheduled_at: booking.scheduled_at,
          dispute_id: disputeId,
          payments: 0,
        });
      }
      return rows;
    });

    console.log('Seeded bookings (no Payment rows, one per status):');
    console.log(JSON.stringify({
      lesson_id: lesson.id,
      coach_id: coachId,
      coach_name: coach.full_name,
      student_id: student.id,
      student_name: student.full_name,
      court_location_id: courtId,
      dispute_type_id_used: disputeType.id,
      bookings: created,
    }, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed bookings:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
