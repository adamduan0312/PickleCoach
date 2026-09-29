/**
 * Manual-QA companion: checkout slot conflicts against the running dev API + Stripe test mode.
 *
 * Test 1 — Student B books the slot while Student A sits on checkout; A then authorizes.
 * Test 2 — Coach removes the availability window while A sits on checkout; A then authorizes.
 *
 * "Authorize" is simulated exactly like the Payment Element: confirm A's PaymentIntent with
 * Stripe's test card, then POST /api/bookings/confirm. Cleans up B's booking and restores
 * the removed availability window.
 *
 * Run (from backend/, API on :4000):
 *   NODE_ENV=development node scripts/qa-checkout-slot-conflicts.mjs
 */
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });
if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const API = process.env.QA_API_URL || 'http://localhost:4000/api';
const PASSWORD = 'Test1234!Ab';
const STUDENT_A = 'adamduan0312@gmail.com';
const STUDENT_B = 'student.testflow@picklecoach.example.org';
const COACH = 'adamduan0312+coach@gmail.com';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const { sequelize, Booking, Payment, Notification, PaymentAction, CoachAvailability, Lesson, CoachCourtLocation, User } =
  await import('../models/index.js');
sequelize.options.logging = false;

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function login(email) {
  const { status, json } = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
  const token = json.data?.token || json.token || json.data?.accessToken;
  if (status !== 200 || !token) throw new Error(`Login failed for ${email}: ${status} ${json.message}`);
  return token;
}

/** What BookingCheckoutPage does on load. */
async function openCheckout(token, { lessonId, courtId, scheduledAt }) {
  const attemptId = randomUUID();
  return api('POST', '/booking-intents', {
    token,
    headers: { 'Idempotency-Key': attemptId },
    body: {
      lesson_id: lessonId,
      scheduled_at: scheduledAt,
      court_location_id: courtId,
      payment_method: 'stripe',
      booking_attempt_id: attemptId,
    },
  });
}

/** What clicking Authorize does: Stripe card authorization, then booking confirm. */
async function authorize(token, paymentIntentId) {
  const pi = await stripe.paymentIntents.confirm(paymentIntentId, { payment_method: 'pm_card_visa' });
  const confirm = await api('POST', '/bookings/confirm', { token, body: { payment_intent_id: paymentIntentId } });
  return { authorizedStatus: pi.status, confirm };
}

/** Next given weekday (0=Sun) at hh:00 in the coach's zone, at least 2 days out. */
function nextSlot(weekday, hour, timeZone) {
  const d = new Date(Date.now() + 2 * 86400000);
  for (let i = 0; i < 8; i += 1) {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const noon = new Date(`${ymd}T12:00:00Z`);
    if (noon.getUTCDay() === weekday) {
      const guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).formatToParts(guess).map((x) => [x.type, x.value]));
      const asZoned = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
      return new Date(guess.getTime() - (asZoned - guess.getTime())).toISOString();
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  throw new Error('Could not compute slot');
}

async function removeBookingRows(bookingId) {
  if (!bookingId) return;
  const payment = await Payment.findOne({ where: { booking_id: bookingId } });
  if (payment?.payment_intent_id) {
    try { await stripe.paymentIntents.cancel(payment.payment_intent_id); } catch { /* already canceled */ }
  }
  await Notification.destroy({ where: { entity_type: 'booking', entity_id: bookingId } });
  await PaymentAction.destroy({ where: { booking_id: bookingId } });
  await Payment.destroy({ where: { booking_id: bookingId } });
  await Booking.destroy({ where: { id: bookingId } });
}

async function bookingsAt(studentEmail, scheduledAt) {
  const user = await User.findOne({ where: { email: studentEmail } });
  return Booking.count({ where: { primary_student_id: user.id, scheduled_at: new Date(scheduledAt) } });
}

async function main() {
  const coachUser = await User.findOne({ where: { email: COACH } });
  const lesson = await Lesson.findOne({ where: { coach_id: coachUser.id, is_active: true, deleted_at: null }, order: [['id', 'ASC']] });
  const court = await CoachCourtLocation.findOne({ where: { coach_id: coachUser.id }, order: [['court_id', 'ASC']] });
  const coachTz = coachUser.timezone || 'UTC';
  const base = { lessonId: lesson.id, courtId: court.court_id };

  const [tokenA, tokenB, tokenCoach] = await Promise.all([login(STUDENT_A), login(STUDENT_B), login(COACH)]);

  // ---------- Test 1 ----------
  const slot1 = nextSlot(3, 11, coachTz); // Wednesday 11:00 coach time
  console.log(`\nTest 1 — Student B books A's slot (${slot1})`);
  let bBookingId = null;
  try {
    const a = await openCheckout(tokenA, { ...base, scheduledAt: slot1 });
    check('A opens checkout (intent created, Authorize would be enabled)', a.status === 201 || a.status === 200, `HTTP ${a.status}`);
    const aPi = a.json.data?.payment_intent_id;

    const b = await openCheckout(tokenB, { ...base, scheduledAt: slot1 });
    const bAuth = await authorize(tokenB, b.json.data?.payment_intent_id);
    bBookingId = bAuth.confirm.json.data?.booking?.id;
    check('B completes booking for the same slot', bAuth.confirm.status === 201 && bBookingId, `booking #${bBookingId}`);

    const aAuth = await authorize(tokenA, aPi);
    const body = aAuth.confirm.json;
    check('A clicks Authorize → 409 conflict', aAuth.confirm.status === 409, `HTTP ${aAuth.confirm.status}`);
    check('code = slot_no_longer_available (another student)', body.code === 'slot_no_longer_available', body.code);
    check('authorization_cancelled reported', typeof body.authorization_cancelled === 'boolean', String(body.authorization_cancelled));
    const aPiAfter = await stripe.paymentIntents.retrieve(aPi);
    check("A's Stripe authorization is canceled (no charge)", aPiAfter.status === 'canceled', aPiAfter.status);
    check('A has no booking for that slot', (await bookingsAt(STUDENT_A, slot1)) === 0);

    const reopen = await openCheckout(tokenA, { ...base, scheduledAt: slot1 });
    check('Re-opening checkout for the stale slot is refused (no new authorization)', reopen.status === 400 && reopen.json.code === 'slot_no_longer_available', `HTTP ${reopen.status} ${reopen.json.code}`);
  } finally {
    await removeBookingRows(bBookingId);
  }

  // ---------- Test 2 ----------
  const slot2 = nextSlot(4, 11, coachTz); // Thursday 11:00 coach time
  console.log(`\nTest 2 — Coach removes availability (${slot2})`);
  const window = await CoachAvailability.findOne({ where: { coach_id: coachUser.id, weekday: 4 } });
  if (!window) throw new Error('Coach has no Thursday availability to remove');
  const saved = { weekday: window.weekday, start_time: window.start_time.slice(0, 5), end_time: window.end_time.slice(0, 5) };
  let restored = false;
  try {
    const a = await openCheckout(tokenA, { ...base, scheduledAt: slot2 });
    check('A opens checkout', a.status === 201 || a.status === 200, `HTTP ${a.status}`);
    const aPi = a.json.data?.payment_intent_id;

    const del = await api('DELETE', `/coaches/me/availability/${window.id}`, { token: tokenCoach });
    check('Coach removes the Thursday window', del.status === 200, `HTTP ${del.status}`);

    const aAuth = await authorize(tokenA, aPi);
    const body = aAuth.confirm.json;
    check('A clicks Authorize → 409 conflict', aAuth.confirm.status === 409, `HTTP ${aAuth.confirm.status}`);
    check('code = slot_outside_coach_availability', body.code === 'slot_outside_coach_availability', body.code);
    check('authorization_cancelled reported', typeof body.authorization_cancelled === 'boolean', String(body.authorization_cancelled));
    const aPiAfter = await stripe.paymentIntents.retrieve(aPi);
    check("A's Stripe authorization is canceled (no charge)", aPiAfter.status === 'canceled', aPiAfter.status);
    check('A has no booking for that slot', (await bookingsAt(STUDENT_A, slot2)) === 0);

    const reopen = await openCheckout(tokenA, { ...base, scheduledAt: slot2 });
    check('Re-opening checkout is refused with the availability code', reopen.status === 400 && reopen.json.code === 'slot_outside_coach_availability', `HTTP ${reopen.status} ${reopen.json.code}`);
  } finally {
    const re = await api('POST', '/coaches/me/availability', { token: tokenCoach, body: saved });
    restored = re.status === 201 || re.status === 200;
    console.log(`  ${restored ? 'Restored' : 'FAILED to restore'} Thursday ${saved.start_time}–${saved.end_time} window`);
  }

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
  if (failures || !restored) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('qa-checkout-slot-conflicts failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
