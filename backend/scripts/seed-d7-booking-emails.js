/**
 * Phase D Step 7 — booking lifecycle emails (SendGrid + real inboxes).
 *
 * Student: adamduan0312@gmail.com (must exist — register in app first)
 * Coach:   coach7@example.com user, inbox set to adamduan0312+coach@gmail.com
 *          (same Gmail inbox as student; two different user rows)
 *
 * Prerequisites:
 *   - SENDGRID_* in .env.development
 *   - coach7 stripe_ready (npm run seed:coaches-pending-stripe + Connect onboarding)
 *   - STRIPE_SECRET_KEY=sk_test_… for --with-pending
 *
 * Run from backend/:
 *   npm run seed:d7-booking-emails              # open slot for full manual C2 slice
 *   npm run seed:d7-booking-emails -- --with-pending   # also create pending booking (coach email fires)
 *
 * Password for both: Test1234!Ab (student uses your chosen password if you changed it)
 */
import dotenv from 'dotenv';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
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
} from '../models/index.js';
import stripe from '../services/stripeService.js';
import {
  createBookingIntent,
  confirmBookingFromPaymentIntent,
} from '../services/bookingIntentService.js';
import { getCoachMarketplaceEligibility } from '../services/coachMarketplaceEligibility.js';

const PASSWORD = 'Test1234!Ab';
const STUDENT_EMAIL = process.env.D7_STUDENT_EMAIL || 'adamduan0312@gmail.com';
const COACH_USER_EMAIL = 'coach7@example.com';
const COACH_INBOX_EMAIL = process.env.D7_COACH_INBOX || 'adamduan0312+coach@gmail.com';

const args = process.argv.slice(2);
const withPending = args.includes('--with-pending');
const keepCoachEmail = args.includes('--keep-coach-email');

/** Next occurrence of weekday (0=Sun…6=Sat) at hour:minute in America/New_York. */
function nextCoachLocalSlot({ weekday, hour, minute = 0, minDaysAhead = 2 }) {
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

async function ensureStudent() {
  const user = await User.findOne({
    where: { email: STUDENT_EMAIL },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  if (!user) {
    throw new Error(
      `Student ${STUDENT_EMAIL} not found. Register that account in the app first (Phase D student).`,
    );
  }
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

async function ensureCoachInbox() {
  const user = await User.findOne({
    where: { email: COACH_USER_EMAIL },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  if (!user) {
    throw new Error(`Coach user ${COACH_USER_EMAIL} not found. Run demo seeds first.`);
  }

  if (!keepCoachEmail && user.email !== COACH_INBOX_EMAIL) {
    const clash = await User.findOne({ where: { email: COACH_INBOX_EMAIL } });
    if (clash && clash.id !== user.id) {
      throw new Error(
        `${COACH_INBOX_EMAIL} is already used by user id=${clash.id}. Use --keep-coach-email or another D7_COACH_INBOX.`,
      );
    }
    await user.update({ email: COACH_INBOX_EMAIL });
    console.log(`\n✓ Coach login email updated: ${COACH_USER_EMAIL} → ${COACH_INBOX_EMAIL}`);
    console.log('  (Same Gmail inbox as student; still log in with this +coach address.)');
  }

  const profile = await CoachProfile.findOne({ where: { user_id: user.id, deleted_at: null } });
  if (!profile?.stripe_ready || !profile.stripe_account_id) {
    throw new Error(
      `${COACH_USER_EMAIL} is not stripe_ready. Complete Connect onboarding for coach7 first.`,
    );
  }

  const lesson = await Lesson.findOne({
    where: { coach_id: user.id, is_active: true, deleted_at: null },
    order: [['id', 'DESC']],
  });
  if (!lesson) {
    throw new Error(`No active lesson for coach id=${user.id}`);
  }

  const link = await CoachCourtLocation.findOne({ where: { coach_id: user.id } });
  if (!link) {
    throw new Error(`No court linked for coach id=${user.id}`);
  }

  const availCount = await CoachAvailability.count({ where: { coach_id: user.id } });
  if (availCount === 0) {
    throw new Error(`No availability rows for coach id=${user.id}`);
  }

  const eligibility = await getCoachMarketplaceEligibility(user.id);
  return { user, lesson, courtId: link.court_id, eligibility };
}

async function authorizeIntentWithTestCard(paymentIntentId) {
  const pi = await stripe.paymentIntents.confirm(paymentIntentId, {
    payment_method: 'pm_card_visa',
    return_url: process.env.FRONTEND_URL
      ? `${String(process.env.FRONTEND_URL).split(',')[0].trim()}/stripe-authorize-test.html`
      : 'http://localhost:5173/stripe-authorize-test.html',
  });
  if (pi.status !== 'requires_capture') {
    throw new Error(`Expected requires_capture, got ${pi.status} for ${paymentIntentId}`);
  }
  return pi;
}

async function createPendingAuthorizedBooking({ student, lesson, courtId, scheduledAt }) {
  const intent = await createBookingIntent({
    studentId: student.id,
    studentRoles: ['student'],
    lessonId: lesson.id,
    scheduledAt: scheduledAt.toISOString(),
    courtLocationId: courtId,
    paymentMethod: 'stripe',
    idempotencyKey: `d7_email_${Date.now()}`,
  });
  await authorizeIntentWithTestCard(intent.payment_intent_id);
  const { booking, payment } = await confirmBookingFromPaymentIntent({
    studentId: student.id,
    paymentIntentId: intent.payment_intent_id,
  });
  return { booking, payment, payment_intent_id: intent.payment_intent_id, scheduledAt };
}

async function main() {
  await sequelize.authenticate();

  const student = await ensureStudent();
  const { user: coach, lesson, courtId, eligibility } = await ensureCoachInbox();

  const scheduledAt = nextCoachLocalSlot({ weekday: 2, hour: 11, minDaysAhead: 3 });
  const intentBody = {
    lesson_id: lesson.id,
    scheduled_at: scheduledAt.toISOString(),
    court_location_id: courtId,
    payment_method: 'stripe',
    idempotency_key: `d7_manual_${Date.now()}`,
  };

  console.log('\n=== Phase D Step 7 — booking email actors ===');
  console.log(`Student (booking_confirmed inbox): ${student.email}  id=${student.id}`);
  console.log(`Coach   (booking_request inbox):   ${coach.email}  id=${coach.id}`);
  console.log(`Coach password: ${PASSWORD}  (unless you changed it)`);
  console.log(`Lesson: id=${lesson.id}  $${lesson.price}  court=${courtId}`);
  console.log(`Marketplace listed=${eligibility.listed} missing=${JSON.stringify(eligibility.missing)}`);
  console.log(`SendGrid from: ${process.env.SENDGRID_FROM_EMAIL || '(not set)'}`);

  let pendingBooking = null;
  if (withPending) {
    if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      throw new Error('--with-pending requires STRIPE_SECRET_KEY=sk_test_…');
    }
    const slot2 = nextCoachLocalSlot({ weekday: 3, hour: 14, minDaysAhead: 4 });
    console.log('\nCreating pending authorized booking (fires coach email now)…');
    pendingBooking = await createPendingAuthorizedBooking({
      student,
      lesson,
      courtId,
      scheduledAt: slot2,
    });
    console.log(
      `✓ Booking ${pendingBooking.booking.id} pending @ ${slot2.toISOString()} — check inbox for "New booking request — PickleCoach"`,
    );
  }

  console.log('\n=== Open slot — full manual flow (student JWT) ===');
  console.log(JSON.stringify(intentBody, null, 2));

  console.log(`
=== Step 7 checklist ===

A) Coach email — booking_request_coach
   ${withPending ? 'Already sent if --with-pending (check Gmail + SendGrid Activity).' : 'After you confirm a new booking:'}
   1. POST /api/booking-intents  (body above)
   2. Authorize: stripe-authorize-test.html or pm_card_visa CLI
   3. POST /api/bookings/confirm  { "payment_intent_id": "pi_…" }
   Expect: coach inbox (${coach.email}) — subject "New booking request — PickleCoach"
   DB: notifications type=booking_request_coach channel=email status=sent

B) Student email — booking_confirmed
   4. Login coach (${coach.email}) → PUT /api/bookings/:id/accept
   Expect: student inbox (${student.email}) — subject "Booking Confirmed"
   DB: notifications type=booking_confirmed channel=email status=sent

C) Optional decline/cancel emails
   Decline pending → student gets booking_declined
   Cancel confirmed → booking_cancelled (who gets email depends on who cancelled)

Note: You cannot use ${STUDENT_EMAIL} as both student and coach on one account.
     Coach uses ${coach.email} — same Gmail if +coach alias.

${pendingBooking ? `Quick accept now: PUT /api/bookings/${pendingBooking.booking.id}/accept (coach token)` : ''}
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
