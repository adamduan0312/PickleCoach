/**
 * Seed completed bookings + student reviews (with and without comments) for marketplace coaches.
 * Idempotent — safe to re-run. Updates coach rating aggregates from actual review rows.
 *
 * Prerequisites (from backend/):
 *   npm run seed:pinecrest-near-me
 *   npm run seed:davie-near-me   # optional
 *
 * Usage:
 *   npm run seed:coach-reviews
 *
 * Password for seeded reviewer students: Test1234!Ab
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import {
  sequelize,
  User,
  UserRole,
  CoachCourtLocation,
  CourtLocation,
  Lesson,
  Booking,
  Payment,
  Review,
} from '../models/index.js';
import { recalculateCoachRatingFromReviews } from '../utils/recalculateCoachRating.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const PASSWORD = 'Test1234!Ab';
const DOMAIN = 'picklecoach.example.org';
const dayMs = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ coachEmailLocal: string, studentEmailLocal: string, studentName: string, rating: number, comment?: string | null, daysAgo: number }} ReviewSeed
 */
/** @type {ReviewSeed[]} */
const REVIEW_SEEDS = [
  {
    coachEmailLocal: 'coach.pinecrest.gardens',
    studentEmailLocal: 'reviewer.piper.1',
    studentName: 'Jordan Martinez',
    rating: 5,
    comment: 'Piper helped me stop panicking at the kitchen line. Clear drills and patient feedback — I felt much more confident after just one session.',
    daysAgo: 42,
  },
  {
    coachEmailLocal: 'coach.pinecrest.gardens',
    studentEmailLocal: 'reviewer.piper.2',
    studentName: 'Alex Kim',
    rating: 5,
    comment: 'Great communicator and very organized. We focused on third-shot drops and I left with two concrete things to practice before league night.',
    daysAgo: 35,
  },
  {
    coachEmailLocal: 'coach.pinecrest.gardens',
    studentEmailLocal: 'reviewer.piper.3',
    studentName: 'Sam Rivera',
    rating: 4,
    comment: 'Solid lesson overall. Would have liked a bit more live-ball play time, but the technical breakdown was really helpful.',
    daysAgo: 28,
  },
  {
    coachEmailLocal: 'coach.pinecrest.gardens',
    studentEmailLocal: 'reviewer.piper.4',
    studentName: 'Chris Nguyen',
    rating: 5,
    comment: 'Exactly what I needed as a beginner moving into intermediate play. Friendly, encouraging, and practical.',
    daysAgo: 21,
  },
  {
    coachEmailLocal: 'coach.pinecrest.gardens',
    studentEmailLocal: 'reviewer.piper.5',
    studentName: 'Taylor Brooks',
    rating: 4,
    comment: null,
    daysAgo: 14,
  },
  {
    coachEmailLocal: 'coach.pinecrest.gardens',
    studentEmailLocal: 'reviewer.piper.6',
    studentName: 'Morgan Lee',
    rating: 5,
    comment: 'Booked again immediately. Piper explains strategy in plain language and keeps the session moving.',
    daysAgo: 7,
  },
  {
    coachEmailLocal: 'coach.pinecrest.killian',
    studentEmailLocal: 'reviewer.kai.1',
    studentName: 'Riley Chen',
    rating: 5,
    comment: 'Kai spotted habits I did not realize I had and gave me simple fixes. My dinks are finally consistent.',
    daysAgo: 40,
  },
  {
    coachEmailLocal: 'coach.pinecrest.killian',
    studentEmailLocal: 'reviewer.kai.2',
    studentName: 'Casey Walsh',
    rating: 4,
    comment: 'Professional and on time. Good mix of drilling and coached points.',
    daysAgo: 22,
  },
  {
    coachEmailLocal: 'coach.pinecrest.killian',
    studentEmailLocal: 'reviewer.kai.3',
    studentName: 'Jamie Ortiz',
    rating: 5,
    comment: null,
    daysAgo: 10,
  },
  {
    coachEmailLocal: 'coach.davie.abiaca',
    studentEmailLocal: 'reviewer.ava.1',
    studentName: 'Pat Johnson',
    rating: 5,
    comment: 'Ava made my first real lesson feel approachable. Footwork and paddle prep finally clicked.',
    daysAgo: 33,
  },
  {
    coachEmailLocal: 'coach.davie.abiaca',
    studentEmailLocal: 'reviewer.ava.2',
    studentName: 'Dana Hughes',
    rating: 4,
    comment: 'Helpful session near Tree Tops. I appreciated the structured warm-up and clear goals for the hour.',
    daysAgo: 18,
  },
  {
    coachEmailLocal: 'coach.davie.ftlaud',
    studentEmailLocal: 'reviewer.frankie.1',
    studentName: 'Quinn Adams',
    rating: 5,
    comment: 'High-energy coach with sharp tactical advice. Worth the drive from Davie.',
    daysAgo: 26,
  },
  {
    coachEmailLocal: 'coach.davie.ftlaud',
    studentEmailLocal: 'reviewer.frankie.2',
    studentName: 'Robin Ellis',
    rating: 5,
    comment: null,
    daysAgo: 12,
  },
];

async function ensureStudent({ emailLocal, fullName }, passwordHash) {
  const email = `${emailLocal}@${DOMAIN}`;
  let user = await User.findOne({ where: { email } });
  if (!user) {
    user = await User.create({
      full_name: fullName,
      email,
      password_hash: passwordHash,
      phone: null,
      timezone: 'America/New_York',
      is_active: true,
      email_verified_at: new Date(),
    });
    await UserRole.create({ user_id: user.id, role: 'student' });
  } else {
    await user.update({ full_name: fullName, is_active: true, deleted_at: null });
    if (!(await UserRole.findOne({ where: { user_id: user.id, role: 'student' } }))) {
      await UserRole.create({ user_id: user.id, role: 'student' });
    }
  }
  return user;
}

async function loadCoachStack(coachEmailLocal) {
  const email = `${coachEmailLocal}@${DOMAIN}`;
  const coach = await User.findOne({ where: { email } });
  if (!coach) return null;

  const lesson = await Lesson.findOne({
    where: { coach_id: coach.id, deleted_at: null, is_active: true },
    order: [['id', 'ASC']],
  });
  if (!lesson) return null;

  const link = await CoachCourtLocation.findOne({
    where: { coach_id: coach.id },
    include: [{ model: CourtLocation, as: 'court' }],
  });
  const court = link?.court;
  if (!court) return null;

  return { coach, lesson, court };
}

async function ensureCompletedBooking({ coach, lesson, court, student, daysAgo, idempotencyKey }) {
  let booking = await Booking.findOne({ where: { idempotency_key: idempotencyKey } });
  const scheduledAt = new Date(Date.now() - daysAgo * dayMs - lesson.duration_minutes * 60 * 1000);

  if (!booking) {
    booking = await Booking.create({
      lesson_id: lesson.id,
      coach_id: coach.id,
      primary_student_id: student.id,
      scheduled_at: scheduledAt,
      duration_minutes: lesson.duration_minutes,
      price: lesson.price,
      court_location_id: court.id,
      status: 'completed',
      payout_status: 'pending',
      messaging_locked: true,
      idempotency_key: idempotencyKey,
    });

    const price = Number(booking.price);
    await Payment.create({
      booking_id: booking.id,
      coach_id: booking.coach_id,
      student_id: booking.primary_student_id,
      lesson_price: price.toFixed(2),
      platform_fee_percent: 8.0,
      platform_fee_amount: ((price * 8) / 100).toFixed(2),
      total_charge_to_student: price.toFixed(2),
      coach_payout_expected: ((price * 92) / 100).toFixed(2),
      escrow_status: 'held',
      payment_status: 'captured',
      payment_method: 'stripe',
      currency: 'USD',
      payment_intent_id: null,
      charge_id: null,
    });
  } else if (booking.status !== 'completed') {
    await booking.update({ status: 'completed', primary_student_id: student.id });
  }

  return booking;
}

async function ensureReview({ booking, coach, student, rating, comment, daysAgo }) {
  let review = await Review.findOne({ where: { booking_id: booking.id } });
  const createdAt = new Date(Date.now() - daysAgo * dayMs);
  const commentValue = comment == null || String(comment).trim() === '' ? null : String(comment).trim();

  if (!review) {
    review = await Review.create({
      booking_id: booking.id,
      student_id: student.id,
      coach_id: coach.id,
      rating,
      comment: commentValue,
      created_at: createdAt,
      updated_at: createdAt,
    });
    return { action: 'created', review };
  }

  await review.update({
    student_id: student.id,
    coach_id: coach.id,
    rating,
    comment: commentValue,
    created_at: createdAt,
    updated_at: createdAt,
  });
  return { action: 'updated', review };
}

async function main() {
  await sequelize.authenticate();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const touchedCoachIds = new Set();
  const results = [];

  for (const spec of REVIEW_SEEDS) {
    const stack = await loadCoachStack(spec.coachEmailLocal);
    if (!stack) {
      results.push({
        coach: spec.coachEmailLocal,
        student: spec.studentEmailLocal,
        status: 'skipped',
        detail: 'coach/lesson/court not found — run seed:pinecrest-near-me / seed:davie-near-me',
      });
      continue;
    }

    const student = await ensureStudent(
      { emailLocal: spec.studentEmailLocal, fullName: spec.studentName },
      passwordHash,
    );
    const idempotencyKey = `seed_coach_review_${spec.coachEmailLocal}_${spec.studentEmailLocal}`;
    const booking = await ensureCompletedBooking({
      coach: stack.coach,
      lesson: stack.lesson,
      court: stack.court,
      student,
      daysAgo: spec.daysAgo,
      idempotencyKey,
    });
    const { action } = await ensureReview({
      booking,
      coach: stack.coach,
      student,
      rating: spec.rating,
      comment: spec.comment,
      daysAgo: spec.daysAgo,
    });

    touchedCoachIds.add(stack.coach.id);
    results.push({
      coach: spec.coachEmailLocal,
      student: spec.studentName,
      status: action,
      rating: spec.rating,
      hasComment: Boolean(spec.comment && String(spec.comment).trim()),
    });
  }

  for (const coachId of touchedCoachIds) {
    await recalculateCoachRatingFromReviews(coachId);
  }

  console.log('\nSeeded coach reviews (reviewer password: Test1234!Ab):\n');
  for (const r of results) {
    console.log(
      `  ${r.coach} ← ${r.student}: ${r.status}${r.rating != null ? ` · ${r.rating}★${r.hasComment ? ' + comment' : ' (rating only)'}` : ` · ${r.detail}`}`,
    );
  }
  console.log('\nTry: open Piper Pinecrest (or other Pinecrest/Davie coaches) on Discover → profile → What students say.\n');
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌', err.message);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
