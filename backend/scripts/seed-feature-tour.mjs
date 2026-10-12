/**
 * Small, re-runnable data set for clicking through every part of the web app.
 *
 * Creates its own `tour.*@picklecoach.example.org` accounts (never touches your own or the testflow
 * accounts), clears everything those accounts booked on a previous run, then books lessons through
 * the real API + Stripe test checkout and moves them into each state:
 *
 *   pending request · declined · confirmed with chat · weather request · late student cancel (50%)
 *   · completed + reviewed · completed awaiting review · open issue report
 *
 * Coaches: Maya (listed, reviews, photos), Leo (listed, no bookings), Nina (not listed yet — checklist).
 * Tour payments are tagged `qa_fixture` so the payout worker never tries to transfer to the fake
 * Stripe accounts.
 *
 * Usage (from backend/, API on :4000): node scripts/seed-feature-tour.mjs
 * Password for every tour account: Test1234!Ab · Admin: admin.testflow@picklecoach.example.org
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });
if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const API = process.env.QA_API_URL || 'http://localhost:4000/api';
const APP = 'http://localhost:5173';
const PASSWORD = 'Test1234!Ab';
const DOMAIN = 'picklecoach.example.org';
const TZ = 'America/New_York';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const {
  sequelize, User, UserRole, CoachProfile, CoachAvailability, CoachCourtLocation, CourtLocation, Lesson, Booking, Payment,
} = await import('../models/index.js');
const { updateUserReliability } = await import('../services/reliabilityService.js');
const { SEED_COACH_AVATAR_URL } = await import('../utils/seedCoachAvatar.cjs');
sequelize.options.logging = false;

const PEOPLE = {
  sam: { email: `tour.student@${DOMAIN}`, full_name: 'Sam Rivera', roles: ['student'] },
  jordan: { email: `tour.student2@${DOMAIN}`, full_name: 'Jordan Lee', roles: ['student'] },
  maya: { email: `tour.coach@${DOMAIN}`, full_name: 'Maya Torres', roles: ['coach'] },
  leo: { email: `tour.coach2@${DOMAIN}`, full_name: 'Leo Park', roles: ['coach'] },
  nina: { email: `tour.newcoach@${DOMAIN}`, full_name: 'Nina Patel', roles: ['coach'] },
};
const MIAMI_COURTS = ['Salvadore Park', 'Douglas Park', 'Royal Palm Tennis Club'];

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function must(label, promise, ok = [200, 201]) {
  const res = await promise;
  if (!ok.includes(res.status)) throw new Error(`${label} failed: ${res.status} ${res.json.message || JSON.stringify(res.json).slice(0, 200)}`);
  return res.json;
}

const tokens = {};
async function token(key) {
  if (!tokens[key]) {
    const json = await must(`Login ${key}`, api('POST', '/auth/login', { body: { email: PEOPLE[key].email, password: PASSWORD } }));
    tokens[key] = json.data.token;
  }
  return tokens[key];
}

/** `daysOut` days ahead at `hour`:00 New York time, as an ISO string. */
function slot(daysOut, hour) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + daysOut * 86400000));
  const guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess).map((x) => [x.type, x.value]));
  return new Date(guess.getTime() - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess.getTime())).toISOString();
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600000);

async function upsertUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const users = {};
  for (const [key, p] of Object.entries(PEOPLE)) {
    let user = await User.findOne({ where: { email: p.email }, paranoid: false });
    const fields = {
      full_name: p.full_name, password_hash: passwordHash, timezone: TZ, is_active: true,
      email_verified_at: new Date(), deleted_at: null,
      avatar_url: p.roles.includes('coach') ? SEED_COACH_AVATAR_URL : null,
    };
    if (user) await user.update(fields);
    else user = await User.create({ email: p.email, ...fields });
    for (const role of p.roles) await UserRole.findOrCreate({ where: { user_id: user.id, role } });
    users[key] = user;
  }
  return users;
}

async function clearTourBookings(userIds) {
  const [rows] = await sequelize.query(
    `SELECT b.id, p.payment_intent_id, p.payment_status FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.coach_id IN (:userIds) OR b.primary_student_id IN (:userIds)`,
    { replacements: { userIds } },
  );
  for (const r of rows) {
    if (r.payment_intent_id && ['authorized', 'pending'].includes(r.payment_status)) {
      try { await stripe.paymentIntents.cancel(r.payment_intent_id); } catch { /* already released */ }
    }
  }
  const ids = [...new Set(rows.map((r) => r.id))];
  await sequelize.transaction(async (t) => {
    const q = (sql, replacements = { ids }) => sequelize.query(sql, { replacements, transaction: t });
    if (ids.length) {
      await q('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE booking_id IN (:ids))');
      await q('DELETE FROM conversation_reads WHERE conversation_id IN (SELECT id FROM conversations WHERE booking_id IN (:ids))');
      await q('DELETE FROM conversations WHERE booking_id IN (:ids)');
      await q('DELETE FROM weather_cancellation_requests WHERE booking_id IN (:ids)');
      await q('DELETE FROM reviews WHERE booking_id IN (:ids)');
      await q('DELETE FROM student_feedback WHERE booking_id IN (:ids)');
      await q('DELETE FROM system_jobs WHERE related_booking_id IN (:ids)');
      await q('DELETE FROM payment_actions WHERE booking_id IN (:ids)');
      await q('DELETE FROM payouts WHERE payment_id IN (SELECT id FROM payments WHERE booking_id IN (:ids))');
      await q('DELETE FROM cancellation_history WHERE booking_id IN (:ids)');
      await q('DELETE FROM payments WHERE booking_id IN (:ids)');
      await q('DELETE FROM disputes WHERE booking_id IN (:ids)');
      await q('DELETE FROM booking_players WHERE booking_id IN (:ids)');
      await q('DELETE FROM bookings WHERE id IN (:ids)');
    }
    await q('DELETE FROM notifications WHERE user_id IN (:userIds)', { userIds });
  });
  return ids.length;
}

async function setUpCoaches(users) {
  const { maya, leo, nina } = users;
  const courts = await CourtLocation.findAll({ where: { name: MIAMI_COURTS, deleted_at: null } });
  if (courts.length < 2) throw new Error(`Expected Miami courts ${MIAMI_COURTS.join(', ')} to exist`);

  const coachIds = [maya.id, leo.id, nina.id];
  await CoachAvailability.destroy({ where: { coach_id: coachIds } });
  await CoachCourtLocation.destroy({ where: { coach_id: coachIds } });
  await Lesson.destroy({ where: { coach_id: coachIds }, force: true });
  await sequelize.query('DELETE FROM coach_photos WHERE coach_id IN (:coachIds)', { replacements: { coachIds } });

  const profiles = {
    [maya.id]: {
      headline: 'Former college tennis player turned pickleball coach',
      bio: 'I help beginners and intermediate players build a reliable third-shot drop, cleaner dinks, and smarter court positioning. Every lesson ends with a short drill plan you can practice on your own.',
      experience_years: 8, skill_rating: 4.6, rating_system: 'DUPR', location: 'Coral Gables, FL',
      certifications: ['PPR Certified Coach', 'IPTPA Level II'],
      stripe_account_id: 'acct_tour_maya', stripe_ready: true, stripe_onboarding_completed_at: new Date(),
    },
    [leo.id]: {
      headline: 'Competitive doubles strategy and drilling',
      bio: 'Tournament player focused on doubles strategy: stacking, transition-zone defense, and attacking the middle. Best for players around 3.5 who want to compete.',
      experience_years: 4, skill_rating: 9.5, rating_system: 'UTR-P', location: 'Miami, FL', certifications: null,
      stripe_account_id: 'acct_tour_leo', stripe_ready: true, stripe_onboarding_completed_at: new Date(),
    },
    [nina.id]: {
      headline: 'New coach — fundamentals for first-timers',
      bio: 'Just getting started on PickleCoach. I teach first-time players the rules, scoring, and the basic strokes in a relaxed setting.',
      experience_years: 1, skill_rating: null, rating_system: null, location: 'Miami Beach, FL', certifications: null,
      stripe_account_id: null, stripe_ready: false, stripe_onboarding_completed_at: null,
    },
  };
  for (const [userId, fields] of Object.entries(profiles)) {
    const [profile] = await CoachProfile.findOrCreate({ where: { user_id: Number(userId) }, defaults: { user_id: Number(userId) } });
    await profile.update({ ...fields, rating_average: 0, rating_count: 0, deleted_at: null });
  }

  // Maya and Leo are bookable all week so you can also try checkout yourself; Nina has nothing yet.
  for (const coach of [maya, leo]) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      await CoachAvailability.create({ coach_id: coach.id, weekday, start_time: '07:00:00', end_time: '21:00:00' });
    }
  }
  await CoachCourtLocation.bulkCreate(courts.slice(0, 2).map((c) => ({ coach_id: maya.id, court_id: c.id })));
  await CoachCourtLocation.create({ coach_id: leo.id, court_id: courts[courts.length - 1].id });

  const mayaLessons = await Lesson.bulkCreate([
    { coach_id: maya.id, title: 'Fundamentals private lesson', description: 'Grip, dinks, drops, and serve/return basics.', price: 60, duration_minutes: 60, lesson_type: 'private', max_students: 1, is_active: true },
    { coach_id: maya.id, title: 'Small-group drills', description: 'Bring up to 3 friends for a high-rep drill session.', price: 90, duration_minutes: 90, lesson_type: 'group', max_students: 1, max_players: 4, is_active: true },
  ]);
  await Lesson.create({ coach_id: leo.id, title: 'Doubles strategy session', description: 'Stacking, transition zone, and attacking the middle.', price: 75, duration_minutes: 60, lesson_type: 'private', max_students: 1, is_active: true });

  const photoDir = 'uploads/coach-photos';
  const sample = existsSync(photoDir) ? readdirSync(photoDir).find((f) => /\.(png|jpe?g|webp)$/i.test(f)) : null;
  if (sample) {
    for (const position of [0, 1]) {
      const name = `tour-maya-${position}${sample.slice(sample.lastIndexOf('.'))}`;
      copyFileSync(`${photoDir}/${sample}`, `${photoDir}/${name}`);
      await sequelize.query(
        'INSERT INTO coach_photos (coach_id, url, position, created_at) VALUES (:coachId, :url, :position, NOW())',
        { replacements: { coachId: maya.id, url: `/uploads/coach-photos/${name}`, position } },
      );
    }
  }
  return { lesson: mayaLessons[0], courtId: courts[0].id };
}

/** Real checkout: booking intent → Stripe test card authorization → confirm. Returns the booking id. */
async function checkout(studentKey, lesson, courtId, scheduledAt) {
  const t = await token(studentKey);
  const attemptId = randomUUID();
  const intent = await must('Booking intent', api('POST', '/booking-intents', {
    token: t,
    headers: { 'Idempotency-Key': attemptId },
    body: { lesson_id: lesson.id, scheduled_at: scheduledAt, court_location_id: courtId, payment_method: 'stripe', booking_attempt_id: attemptId },
  }));
  const piId = intent.data.payment_intent_id;
  await stripe.paymentIntents.confirm(piId, { payment_method: 'pm_card_visa', return_url: APP });
  const confirmed = await must('Booking confirm', api('POST', '/bookings/confirm', { token: t, body: { payment_intent_id: piId } }));
  const bookingId = confirmed.data.booking.id;
  const payment = await Payment.findOne({ where: { booking_id: bookingId } });
  if (payment) await payment.update({ metadata: { ...(payment.metadata || {}), qa_fixture: true } });
  return bookingId;
}

const accept = async (id) => must('Accept', api('PUT', `/bookings/${id}/accept`, { token: await token('maya') }));
const moveTo = (id, when) => Booking.update({ scheduled_at: when }, { where: { id } });
const complete = async (id) => must('Complete', api('POST', `/bookings/${id}/complete`, { token: await token('maya'), body: {} }));

async function chat(bookingId, lines) {
  for (const [who, text] of lines) {
    const t = await token(who);
    const conv = await must('Conversation', api('POST', '/messages/conversations', { token: t, body: { booking_id: bookingId } }));
    const conversationId = conv.data?.id ?? conv.data?.conversation?.id;
    await must('Send message', api('POST', '/messages/send', { token: t, body: { conversation_id: conversationId, message_text: text } }));
  }
}

async function main() {
  const users = await upsertUsers();
  const userIds = Object.values(users).map((u) => u.id);
  const cleared = await clearTourBookings(userIds);
  const { lesson, courtId } = await setUpCoaches(users);
  console.log(`Tour accounts ready${cleared ? `; cleared ${cleared} booking(s) from the last run` : ''}. Booking lessons…`);

  const made = [];
  const add = (id, what) => made.push({ id, what });

  // Checkout needs ≥2h notice and a free slot, so book days out first, then move lessons into the state under test.
  const pending = await checkout('sam', lesson, courtId, slot(3, 10));
  add(pending, 'Pending — waiting for Maya to accept (coach dashboard: Incoming requests)');

  const declined = await checkout('sam', lesson, courtId, slot(3, 12));
  await must('Decline', api('PUT', `/bookings/${declined}/decline`, {
    token: await token('maya'),
    body: { message_to_student: 'Sorry, I’m at a tournament that weekend — please pick another day!', decline_reason_code: 'availability_conflict' },
  }));
  add(declined, 'Declined by Maya with a message (authorization released)');

  const upcoming = await checkout('sam', lesson, courtId, slot(4, 14));
  await accept(upcoming);
  await chat(upcoming, [
    ['sam', 'Hi Maya! I’m a 3.0 and really struggle with my third-shot drop.'],
    ['maya', 'Great, we’ll start there. Bring water and a couple of balls if you have them.'],
    ['sam', 'Sounds good, see you then!'],
  ]);
  add(upcoming, 'Confirmed, upcoming, with a chat (Messages; Maya has an unread message)');

  const weather = await checkout('sam', lesson, courtId, slot(5, 9));
  await accept(weather);
  await moveTo(weather, hoursFromNow(16));
  await must('Weather request', api('POST', `/bookings/${weather}/weather-cancellation`, {
    token: await token('maya'), body: { note: 'Thunderstorms forecast all morning.' },
  }), [201]);
  add(weather, 'Confirmed in 16h — Maya asked to cancel for weather; Sam can accept or decline');

  const lateCancel = await checkout('sam', lesson, courtId, slot(5, 11));
  await accept(lateCancel);
  await moveTo(lateCancel, hoursFromNow(10));
  await must('Late cancel', api('POST', `/bookings/${lateCancel}/cancel`, { token: await token('sam'), body: { reason: 'schedule_conflict' } }));
  add(lateCancel, 'Cancelled by Sam 10h before — 50% refund (Sam’s reliability in Settings drops)');

  const reviewed = await checkout('jordan', lesson, courtId, slot(6, 9));
  await accept(reviewed);
  await moveTo(reviewed, hoursFromNow(-20));
  await complete(reviewed);
  await must('Review', api('POST', '/reviews', {
    token: await token('jordan'), body: { booking_id: reviewed, rating: 5, comment: 'Maya fixed my drop shot in one session. Clear, patient, and fun.' },
  }));
  add(reviewed, 'Jordan: completed and reviewed 5★ (shows on Maya’s profile and Discover card)');

  const reviewed2 = await checkout('sam', lesson, courtId, slot(6, 11));
  await accept(reviewed2);
  await moveTo(reviewed2, hoursFromNow(-22));
  await complete(reviewed2);
  await must('Review', api('POST', '/reviews', {
    token: await token('sam'), body: { booking_id: reviewed2, rating: 4, comment: 'Great drills. Started a few minutes late but made up the time.' },
  }));
  add(reviewed2, 'Sam: completed and reviewed 4★');

  const awaitingReview = await checkout('sam', lesson, courtId, slot(6, 13));
  await accept(awaitingReview);
  await moveTo(awaitingReview, hoursFromNow(-3));
  await complete(awaitingReview);
  add(awaitingReview, 'Completed 2h ago — Sam can leave a review or report an issue');

  const issue = await checkout('sam', lesson, courtId, slot(6, 15));
  await accept(issue);
  await moveTo(issue, hoursFromNow(-4));
  await must('Report issue', api('POST', '/disputes', {
    token: await token('sam'), body: { booking_id: issue, dispute_type_id: 7, notes: 'We only played 30 of the 60 minutes because the court was double-booked.' },
  }));
  add(issue, 'Issue reported by Sam — open in Issues and in the admin dispute queue');

  for (const u of Object.values(users)) {
    for (const role of PEOPLE[Object.keys(users).find((k) => users[k].id === u.id)].roles) await updateUserReliability(u.id, role);
  }

  console.log('\nBookings (Maya’s lessons):');
  for (const b of made) console.log(`  #${b.id}  ${b.what}\n         ${APP}/bookings/${b.id}`);
  console.log(`
Log in (password ${PASSWORD}):
  Student   ${PEOPLE.sam.email}      Sam — bookings in every state, messages, weather request, Settings reliability
  Student   ${PEOPLE.jordan.email}     Jordan — one reviewed lesson
  Coach     ${PEOPLE.maya.email}        Maya — listed; incoming request, chat, reviews, photos, issue, dashboard reliability
  Coach     ${PEOPLE.leo.email}       Leo — listed, UTR-P rating, no bookings yet (try booking him as Sam)
  Coach     ${PEOPLE.nina.email}    Nina — not listed yet (Get listed on Discover checklist)
  Admin     admin.testflow@${DOMAIN}   Users, bookings, issue queue
Logged out: ${APP}/ (homepage), ${APP}/faq, ${APP}/terms, ${APP}/privacy
Discover: log in as Sam and search “Coral Gables, FL” to see Maya and Leo.`);
}

main()
  .catch((err) => { console.error('seed-feature-tour failed:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
