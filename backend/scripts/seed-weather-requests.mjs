/**
 * Two confirmed lessons a few hours away, with no weather request yet, for testing weather cancellation
 * requests by hand (each booking allows one request in total):
 *
 *   A — log in as the student (Sam) and send the request; then answer it as the coach (Maya)
 *   B — log in as the coach (Maya) and send the request; then answer it as the student (Sam)
 *
 * Uses the `seed:feature-tour` accounts (run that first). Books through the real API + Stripe test checkout,
 * then moves the lessons into the next few hours. Re-runnable: removes the bookings from the previous run.
 * Payments are tagged `qa_fixture` so the payout worker skips them.
 *
 * Usage (from backend/, API on :4000): npm run seed:weather-requests   ·   Password: Test1234!Ab
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
const APP = 'http://localhost:5173';
const PASSWORD = 'Test1234!Ab';
const STUDENT = 'tour.student@picklecoach.example.org';
const COACH = 'tour.coach@picklecoach.example.org';
const SEED_TAG = 'qa_weather_request_seed';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const { sequelize, Booking, Payment, Lesson, CoachCourtLocation, User } = await import('../models/index.js');
sequelize.options.logging = false;

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 300) throw new Error(`${method} ${path} failed: ${res.status} ${json.message || ''}`);
  return json;
}
const login = async (email) => (await api('POST', '/auth/login', { body: { email, password: PASSWORD } })).data.token;

async function clearPreviousRun() {
  const [rows] = await sequelize.query(
    `SELECT b.id, p.payment_intent_id, p.payment_status FROM bookings b JOIN payments p ON p.booking_id = b.id
      WHERE JSON_EXTRACT(p.metadata, '$.${SEED_TAG}') = true`,
  );
  for (const r of rows) {
    if (r.payment_intent_id && ['authorized', 'pending'].includes(r.payment_status)) {
      try { await stripe.paymentIntents.cancel(r.payment_intent_id); } catch { /* already released */ }
    }
  }
  const ids = rows.map((r) => r.id);
  if (!ids.length) return 0;
  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { replacements: { ids }, transaction: t });
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
    await q("DELETE FROM notifications WHERE entity_type = 'booking' AND entity_id IN (:ids)");
    await q('DELETE FROM bookings WHERE id IN (:ids)');
  });
  return ids.length;
}

async function confirmedLessonSoon({ sam, maya, lesson, courtId, daysOut, hoursFromNow }) {
  const bookAt = new Date(Date.now() + daysOut * 86400000);
  bookAt.setUTCHours(15, 0, 0, 0);
  const attemptId = randomUUID();
  const intent = await api('POST', '/booking-intents', {
    token: sam,
    headers: { 'Idempotency-Key': attemptId },
    body: { lesson_id: lesson.id, scheduled_at: bookAt.toISOString(), court_location_id: courtId, payment_method: 'stripe', booking_attempt_id: attemptId },
  });
  const piId = intent.data.payment_intent_id;
  await stripe.paymentIntents.confirm(piId, { payment_method: 'pm_card_visa', return_url: APP });
  const id = (await api('POST', '/bookings/confirm', { token: sam, body: { payment_intent_id: piId } })).data.booking.id;
  const payment = await Payment.findOne({ where: { booking_id: id } });
  await payment.update({ metadata: { ...(payment.metadata || {}), qa_fixture: true, [SEED_TAG]: true } });
  await api('PUT', `/bookings/${id}/accept`, { token: maya });
  // Checkout needs advance notice, so book weeks out and then move the lesson into the next few hours.
  await Booking.update({ scheduled_at: new Date(Date.now() + hoursFromNow * 3600000) }, { where: { id } });
  return id;
}

const coachUser = await User.findOne({ where: { email: COACH } });
if (!coachUser) throw new Error('Tour accounts not found — run `npm run seed:feature-tour` first.');
const lesson = await Lesson.findOne({ where: { coach_id: coachUser.id, lesson_type: 'private', is_active: true } });
const courtId = (await CoachCourtLocation.findOne({ where: { coach_id: coachUser.id } }))?.court_id;
if (!lesson || !courtId) throw new Error('Maya has no lesson or court — run `npm run seed:feature-tour` first.');

const cleared = await clearPreviousRun();
const sam = await login(STUDENT);
const maya = await login(COACH);
const studentAsks = await confirmedLessonSoon({ sam, maya, lesson, courtId, daysOut: 30, hoursFromNow: 5 });
const coachAsks = await confirmedLessonSoon({ sam, maya, lesson, courtId, daysOut: 31, hoursFromNow: 7 });

console.log(`${cleared ? `Removed ${cleared} booking(s) from the last run. ` : ''}Two confirmed lessons with Maya, no weather request yet:

  A  #${studentAsks}  in ~5h — Sam sends the weather request, Maya accepts or declines
     ${APP}/bookings/${studentAsks}
  B  #${coachAsks}  in ~7h — Maya sends the weather request, Sam accepts or declines
     ${APP}/bookings/${coachAsks}

Log in (password ${PASSWORD}): student ${STUDENT} · coach ${COACH}
Each booking allows one weather request in total. Re-run this script for fresh bookings.`);
await sequelize.close();
