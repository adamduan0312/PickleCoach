/**
 * Timezone end-to-end QA setup: coach and student in deliberately different zones.
 *
 * Default (scenario 1):  coach America/Chicago, student America/Los_Angeles
 * --reverse (scenario 2): coach America/Los_Angeles, student America/Chicago
 *
 * Ensures the coach is bookable (verified, active, Stripe-ready, active lesson,
 * linked court) and has a Monday 09:00–17:00 recurring window. Does not create a
 * booking — the student books through the UI.
 *
 * Run (from backend/):
 *   NODE_ENV=development npm run seed:timezone-qa
 *   NODE_ENV=development npm run seed:timezone-qa -- --reverse
 *
 * Optional: COACH_EMAIL, STUDENT_EMAIL
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  User,
  UserRole,
  CoachProfile,
  Lesson,
  CoachAvailability,
  CoachCourtLocation,
  CourtLocation,
  Booking,
} from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const COACH_EMAIL = process.env.COACH_EMAIL || 'adamduan0312+coach@gmail.com';
const STUDENT_EMAIL = process.env.STUDENT_EMAIL || 'adamduan0312@gmail.com';
const CHICAGO = 'America/Chicago';
const LOS_ANGELES = 'America/Los_Angeles';
const reverse = process.argv.includes('--reverse');
const COACH_TZ = reverse ? LOS_ANGELES : CHICAGO;
const STUDENT_TZ = reverse ? CHICAGO : LOS_ANGELES;
const MONDAY = 1;

async function findUserWithRoles(email) {
  const user = await User.findOne({
    where: { email },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  if (!user) throw new Error(`User not found: ${email}`);
  return user;
}

async function ensureRole(user, role, transaction) {
  const roles = (user.userRoles || []).map((r) => r.role);
  if (!roles.includes(role)) {
    await UserRole.create({ user_id: user.id, role }, { transaction });
  }
}

async function ensureAccountReady(user, timezone, transaction) {
  user.timezone = timezone;
  user.is_active = true;
  if (!user.email_verified_at) user.email_verified_at = new Date();
  await user.save({ transaction });
}

async function ensureCoachBookable(coach, transaction) {
  const profile = await CoachProfile.findOne({ where: { user_id: coach.id, deleted_at: null }, transaction });
  if (!profile) throw new Error(`${COACH_EMAIL} has no coach profile`);
  if (!profile.stripe_ready || !profile.stripe_account_id) {
    throw new Error(`${COACH_EMAIL} is not Stripe-ready (needs stripe_account_id + stripe_ready)`);
  }

  let lesson = await Lesson.findOne({
    where: { coach_id: coach.id, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
    transaction,
  });
  if (!lesson) {
    lesson = await Lesson.create(
      {
        coach_id: coach.id,
        title: 'Private Lesson',
        description: 'Seeded for timezone QA.',
        duration_minutes: 60,
        price: 55,
        max_students: 1,
        is_active: true,
      },
      { transaction },
    );
  }

  const courtLink = await CoachCourtLocation.findOne({
    where: { coach_id: coach.id },
    include: [{ model: CourtLocation, as: 'court', where: { deleted_at: null }, required: true }],
    transaction,
  });
  if (!courtLink) throw new Error(`${COACH_EMAIL} has no linked court`);

  const [monday] = await CoachAvailability.findOrCreate({
    where: { coach_id: coach.id, weekday: MONDAY, start_time: '09:00:00', end_time: '17:00:00' },
    defaults: { coach_id: coach.id, weekday: MONDAY, start_time: '09:00:00', end_time: '17:00:00' },
    transaction,
  });
  if (monday.start_date || monday.end_date) {
    monday.start_date = null;
    monday.end_date = null;
    await monday.save({ transaction });
  }

  return { profile, lesson, court: courtLink.court };
}

/** Next Monday strictly after today, as YYYY-MM-DD in the coach's zone. */
function nextMondayInZone(timeZone) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  const add = ((MONDAY - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

function wallTimeToUtc(dateStr, hour, timeZone) {
  const guess = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(guess).map((p) => [p.type, p.value]),
  );
  const asZoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asZoned - guess.getTime()));
}

function fmt(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

async function main() {
  await sequelize.authenticate();
  const coach = await findUserWithRoles(COACH_EMAIL);
  const student = await findUserWithRoles(STUDENT_EMAIL);

  let setup;
  await sequelize.transaction(async (transaction) => {
    await ensureRole(coach, 'coach', transaction);
    await ensureRole(student, 'student', transaction);
    await ensureAccountReady(coach, COACH_TZ, transaction);
    await ensureAccountReady(student, STUDENT_TZ, transaction);
    setup = await ensureCoachBookable(coach, transaction);
  });

  const mondayDate = nextMondayInZone(COACH_TZ);
  const windowStart = wallTimeToUtc(mondayDate, 9, COACH_TZ);
  const windowEnd = wallTimeToUtc(mondayDate, 17, COACH_TZ);
  const slot = wallTimeToUtc(mondayDate, 10, COACH_TZ);

  const slotTaken = await Booking.findOne({
    where: {
      coach_id: coach.id,
      scheduled_at: slot,
      status: { [Op.notIn]: ['cancelled', 'declined', 'expired'] },
    },
  });

  const availability = await CoachAvailability.findAll({
    where: { coach_id: coach.id },
    order: [['weekday', 'ASC'], ['start_time', 'ASC']],
  });

  console.log(`\n=== Timezone QA ready (${reverse ? 'scenario 2: reverse' : 'scenario 1'}) ===\n`);
  console.log(`Coach:   ${COACH_EMAIL} (id=${coach.id}) → ${COACH_TZ}`);
  console.log(`Student: ${STUDENT_EMAIL} (id=${student.id}) → ${STUDENT_TZ}`);
  console.log(`Lesson:  #${setup.lesson.id} "${setup.lesson.title}" (${setup.lesson.duration_minutes} min, $${setup.lesson.price})`);
  console.log(`Court:   #${setup.court.id} ${setup.court.name}`);
  console.log(`Stripe:  ${setup.profile.stripe_account_id} (ready)`);
  console.log('Recurring availability (coach wall-clock):');
  for (const a of availability) {
    console.log(`  weekday ${a.weekday}  ${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)}`);
  }
  console.log(`\nNext Monday (${mondayDate}):`);
  console.log(`  Window  coach:   ${fmt(windowStart, COACH_TZ)} – ${fmt(windowEnd, COACH_TZ)}`);
  console.log(`          student: ${fmt(windowStart, STUDENT_TZ)} – ${fmt(windowEnd, STUDENT_TZ)}`);
  console.log(`  Slot    coach:   ${fmt(slot, COACH_TZ)}`);
  console.log(`          student: ${fmt(slot, STUDENT_TZ)}`);
  console.log(`          UTC:     ${slot.toISOString()}  ← expected bookings.scheduled_at`);
  if (slotTaken) console.log(`  ⚠ That slot is already taken by booking #${slotTaken.id} (${slotTaken.status})`);
  console.log('');
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('seed-timezone-qa failed:', err.message);
    try { await sequelize.close(); } catch { /* ignore */ }
    process.exit(1);
  });
