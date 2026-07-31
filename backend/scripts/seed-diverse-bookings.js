/**
 * Additive seed: create lessons + bookings across **different** demo coaches
 * and students for endpoint testing. Does **not** wipe or modify existing bookings.
 *
 * Uses demo users when present (`coachN@example.com` / `studentN@example.com`).
 * Ensures each selected coach has a court link, availability, stripe_ready, and
 * at least one active lesson before creating bookings.
 *
 * Usage (from backend/):
 *   npm run seed:diverse-bookings
 *   node scripts/seed-diverse-bookings.js --pairs=5
 *   node scripts/seed-diverse-bookings.js --coach-count=4 --student-count=6
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  Booking,
  Lesson,
  User,
  UserRole,
  CoachProfile,
  CoachAvailability,
  CoachCourtLocation,
  CourtLocation,
  Payment,
  Dispute,
  DisputeType,
} from '../models/index.js';
import { ACTIVE_DISPUTE_TYPE_CODES } from '../utils/disputeTypeCatalog.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const dayMs = 24 * 60 * 60 * 1000;
const minMs = 60 * 1000;

const getArg = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
};

const parseIntArg = (name, fallback) => {
  const raw = getArg(name);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
};

const idemKey = (label) =>
  `seed_diverse_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const LESSON_TEMPLATES = [
  { title: 'Beginner Dinks & Soft Game', price: 65, duration_minutes: 60 },
  { title: 'Intermediate Kitchen Strategy', price: 80, duration_minutes: 60 },
  { title: 'Advanced Third-Shot Drop', price: 95, duration_minutes: 90 },
  { title: 'Serve & Return Clinic', price: 70, duration_minutes: 45 },
  { title: 'Singles Footwork Intensive', price: 85, duration_minutes: 60 },
  { title: 'Doubles Positioning Drill', price: 75, duration_minutes: 60 },
];

/** One booking spec per coach×student pair (rotated by pair index). */
const BOOKING_SPECS = [
  {
    key: 'pending',
    status: 'pending',
    payout_status: 'none',
    messaging_locked: true,
    offsetDays: 8,
    payment: { paymentStatus: 'authorized', escrowStatus: 'held' },
  },
  {
    key: 'confirmed',
    status: 'confirmed',
    payout_status: 'none',
    messaging_locked: false,
    offsetDays: 12,
    payment: { paymentStatus: 'captured', escrowStatus: 'held' },
  },
  {
    key: 'awaiting_verification',
    status: 'awaiting_verification',
    payout_status: 'awaiting_verification',
    messaging_locked: false,
    endedMinutesAgo: 45,
    payment: { paymentStatus: 'captured', escrowStatus: 'held' },
  },
  {
    key: 'completed',
    status: 'completed',
    payout_status: 'paid',
    messaging_locked: false,
    offsetDays: -10,
    payment: { paymentStatus: 'captured', escrowStatus: 'released' },
  },
  {
    key: 'cancelled',
    status: 'cancelled',
    payout_status: 'none',
    messaging_locked: true,
    offsetDays: 15,
    cancelled_by: 'student',
    payment: null,
  },
  {
    key: 'disputed',
    status: 'disputed',
    payout_status: 'none',
    messaging_locked: true,
    offsetDays: -4,
    openDispute: true,
    payment: { paymentStatus: 'captured', escrowStatus: 'held' },
  },
  {
    key: 'student_no_show',
    status: 'student_no_show',
    payout_status: 'forfeited',
    messaging_locked: true,
    offsetDays: -3,
    payment: { paymentStatus: 'captured', escrowStatus: 'held' },
  },
  {
    key: 'coach_no_show',
    status: 'coach_no_show',
    payout_status: 'forfeited',
    messaging_locked: true,
    offsetDays: -5,
    payment: { paymentStatus: 'captured', escrowStatus: 'held' },
  },
];

async function findDemoCoaches(limit) {
  const coaches = await User.findAll({
    where: {
      email: { [Op.like]: 'coach%@example.com' },
      is_active: true,
      deleted_at: null,
    },
    include: [
      { model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true, attributes: ['role'] },
      { model: CoachProfile, as: 'coachProfile', required: false },
    ],
    order: [['id', 'ASC']],
    limit,
  });
  return coaches.filter((c) => {
    const roles = (c.userRoles || []).map((r) => r.role);
    return roles.includes('coach') && !roles.includes('admin');
  });
}

async function findDemoStudents(limit) {
  return User.findAll({
    where: {
      email: { [Op.like]: 'student%@example.com' },
      is_active: true,
      deleted_at: null,
    },
    include: [
      { model: UserRole, as: 'userRoles', where: { role: 'student' }, required: true, attributes: ['role'] },
    ],
    order: [['id', 'ASC']],
    limit,
  });
}

async function ensureCoachStack(coach, templateIndex) {
  let profile = coach.coachProfile;
  if (!profile) {
    profile = await CoachProfile.create({
      user_id: coach.id,
      headline: `${coach.full_name} — Pickleball Coach`,
      bio: 'Seeded for diverse booking endpoint tests.',
      experience_years: 3 + (coach.id % 5),
      skill_rating: 3.5,
      rating_system: 'self',
      rating_average: 4.5,
      rating_count: 0,
      location: 'New York',
      coach_commission_percent: 92.0,
      stripe_account_id: `acct_diverse_${coach.id}`,
      stripe_ready: true,
      stripe_onboarding_completed_at: new Date(),
    });
  } else if (!profile.stripe_ready) {
    await profile.update({
      stripe_ready: true,
      stripe_account_id: profile.stripe_account_id || `acct_diverse_${coach.id}`,
      stripe_onboarding_completed_at: profile.stripe_onboarding_completed_at || new Date(),
    });
  }

  let link = await CoachCourtLocation.findOne({
    where: { coach_id: coach.id },
    include: [
      {
        model: CourtLocation,
        as: 'court',
        where: { deleted_at: null },
        required: true,
        attributes: ['id', 'name'],
      },
    ],
    order: [['id', 'ASC']],
  });

  let court;
  if (link?.court) {
    court = link.court;
  } else {
    court = await CourtLocation.create({
      name: `${coach.full_name} Practice Court`,
      address_line1: `${100 + coach.id} Court St`,
      city: 'New York',
      state: 'NY',
      postal_code: '10001',
      country: 'US',
      latitude: 40.71 + coach.id * 0.001,
      longitude: -74.0 - coach.id * 0.001,
      is_private: false,
      source: 'manual',
      created_by_user_id: coach.id,
    });
    await CoachCourtLocation.create({ coach_id: coach.id, court_id: court.id });
  }

  const availCount = await CoachAvailability.count({ where: { coach_id: coach.id } });
  if (availCount === 0) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      await CoachAvailability.create({
        coach_id: coach.id,
        weekday,
        start_time: '09:00:00',
        end_time: '17:00:00',
      });
    }
  }

  let lessons = await Lesson.findAll({
    where: { coach_id: coach.id, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
  });

  if (lessons.length === 0) {
    const t1 = LESSON_TEMPLATES[templateIndex % LESSON_TEMPLATES.length];
    const t2 = LESSON_TEMPLATES[(templateIndex + 1) % LESSON_TEMPLATES.length];
    const created = [];
    for (const t of [t1, t2]) {
      created.push(
        await Lesson.create({
          coach_id: coach.id,
          title: t.title,
          description: `Seed lesson for ${coach.full_name} — diverse booking tests.`,
          price: t.price,
          duration_minutes: t.duration_minutes,
          max_students: 1,
          is_active: true,
        }),
      );
    }
    lessons = created;
  }

  return { court, lessons };
}

async function createNoStripePayment(
  booking,
  { paymentStatus = 'captured', escrowStatus = 'held' } = {},
  options = {},
) {
  const price = Number(booking.price);
  return Payment.create(
    {
      booking_id: booking.id,
      coach_id: booking.coach_id,
      student_id: booking.primary_student_id,
      lesson_price: price.toFixed(2),
      platform_fee_percent: 8.0,
      platform_fee_amount: ((price * 8) / 100).toFixed(2),
      total_charge_to_student: Number(price).toFixed(2),
      coach_payout_expected: ((price * 92) / 100).toFixed(2),
      escrow_status: escrowStatus,
      payment_status: paymentStatus,
      payment_method: 'stripe',
      currency: 'USD',
      payment_intent_id: null,
      charge_id: null,
    },
    options,
  );
}

function scheduledAtForSpec(spec, lesson, now, staggerHours) {
  if (spec.endedMinutesAgo != null) {
    const endMs = now - spec.endedMinutesAgo * minMs - staggerHours * 60 * minMs;
    return new Date(endMs - lesson.duration_minutes * minMs);
  }
  return new Date(now + spec.offsetDays * dayMs + staggerHours * 60 * minMs);
}

async function main() {
  const coachCount = parseIntArg('coach-count', 5);
  const studentCount = parseIntArg('student-count', 6);
  const pairCount = parseIntArg('pairs', Math.min(coachCount, studentCount));

  try {
    await sequelize.authenticate();

    const disputeType = await DisputeType.findOne({
      where: { code: ACTIVE_DISPUTE_TYPE_CODES[0] },
    });
    if (!disputeType) {
      console.error(
        `No active dispute type "${ACTIVE_DISPUTE_TYPE_CODES[0]}". Run migrations first.`,
      );
      process.exit(1);
    }

    const beforeCount = await Booking.count();
    const coaches = await findDemoCoaches(coachCount);
    const students = await findDemoStudents(studentCount);

    if (coaches.length === 0) {
      console.error('No demo coaches (coachN@example.com) found. Run npm run db:seed first.');
      process.exit(1);
    }
    if (students.length === 0) {
      console.error('No demo students (studentN@example.com) found. Run npm run db:seed first.');
      process.exit(1);
    }

    const stacks = [];
    for (let i = 0; i < coaches.length; i++) {
      stacks.push({
        coach: coaches[i],
        ...(await ensureCoachStack(coaches[i], i)),
      });
    }

    const pairs = Math.min(pairCount, stacks.length, students.length);
    const created = [];
    const now = Date.now();

    await sequelize.transaction(async (t) => {
      const opts = { transaction: t };

      for (let i = 0; i < pairs; i++) {
        const { coach, court, lessons } = stacks[i];
        const student = students[i];
        if (student.id === coach.id) continue;

        // Two bookings per pair: different statuses + lessons for variety.
        const specs = [
          BOOKING_SPECS[i % BOOKING_SPECS.length],
          BOOKING_SPECS[(i + 3) % BOOKING_SPECS.length],
        ];

        for (let j = 0; j < specs.length; j++) {
          const spec = specs[j];
          const lesson = lessons[j % lessons.length];
          const scheduledAt = scheduledAtForSpec(spec, lesson, now, i * 2 + j);

          const booking = await Booking.create(
            {
              lesson_id: lesson.id,
              coach_id: coach.id,
              primary_student_id: student.id,
              scheduled_at: scheduledAt,
              duration_minutes: lesson.duration_minutes,
              price: lesson.price,
              court_location_id: court.id,
              status: spec.status,
              payout_status: spec.payout_status,
              messaging_locked: spec.messaging_locked ?? false,
              cancelled_by: spec.cancelled_by ?? null,
              cancelled_at: spec.cancelled_by ? new Date() : null,
              idempotency_key: idemKey(`${spec.key}_c${coach.id}_s${student.id}_${j}`),
            },
            opts,
          );

          let paymentId = null;
          if (spec.payment) {
            const payment = await createNoStripePayment(booking, spec.payment, opts);
            paymentId = payment.id;
          }

          let disputeId = null;
          if (spec.openDispute) {
            const dispute = await Dispute.create(
              {
                booking_id: booking.id,
                dispute_type_id: disputeType.id,
                opened_by: 'student',
                status: 'under_review',
              },
              opts,
            );
            disputeId = dispute.id;
          }

          created.push({
            booking_id: booking.id,
            status: booking.status,
            coach_id: coach.id,
            coach_email: coach.email,
            student_id: student.id,
            student_email: student.email,
            lesson_id: lesson.id,
            lesson_title: lesson.title,
            scheduled_at: booking.scheduled_at,
            payment_id: paymentId,
            dispute_id: disputeId,
          });
        }
      }
    });

    const afterCount = await Booking.count();
    const lessonSummary = stacks.map((s) => ({
      coach_id: s.coach.id,
      coach_email: s.coach.email,
      lessons: s.lessons.map((l) => ({ id: l.id, title: l.title, price: l.price })),
      court_id: s.court.id,
    }));

    console.log('Diverse bookings seeded (existing bookings preserved):');
    console.log(
      JSON.stringify(
        {
          bookings_before: beforeCount,
          bookings_created: created.length,
          bookings_after: afterCount,
          pairs,
          coach_stacks: lessonSummary,
          bookings: created,
          login_hint: {
            coaches: 'coach1@example.com … coachN@example.com / Test1234!Ab',
            students: 'student1@example.com … studentN@example.com / Test1234!Ab',
          },
        },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed diverse bookings:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
