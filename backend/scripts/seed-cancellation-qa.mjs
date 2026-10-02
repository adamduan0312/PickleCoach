/**
 * Manual QA for cancellation scenarios against the running dev API + Stripe test mode.
 *
 * Clears every prior `qa_cancel_seed_` booking (releases open Stripe authorizations, deletes
 * dependent rows, recomputes both reliability scores), then books the scenario through the real
 * checkout flow: booking intent → Stripe test card authorization → POST /bookings/confirm.
 *
 * Usage (from backend/, API on :4000):
 *   node scripts/seed-cancellation-qa.mjs --scenario=p1   # clear + seed (p1 default, p2)
 *   node scripts/seed-cancellation-qa.mjs --scenario=c4 --keep   # seed without clearing earlier QA bookings
 *   node scripts/seed-cancellation-qa.mjs --clear-only
 *   node scripts/seed-cancellation-qa.mjs --verify=<bookingId>
 *
 * Scenarios:
 *   p1 — student cancels a pending booking
 *   p2 — coach declines a pending booking
 *   c1 — student cancels a confirmed booking ≥24h out with reason Weather
 *   c2 — coach cancels confirmed bookings ≥24h out: one with Weather, one with Schedule conflict
 *   c3 — student cancels a confirmed booking <24h out with reason Schedule conflict (late, penalized)
 *   c4 — student cancels a confirmed booking <24h out with reason Weather (late money rules, no reliability hit)
 *
 * Accounts (password Test1234!Ab):
 *   student adamduan0312@gmail.com, coach adamduan0312+coach@gmail.com
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
const STUDENT_EMAIL = 'adamduan0312@gmail.com';
const COACH_EMAIL = 'adamduan0312+coach@gmail.com';
const KEY_PREFIX = 'qa_cancel_seed_';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const { sequelize, Booking, Payment, PaymentAction, Payout, CancellationHistory, Lesson, CoachCourtLocation, User } =
  await import('../models/index.js');
const { updateUserReliability } = await import('../services/reliabilityService.js');
const { calculatePenaltyBreakdown, persistenceRowToCanonical } = await import('../services/reliabilityEngine.js');
sequelize.options.logging = false;

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}`))?.split('=')[1] ?? null;
const hasFlag = (name) => process.argv.includes(`--${name}`);

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email) {
  const { status, json } = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (status !== 200) throw new Error(`Login failed for ${email}: ${status} ${json.message || ''}`);
  return json.data.token;
}

async function users() {
  const [student, coach] = await Promise.all([
    User.findOne({ where: { email: STUDENT_EMAIL } }),
    User.findOne({ where: { email: COACH_EMAIL } }),
  ]);
  if (!student || !coach) throw new Error('QA student or coach account not found');
  return { student, coach };
}

async function reliabilitySummary(userId, role) {
  const [[row]] = await sequelize.query(
    'SELECT * FROM user_reliability WHERE user_id = :userId AND role = :role',
    { replacements: { userId, role } },
  );
  if (!row) return 'no reliability row yet (score 100)';
  const c = persistenceRowToCanonical(role, row);
  const { denominator, deductions } = calculatePenaltyBreakdown(role, c);
  const lateWeight = role === 'coach' ? 20 : 15;
  const nonLateKey = role === 'coach' ? 'coach_cancels_non_late' : 'student_cancels_non_late';
  const nonLateWeight = role === 'coach' ? 10 : 12;
  const parts = [
    `score ${Number(row.reliability_score)}`,
    `late cancels ${row.late_cancels_recent}`,
    `non-late cancels ${row[`${nonLateKey}_recent`]}`,
  ];
  const math = [];
  if (deductions.late_cancels > 0) {
    math.push(`late −${deductions.late_cancels.toFixed(2)} (= ${lateWeight} × ${c.late_cancels_total} ÷ ${denominator.toFixed(2)})`);
  }
  if (deductions[nonLateKey] > 0) {
    math.push(`non-late −${deductions[nonLateKey].toFixed(2)} (= ${nonLateWeight} × ${c[`${nonLateKey}_total`]} ÷ ${denominator.toFixed(2)})`);
  }
  const base = `bookings baseline ${c.booking_baseline_total} + K ${c.smoothing_k}`;
  return `${parts.join(', ')}${math.length ? `\n${' '.repeat(30)}${math.join('; ')}; denominator = ${base}` : ''}`;
}

async function clearSeeded() {
  const { student, coach } = await users();
  const [rows] = await sequelize.query(
    `SELECT b.id, p.payment_intent_id, p.payment_status
       FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.idempotency_key LIKE :prefix`,
    { replacements: { prefix: `${KEY_PREFIX}%` } },
  );
  const ids = [...new Set(rows.map((r) => r.id))];
  for (const r of rows) {
    if (r.payment_intent_id && ['authorized', 'pending'].includes(r.payment_status)) {
      try { await stripe.paymentIntents.cancel(r.payment_intent_id); } catch { /* already released */ }
    }
  }
  if (ids.length) {
    await sequelize.transaction(async (t) => {
      const q = (sql) => sequelize.query(sql, { replacements: { ids }, transaction: t });
      await q('DELETE FROM weather_cancellation_requests WHERE booking_id IN (:ids)');
      await q('DELETE FROM conversations WHERE booking_id IN (:ids)');
      await q('DELETE FROM reviews WHERE booking_id IN (:ids)');
      await q("DELETE FROM notifications WHERE entity_type = 'booking' AND entity_id IN (:ids)");
      await q('DELETE FROM bookings WHERE id IN (:ids)');
    });
  }
  await updateUserReliability(student.id, 'student');
  await updateUserReliability(coach.id, 'coach');
  console.log(`Cleared ${ids.length} prior QA booking(s)${ids.length ? ` (${ids.join(', ')})` : ''}; recomputed reliability.`);
}

/** `daysOut` days ahead at `hour`:00 New York time. */
function slot(daysOut, hour) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + daysOut * 86400000));
  const guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess).map((x) => [x.type, x.value]));
  return new Date(guess.getTime() - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess.getTime())).toISOString();
}

async function seedPendingBooking(scenario, scheduledAt) {
  const { coach } = await users();
  const lesson = await Lesson.findOne({ where: { coach_id: coach.id, is_active: true, deleted_at: null }, order: [['id', 'ASC']] });
  const court = await CoachCourtLocation.findOne({ where: { coach_id: coach.id }, order: [['court_id', 'ASC']] });
  const token = await login(STUDENT_EMAIL);
  const attemptId = randomUUID();
  const intent = await api('POST', '/booking-intents', {
    token,
    headers: { 'Idempotency-Key': attemptId },
    body: { lesson_id: lesson.id, scheduled_at: scheduledAt, court_location_id: court.court_id, payment_method: 'stripe', booking_attempt_id: attemptId },
  });
  if (![200, 201].includes(intent.status)) throw new Error(`Booking intent failed: ${intent.status} ${intent.json.message || ''}`);
  const piId = intent.json.data.payment_intent_id;
  await stripe.paymentIntents.confirm(piId, { payment_method: 'pm_card_visa', return_url: 'http://localhost:5173' });
  const confirm = await api('POST', '/bookings/confirm', { token, body: { payment_intent_id: piId } });
  if (![200, 201].includes(confirm.status)) throw new Error(`Booking confirm failed: ${confirm.status} ${confirm.json.message || ''}`);
  const bookingId = confirm.json.data.booking.id;
  await Booking.update({ idempotency_key: `${KEY_PREFIX}${scenario}_${Date.now()}` }, { where: { id: bookingId } });
  return { bookingId, piId, lesson };
}

async function verify(bookingId) {
  const { student, coach } = await users();
  const booking = await Booking.findByPk(bookingId);
  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  // Recompute so the scores reflect current history, not whatever was last stored.
  await updateUserReliability(student.id, 'student');
  await updateUserReliability(coach.id, 'coach');
  const payment = await Payment.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });
  const pi = payment?.payment_intent_id ? await stripe.paymentIntents.retrieve(payment.payment_intent_id) : null;
  const stripeRefunds = pi?.status === 'succeeded' ? (await stripe.refunds.list({ payment_intent: pi.id })).data : [];
  const actions = await PaymentAction.findAll({ where: { booking_id: bookingId } });
  const payouts = payment ? await Payout.findAll({ where: { payment_id: payment.id } }) : [];
  const history = await CancellationHistory.findOne({ where: { booking_id: bookingId }, order: [['id', 'DESC']] });

  console.log(`\nBooking #${bookingId}`);
  console.log(`  Booking status ............ ${booking.status}${booking.cancelled_by ? ` (cancelled by ${booking.cancelled_by})` : ''}`);
  if (booking.declined_at) {
    console.log(`  Declined .................. yes, reason code ${booking.decline_reason_code ?? 'none'}, message "${booking.decline_message_to_student ?? ''}"`);
  }
  console.log(`  Stripe PaymentIntent ...... ${pi ? `${pi.id} → ${pi.status}` : 'none'}`);
  console.log(`  Student charged ........... $${((pi?.amount_received || 0) / 100).toFixed(2)}`);
  console.log(`  Payment row ............... ${payment ? `${payment.payment_status}, refund_status ${payment.refund_status}, escrow ${payment.escrow_status}` : 'none'}`);
  console.log(`  Refund actions ............ ${actions.length ? actions.map((a) => `${a.action_type} ${a.refund_cents}¢ ${a.status}`).join('; ') : 'none'}`);
  if (pi?.status === 'succeeded') {
    console.log(`  Stripe refunds ............ ${stripeRefunds.length
      ? stripeRefunds.map((r) => `${r.id} $${(r.amount / 100).toFixed(2)} ${r.status}`).join('; ')
      : actions.length ? 'none yet (the refund worker runs every 2 minutes)' : 'none'}`);
  }
  console.log(`  Coach payout .............. ${payouts.length ? payouts.map((p) => `$${p.amount} ${p.status}`).join('; ') : '$0 (none)'}; booking payout_status ${booking.payout_status ?? 'null'}`);
  if (history && Number(history.penalty_amount) > 0) {
    const retained = Number(history.penalty_amount);
    const coachShare = payouts.length
      ? Number(payouts[0].amount)
      : Math.round(retained * (100 - Number(payment.platform_fee_percent))) / 100;
    console.log(`  Retained split ............ $${retained.toFixed(2)} kept → coach $${coachShare.toFixed(2)}, platform $${(retained - coachShare).toFixed(2)} (${payment.platform_fee_percent}% fee)${payouts.length ? '' : ' — expected; payout not created yet'}`);
    console.log(`  Payout gate ............... refund action ${actions.find((a) => a.action_type === 'booking_cancel_refund')?.status ?? 'none'}, payment ${payment.payment_status} / refund ${payment.refund_status} (payout waits for partially_refunded + succeeded; worker every 10 min)`);
  }
  console.log(`  Cancellation history ...... ${history
    ? `reason ${history.reason}, affects_reliability = ${Boolean(history.affects_reliability)}, refund $${history.refund_amount}, retained $${history.penalty_amount}`
    : 'none'}`);
  console.log(`  Student reliability ....... ${await reliabilitySummary(student.id, 'student')}`);
  console.log(`  Coach reliability ......... ${await reliabilitySummary(coach.id, 'coach')}`);
  if (pi) console.log(`  Stripe dashboard .......... https://dashboard.stripe.com/test/payments/${pi.id}`);
}

const SCENARIOS = {
  p1: {
    title: 'P1 — Student cancels pending',
    loginAs: STUDENT_EMAIL,
    action: 'Cancel booking → pick any reason (e.g. Forgot) → confirm',
  },
  p2: {
    title: 'P2 — Coach declines pending',
    loginAs: COACH_EMAIL,
    action: 'Decline request → write a message to the student → pick a reason → Decline request',
  },
  c1: {
    title: 'C1 — Student cancels confirmed ≥24h before, reason Weather',
    loginAs: STUDENT_EMAIL,
    action: 'Cancel booking → reason Weather → confirm',
    confirmed: true,
  },
  c2: {
    title: 'C2 — Coach cancels confirmed ≥24h before',
    loginAs: COACH_EMAIL,
    confirmed: true,
    bookings: [
      { label: 'C2a (Weather)', hour: 10, action: 'Cancel booking → reason Weather → confirm' },
      { label: 'C2b (non-weather)', hour: 14, action: 'Cancel booking → reason Schedule conflict → confirm' },
    ],
  },
  c3: {
    title: 'C3 — Student cancels confirmed <24h before, reason Schedule conflict (late)',
    loginAs: STUDENT_EMAIL,
    confirmed: true,
    bookings: [{ label: null, hour: 10, hoursOut: 12, action: 'Cancel booking → reason Schedule conflict → confirm' }],
  },
  c4: {
    title: 'C4 — Student cancels confirmed <24h before, reason Weather (late, no mutual agreement)',
    loginAs: STUDENT_EMAIL,
    confirmed: true,
    bookings: [{ label: null, hour: 15, hoursOut: 14, action: 'Cancel booking → reason Weather → confirm (do NOT use the weather request card)' }],
  },
};

async function main() {
  const verifyId = arg('verify');
  if (verifyId) return verify(Number(verifyId));

  const scenario = (arg('scenario') || 'p1').toLowerCase();
  const steps = SCENARIOS[scenario];
  if (!steps && !hasFlag('clear-only')) throw new Error(`Unknown scenario "${scenario}" (use ${Object.keys(SCENARIOS).join(', ')})`);

  if (!hasFlag('keep')) await clearSeeded();
  if (hasFlag('clear-only')) return;

  const plan = steps.bookings || [{ label: null, hour: 10, action: steps.action }];
  console.log(`\n${steps.title}\n  Log in:  ${steps.loginAs} / ${PASSWORD}`);
  for (const b of plan) {
    const { bookingId, piId, lesson } = await seedPendingBooking(scenario, slot(3, b.hour));
    if (steps.confirmed) {
      const accept = await api('PUT', `/bookings/${bookingId}/accept`, { token: await login(COACH_EMAIL) });
      if (accept.status !== 200) throw new Error(`Coach accept failed: ${accept.status} ${accept.json.message || ''}`);
    }
    if (b.hoursOut) {
      // Checkout requires advance notice, so book days out and then pull the lesson inside the late window.
      await Booking.update(
        { scheduled_at: new Date(Date.now() + b.hoursOut * 3600000) },
        { where: { id: bookingId } },
      );
    }
    console.log(`
  ${b.label ? `${b.label} — ` : ''}Booking #${bookingId}: "${lesson.title}", ${steps.confirmed ? 'confirmed by the coach, card charged' : 'pending (waiting for coach), card authorized'} via ${piId}${b.hoursOut ? `, lesson moved to ${b.hoursOut}h from now` : ''}
  Open:    http://localhost:5173/bookings/${bookingId}
  Do:      ${b.action}
  Then:    node scripts/seed-cancellation-qa.mjs --verify=${bookingId}`);
    await verify(bookingId);
  }
}

main()
  .catch((err) => { console.error('seed-cancellation-qa failed:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
