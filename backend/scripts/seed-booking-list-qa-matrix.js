/**
 * Seed seven bookings for manual My Bookings list QA:
 *   pending tomorrow, awaiting verification (lesson ended ~2h ago),
 *   confirmed today, confirmed next week, completed yesterday,
 *   cancelled tomorrow, cancelled last week.
 *
 * Idempotent — removes prior rows with idempotency_key prefix `qa_list_matrix_`.
 *
 * Usage (from backend/):
 *   npm run seed:booking-list-qa
 *   node scripts/seed-booking-list-qa-matrix.js --student-email=you@example.com
 *   node scripts/seed-booking-list-qa-matrix.js --coach-name="Mira Miami"
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

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const IDEM_PREFIX = 'qa_list_matrix_';
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;

const getArg = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
};

async function findStudent(email) {
  return User.findOne({
    where: { email, is_active: true, deleted_at: null },
    include: [{ model: UserRole, as: 'userRoles', where: { role: 'student' }, required: true }],
  });
}

async function findCoachByName(fullName) {
  return User.findOne({
    where: { full_name: fullName, is_active: true, deleted_at: null },
    include: [{ model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true }],
  });
}

async function pickLesson(coachId) {
  return Lesson.findOne({
    where: { coach_id: coachId, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
  });
}

async function pickCourtId(coachId) {
  const link = await CoachCourtLocation.findOne({
    where: { coach_id: coachId },
    include: [{ model: CourtLocation, as: 'court', where: { deleted_at: null }, required: true }],
    order: [['id', 'ASC']],
  });
  return link?.court?.id ?? null;
}

/** Relative to `anchor` (defaults to now). */
function buildMatrix(anchor) {
  return [
    {
      key: 'pending_tomorrow',
      status: 'pending',
      scheduled_at: new Date(anchor.getTime() + dayMs + 3 * hourMs),
      created_at: new Date(anchor.getTime() - 2 * hourMs),
    },
    {
      key: 'confirmed_today',
      status: 'confirmed',
      scheduled_at: new Date(anchor.getTime() + 4 * hourMs),
      created_at: new Date(anchor.getTime() - 5 * dayMs),
    },
    {
      key: 'confirmed_next_week',
      status: 'confirmed',
      scheduled_at: new Date(anchor.getTime() + 7 * dayMs),
      created_at: new Date(anchor.getTime() - 3 * dayMs),
    },
    {
      key: 'awaiting_verification_2h_ago',
      status: 'awaiting_verification',
      scheduled_at: new Date(anchor.getTime() - 3 * hourMs),
      created_at: new Date(anchor.getTime() - 8 * dayMs),
      payout_status: 'awaiting_verification',
      messaging_locked: false,
    },
    {
      key: 'completed_yesterday',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - dayMs),
      created_at: new Date(anchor.getTime() - 8 * dayMs),
      messaging_locked: false,
    },
    {
      key: 'cancelled_tomorrow',
      status: 'cancelled',
      scheduled_at: new Date(anchor.getTime() + dayMs + 5 * hourMs),
      created_at: new Date(anchor.getTime() - 4 * dayMs),
      cancelled_by: 'student',
      cancelled_at: new Date(anchor.getTime() - 2 * dayMs),
    },
    {
      key: 'cancelled_last_week',
      status: 'cancelled',
      scheduled_at: new Date(anchor.getTime() - 7 * dayMs),
      created_at: new Date(anchor.getTime() - 14 * dayMs),
      cancelled_by: 'student',
      cancelled_at: new Date(anchor.getTime() - 7 * dayMs),
    },
  ];
}

async function main() {
  const studentEmail = getArg('student-email') || 'adamduan0312@gmail.com';
  const coachName = getArg('coach-name') || 'Mira Miami';

  try {
    await sequelize.authenticate();

    const student = await findStudent(studentEmail);
    if (!student) {
      console.error(`Student not found: ${studentEmail}`);
      process.exit(1);
    }

    const coach = await findCoachByName(coachName);
    if (!coach) {
      console.error(`Coach not found: ${coachName}`);
      process.exit(1);
    }

    if (student.id === coach.id) {
      console.error('Student and coach must be different users.');
      process.exit(1);
    }

    const lesson = await pickLesson(coach.id);
    if (!lesson) {
      console.error(`No active lesson for coach ${coachName}. Run seed:pinecrest-near-me first.`);
      process.exit(1);
    }

    const courtId = await pickCourtId(coach.id);
    const anchor = new Date();
    const matrix = buildMatrix(anchor);

    const created = await sequelize.transaction(async (t) => {
      await Booking.destroy({
        where: { idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` } },
        transaction: t,
      });

      const rows = [];
      for (const spec of matrix) {
        const { key, created_at: createdAt, ...fields } = spec;
        const booking = await Booking.create(
          {
            lesson_id: lesson.id,
            coach_id: coach.id,
            primary_student_id: student.id,
            duration_minutes: lesson.duration_minutes,
            price: lesson.price,
            court_location_id: courtId,
            payout_status: fields.status === 'completed' ? 'paid' : 'none',
            idempotency_key: `${IDEM_PREFIX}${key}`,
            created_at: createdAt,
            ...fields,
          },
          { transaction: t },
        );
        rows.push({
          key,
          booking_id: booking.id,
          status: booking.status,
          scheduled_at: booking.scheduled_at,
          created_at: booking.created_at,
        });
      }
      return rows;
    });

    console.log('Seeded booking list QA matrix:');
    console.log(JSON.stringify({
      anchor: anchor.toISOString(),
      student: { id: student.id, email: student.email, name: student.full_name },
      coach: { id: coach.id, name: coach.full_name },
      lesson: { id: lesson.id, title: lesson.title },
      expected_all_tab_order: matrix.map((r) => r.key),
      bookings: created,
    }, null, 2));
    console.log('\nNext: npm run verify:booking-list-qa');
    process.exit(0);
  } catch (error) {
    console.error('Failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
