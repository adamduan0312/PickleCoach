/**
 * Seed C2 booking money-path fixtures (live Stripe test mode).
 *
 * Creates:
 *   A) Several pending + authorized bookings (API-only auth via pm_card_visa)
 *      → ready for coach PUT /bookings/:id/accept → capture + webhook
 *   B) Printed open slots for a full manual C2 run:
 *      intent → stripe-authorize-test.html → confirm → accept
 *
 * Prerequisites:
 *   - STRIPE_SECRET_KEY in .env.development
 *   - Backend + `stripe listen` for accept webhook (after raw-body fix)
 *
 * Run from backend/:
 *   npm run seed:c2-money-path
 *
 * Users (password Test1234!Ab unless you changed them):
 *   student: student.testflow@picklecoach.example.org (fallback student1@example.com)
 *   coach:   coach7@example.com (must be stripe_ready)
 */
import dotenv from 'dotenv';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY (sk_test_…) required for live C2 money-path seed');
  process.exit(1);
}

import bcrypt from 'bcryptjs';
import {
  sequelize,
  User,
  UserRole,
  CoachProfile,
  Lesson,
  CoachCourtLocation,
  CoachAvailability,
  CourtLocation,
} from '../models/index.js';
import stripe from '../services/stripeService.js';
import {
  createBookingIntent,
  confirmBookingFromPaymentIntent,
} from '../services/bookingIntentService.js';
import { getCoachMarketplaceEligibility } from '../services/coachMarketplaceEligibility.js';

const PASSWORD = 'Test1234!Ab';
const COACH_EMAIL = 'coach7@example.com';
const STUDENT_CANDIDATES = [
  'student.testflow@picklecoach.example.org',
  'student1@example.com',
];

const COUNT_AUTHORIZED = Number(process.env.C2_AUTHORIZED_COUNT || 3);
const COUNT_OPEN_SLOTS = Number(process.env.C2_OPEN_SLOTS || 3);

/**
 * Next occurrence of weekday (0=Sun…6=Sat) at hour:minute in America/New_York.
 */
function nextCoachLocalSlot({ weekday, hour, minute = 0, minDaysAhead = 1 }) {
  const tz = 'America/New_York';
  const now = Date.now();
  const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let dayOffset = minDaysAhead; dayOffset <= 28; dayOffset++) {
    const probe = new Date(now + dayOffset * 86400000);
    const ymdParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(probe);
    const wd = ymdParts.find((p) => p.type === 'weekday')?.value;
    if (weekdayShort.indexOf(wd) !== weekday) continue;

    const y = ymdParts.find((p) => p.type === 'year')?.value;
    const m = ymdParts.find((p) => p.type === 'month')?.value;
    const d = ymdParts.find((p) => p.type === 'day')?.value;
    const dayStartGuess = Date.parse(`${y}-${m}-${d}T12:00:00.000Z`);

    for (let offsetMin = -20 * 60; offsetMin <= 20 * 60; offsetMin += 15) {
      const candidate = new Date(dayStartGuess + offsetMin * 60 * 1000);
      const local = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
      }).formatToParts(candidate);
      const lY = local.find((p) => p.type === 'year')?.value;
      const lM = local.find((p) => p.type === 'month')?.value;
      const lD = local.find((p) => p.type === 'day')?.value;
      const lH = Number(local.find((p) => p.type === 'hour')?.value);
      const lMin = Number(local.find((p) => p.type === 'minute')?.value);
      const lWd = local.find((p) => p.type === 'weekday')?.value;
      if (
        lY === y &&
        lM === m &&
        lD === d &&
        lH === hour &&
        lMin === minute &&
        weekdayShort.indexOf(lWd) === weekday
      ) {
        return candidate;
      }
    }
  }
  throw new Error(
    `Could not find coach-local slot weekday=${weekday} ${hour}:${String(minute).padStart(2, '0')}`,
  );
}

function buildSlotPlan() {
  const specs = [
    { weekday: 1, hour: 10, minDaysAhead: 1 },
    { weekday: 2, hour: 11, minDaysAhead: 1 },
    { weekday: 3, hour: 14, minDaysAhead: 1 },
    { weekday: 4, hour: 10, minDaysAhead: 1 },
    { weekday: 5, hour: 15, minDaysAhead: 1 },
    { weekday: 1, hour: 14, minDaysAhead: 8 },
    { weekday: 2, hour: 10, minDaysAhead: 8 },
    { weekday: 3, hour: 11, minDaysAhead: 8 },
  ];
  const seen = new Set();
  const out = [];
  for (const s of specs) {
    const dt = nextCoachLocalSlot(s);
    const key = dt.toISOString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dt);
  }
  return out.sort((a, b) => a - b);
}

async function ensureStudent() {
  for (const email of STUDENT_CANDIDATES) {
    const user = await User.findOne({
      where: { email },
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    if (!user) continue;
    const roles = (user.userRoles || []).map((r) => r.role);
    if (!roles.includes('student')) {
      await UserRole.create({ user_id: user.id, role: 'student' });
    }
    await user.update({
      is_active: true,
      email_verified_at: user.email_verified_at || new Date(),
      timezone: user.timezone || 'America/New_York',
    });
    return user;
  }

  const password_hash = await bcrypt.hash(PASSWORD, 10);
  const user = await User.create({
    full_name: 'C2 Money Path Student',
    email: 'student.c2money@picklecoach.example.org',
    password_hash,
    phone: '555-0200',
    timezone: 'America/New_York',
    is_active: true,
    email_verified_at: new Date(),
  });
  await UserRole.create({ user_id: user.id, role: 'student' });
  return user;
}

async function ensureCoach() {
  const user = await User.findOne({
    where: { email: COACH_EMAIL },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  if (!user) {
    throw new Error(`Coach ${COACH_EMAIL} not found. Seed demo data / seed:coaches-pending-stripe first.`);
  }
  const roles = (user.userRoles || []).map((r) => r.role);
  if (!roles.includes('coach')) {
    await UserRole.create({ user_id: user.id, role: 'coach' });
  }
  await user.update({
    is_active: true,
    email_verified_at: user.email_verified_at || new Date(),
    timezone: user.timezone || 'America/New_York',
  });

  const profile = await CoachProfile.findOne({ where: { user_id: user.id, deleted_at: null } });
  if (!profile) {
    throw new Error(`No coach profile for ${COACH_EMAIL}`);
  }
  if (!profile.stripe_ready || !profile.stripe_account_id) {
    throw new Error(
      `${COACH_EMAIL} is not stripe_ready (stripe_ready=${profile.stripe_ready}, account=${profile.stripe_account_id}). ` +
        'Complete Connect onboarding first, or use a coach that is already stripe_ready.',
    );
  }

  let lesson = await Lesson.findOne({
    where: { coach_id: user.id, is_active: true, deleted_at: null },
    order: [['id', 'DESC']],
  });
  if (!lesson) {
    lesson = await Lesson.create({
      coach_id: user.id,
      title: 'C2 Money Path Lesson',
      description: 'Live Stripe test lesson for authorize → confirm → accept.',
      price: 55,
      duration_minutes: 60,
      max_students: 1,
      is_active: true,
    });
  }

  let link = await CoachCourtLocation.findOne({ where: { coach_id: user.id } });
  if (!link) {
    const court = await CourtLocation.create({
      name: 'C2 Money Path Court',
      address_line1: '1 Test Court Ln',
      city: 'Brooklyn',
      state: 'NY',
      postal_code: '11201',
      country: 'US',
      latitude: 40.7,
      longitude: -73.99,
      is_private: false,
      source: 'manual',
      created_by_user_id: user.id,
    });
    link = await CoachCourtLocation.create({ coach_id: user.id, court_id: court.id });
  }

  const availCount = await CoachAvailability.count({ where: { coach_id: user.id } });
  if (availCount === 0) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      await CoachAvailability.create({
        coach_id: user.id,
        weekday,
        start_time: '09:00:00',
        end_time: '17:00:00',
      });
    }
  }

  const eligibility = await getCoachMarketplaceEligibility(user.id);
  return { user, profile, lesson, courtId: link.court_id, eligibility };
}

async function authorizeIntentWithTestCard(paymentIntentId) {
  const pi = await stripe.paymentIntents.confirm(paymentIntentId, {
    payment_method: 'pm_card_visa',
    // Required when automatic_payment_methods allows redirect methods; card still settles to requires_capture.
    return_url: process.env.FRONTEND_URL
      ? `${String(process.env.FRONTEND_URL).split(',')[0].trim()}/stripe-authorize-test.html`
      : 'http://localhost:5173/stripe-authorize-test.html',
  });
  if (pi.status !== 'requires_capture') {
    throw new Error(`Expected requires_capture after confirm, got ${pi.status} for ${paymentIntentId}`);
  }
  return pi;
}

async function main() {
  await sequelize.authenticate();

  const student = await ensureStudent();
  const { user: coach, lesson, courtId, eligibility } = await ensureCoach();

  console.log('\n=== C2 actors ===');
  console.log(`Student: ${student.email} (id=${student.id})  password: ${PASSWORD}`);
  console.log(`Coach:   ${coach.email} (id=${coach.id})  password: ${PASSWORD}`);
  console.log(`Lesson:  id=${lesson.id}  price=$${lesson.price}  duration=${lesson.duration_minutes}m`);
  console.log(`Court:   id=${courtId}`);
  console.log(`Marketplace: listed=${eligibility.listed} missing=${JSON.stringify(eligibility.missing)}`);

  if (!eligibility.listed) {
    console.warn('\nWarning: coach is not fully marketplace-listed. Booking intents may still work if stripe_ready.');
  }

  const slots = buildSlotPlan();
  const authorizedBookings = [];
  const openSlots = [];

  let slotIdx = 0;
  let created = 0;
  let attempts = 0;
  while (created < COUNT_AUTHORIZED && slotIdx < slots.length && attempts < slots.length + 5) {
    attempts += 1;
    const scheduledAt = slots[slotIdx++];
    try {
      const intent = await createBookingIntent({
        studentId: student.id,
        studentRoles: ['student'],
        lessonId: lesson.id,
        scheduledAt: scheduledAt.toISOString(),
        courtLocationId: courtId,
        paymentMethod: 'stripe',
        idempotencyKey: `c2_money_${Date.now()}_${created}`,
      });

      await authorizeIntentWithTestCard(intent.payment_intent_id);

      const { booking, payment } = await confirmBookingFromPaymentIntent({
        studentId: student.id,
        paymentIntentId: intent.payment_intent_id,
      });

      authorizedBookings.push({
        booking_id: booking.id,
        payment_id: payment.id,
        payment_status: payment.payment_status,
        booking_status: booking.status,
        payment_intent_id: intent.payment_intent_id,
        scheduled_at: scheduledAt.toISOString(),
      });
      created += 1;
      console.log(`\n✓ Authorized booking #${booking.id} @ ${scheduledAt.toISOString()} (${intent.payment_intent_id})`);
    } catch (err) {
      console.error(`\n✗ Failed authorized slot ${scheduledAt.toISOString()}: ${err.message}`);
    }
  }

  while (openSlots.length < COUNT_OPEN_SLOTS && slotIdx < slots.length) {
    openSlots.push({
      scheduled_at: slots[slotIdx].toISOString(),
      lesson_id: lesson.id,
      court_location_id: courtId,
    });
    slotIdx += 1;
  }

  console.log('\n=== A) Ready for coach ACCEPT (pending + authorized) ===');
  if (authorizedBookings.length === 0) {
    console.log('(none created — check errors above)');
  } else {
    for (const b of authorizedBookings) {
      console.log(
        `  booking ${b.booking_id}  ${b.scheduled_at}  PI=${b.payment_intent_id}  → PUT /api/bookings/${b.booking_id}/accept`,
      );
    }
  }

  console.log('\n=== B) Open slots for FULL C2 (manual authorize page) ===');
  for (const s of openSlots) {
    console.log(
      JSON.stringify(
        {
          lesson_id: String(s.lesson_id),
          scheduled_at: s.scheduled_at,
          court_location_id: String(s.court_location_id),
          payment_method: 'stripe',
        },
        null,
        2,
      ),
    );
  }

  console.log(`
=== How to run C2 ===

0. Terminals:
   - npm run dev          (repo root: API :4000 + Vite)
   - stripe listen --forward-to localhost:4000/api/webhooks/stripe
   - STRIPE_WEBHOOK_SECRET must match the listen whsec_ (restart API after change)

1. Login student → token
   POST /api/auth/login  { "email": "${student.email}", "password": "${PASSWORD}" }

2a. FULL path (use an open slot from B):
   POST /api/booking-intents   (body above)
   Open http://localhost:5173/stripe-authorize-test.html
     pk_test_… + client_secret → 4242… → Authorize → requires_capture
   POST /api/bookings/confirm  { "payment_intent_id": "pi_…" }
   Expect: booking pending, payment authorized

2b. SKIP authorize UI (use a booking from A — already pending/authorized)

3. Login coach → accept
   POST /api/auth/login  { "email": "${coach.email}", "password": "${PASSWORD}" }
   PUT /api/bookings/<id>/accept
   Expect Stripe: succeeded/captured
   Expect local after webhook: payment captured, booking confirmed
   If webhook missed: npm run dev:simulate-capture -- --booking-id=<id>

Authorize page: frontend/public/stripe-authorize-test.html
`);

  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
