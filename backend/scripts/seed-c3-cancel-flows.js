/**
 * Seed Postman money-path fixtures (live Stripe test mode).
 *
 * Faster than manual book → accept → cancel: this script creates live
 * authorized (and captured where needed) bookings so you only hit the
 * cancel / decline / complete / confirm endpoints under test.
 *
 * Scenarios:
 *   C3a  coach decline (pending + authorized → void)
 *   C3b  early student cancel pre-accept (pending + authorized → void)
 *   C3c  late student cancel after capture (<24h → half refund)
 *   C3d  coach cancel after capture (full refund)
 *   C4   completion → escrow payout (confirmed + captured, lesson already ended)
 *   C5   idempotency fixtures (double confirm / accept / cancel)
 *
 * Prerequisites:
 *   STRIPE_SECRET_KEY=sk_test_…
 *   coach stripe_ready (default coach7@example.com)
 *   Backend + `stripe listen` + workers for refund (~2 min) / payout (~10 min)
 *
 * Run from backend/:
 *   npm run seed:c3-cancel-flows
 *   npm run seed:postman-money
 *   npm run seed:postman-money -- --only=C3b,C3c,C4
 */
import dotenv from 'dotenv';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY (sk_test_…) required');
  process.exit(1);
}

import {
  sequelize,
  User,
  UserRole,
  CoachProfile,
  Lesson,
  CoachCourtLocation,
  CoachAvailability,
  Booking,
  Payment,
} from '../models/index.js';
import stripe from '../services/stripeService.js';
import {
  createBookingIntent,
  confirmBookingFromPaymentIntent,
} from '../services/bookingIntentService.js';
import * as paymentService from '../services/paymentService.js';
import { calculatePaymentAmounts, dollarsToCents } from '../services/paymentEngine.js';

const PASSWORD = 'Test1234!Ab';
const COACH_EMAIL = process.env.C3_COACH_EMAIL || 'coach7@example.com';
const STUDENT_EMAIL =
  process.env.C3_STUDENT_EMAIL || 'student.testflow@picklecoach.example.org';

const hourMs = 60 * 60 * 1000;
const ALL_KEYS = ['C3a', 'C3b', 'C3c', 'C3d', 'C4', 'C5'];

function parseOnly() {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  const raw = arg ? arg.slice('--only='.length) : process.env.SCENARIOS || '';
  if (!raw.trim()) return new Set(ALL_KEYS);
  const keys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = keys.filter((k) => !ALL_KEYS.includes(k));
  if (unknown.length) {
    console.error(`Unknown scenario(s): ${unknown.join(', ')}. Use: ${ALL_KEYS.join(', ')}`);
    process.exit(1);
  }
  return new Set(keys);
}

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
  throw new Error(`No slot for weekday=${weekday} ${hour}:${minute}`);
}

async function loadActors() {
  const student = await User.findOne({
    where: { email: STUDENT_EMAIL },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  const coach = await User.findOne({
    where: { email: COACH_EMAIL },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  if (!student || !coach) {
    throw new Error(`Missing users. Need ${STUDENT_EMAIL} and ${COACH_EMAIL}`);
  }
  await student.update({
    is_active: true,
    email_verified_at: student.email_verified_at || new Date(),
  });
  const profile = await CoachProfile.findOne({ where: { user_id: coach.id, deleted_at: null } });
  if (!profile?.stripe_ready) {
    throw new Error(`${COACH_EMAIL} must be stripe_ready for live captures/payouts`);
  }
  if (!profile.stripe_account_id) {
    console.warn(`Warning: ${COACH_EMAIL} has no stripe_account_id — C4 Connect transfer may fail`);
  }
  const lesson = await Lesson.findOne({
    where: { coach_id: coach.id, is_active: true, deleted_at: null },
    order: [['id', 'DESC']],
  });
  if (!lesson) throw new Error('Coach has no active lesson');
  const link = await CoachCourtLocation.findOne({ where: { coach_id: coach.id } });
  if (!link) throw new Error('Coach has no court');
  const avail = await CoachAvailability.count({ where: { coach_id: coach.id } });
  if (avail === 0) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      await CoachAvailability.create({
        coach_id: coach.id,
        weekday,
        start_time: '09:00:00',
        end_time: '17:00:00',
      });
    }
  }
  return { student, coach, lesson, courtId: link.court_id, profile };
}

async function authorizeWithTestCard(paymentIntentId) {
  const pi = await stripe.paymentIntents.confirm(paymentIntentId, {
    payment_method: 'pm_card_visa',
    return_url: 'http://localhost:5173/stripe-authorize-test.html',
  });
  if (pi.status !== 'requires_capture') {
    throw new Error(`Expected requires_capture, got ${pi.status}`);
  }
  return pi;
}

async function createAuthorizedPending({ student, lesson, courtId, scheduledAt, label }) {
  const intent = await createBookingIntent({
    studentId: student.id,
    studentRoles: ['student'],
    lessonId: lesson.id,
    scheduledAt: scheduledAt.toISOString(),
    courtLocationId: courtId,
    paymentMethod: 'stripe',
    idempotencyKey: `postman_${label}_${Date.now()}`,
  });
  await authorizeWithTestCard(intent.payment_intent_id);
  const { booking, payment } = await confirmBookingFromPaymentIntent({
    studentId: student.id,
    paymentIntentId: intent.payment_intent_id,
  });
  return { booking, payment, payment_intent_id: intent.payment_intent_id };
}

async function createCapturedConfirmed({
  student,
  lesson,
  courtId,
  scheduledAt,
  label,
  afterCaptureScheduledAt = null,
}) {
  const { booking, payment, payment_intent_id } = await createAuthorizedPending({
    student,
    lesson,
    courtId,
    scheduledAt,
    label: `${label}_auth`,
  });
  await paymentService.capturePaymentOnCoachAccept(payment.id);
  if (afterCaptureScheduledAt) {
    await Booking.update(
      { scheduled_at: afterCaptureScheduledAt },
      { where: { id: booking.id } },
    );
  }
  await payment.reload();
  await booking.reload();
  return { booking, payment, payment_intent_id };
}

/** Authorized PI only — no booking row (for C5 double-confirm). */
async function createAuthorizedIntentOnly({ student, lesson, courtId, scheduledAt, label }) {
  const intent = await createBookingIntent({
    studentId: student.id,
    studentRoles: ['student'],
    lessonId: lesson.id,
    scheduledAt: scheduledAt.toISOString(),
    courtLocationId: courtId,
    paymentMethod: 'stripe',
    idempotencyKey: `postman_${label}_${Date.now()}`,
  });
  await authorizeWithTestCard(intent.payment_intent_id);
  return {
    payment_intent_id: intent.payment_intent_id,
    client_secret: intent.client_secret,
    scheduled_at: scheduledAt.toISOString(),
  };
}

function moneySnapshot(lessonPrice) {
  const amounts = calculatePaymentAmounts(lessonPrice);
  const totalCents = dollarsToCents(amounts.total_charge_to_student);
  const lateRefundCents = Math.floor(totalCents / 2);
  const latePenaltyCents = totalCents - lateRefundCents;
  const lateCoachCents = Math.round(latePenaltyCents * 0.92);
  const latePlatformCents = latePenaltyCents - lateCoachCents;
  const fullCoachCents = dollarsToCents(amounts.coach_payout_expected);
  return {
    lesson_price: amounts.lesson_price,
    total_charge: amounts.total_charge_to_student,
    total_charge_cents: totalCents,
    full_coach_payout: amounts.coach_payout_expected,
    full_coach_payout_cents: fullCoachCents,
    full_platform_revenue: amounts.platform_fee_amount,
    late_student_cancel: {
      // PickleCoach "net retained" = gross − refund (NOT Stripe Dashboard Net after fees)
      refund_to_student: Number((lateRefundCents / 100).toFixed(2)),
      refund_cents: lateRefundCents,
      net_retained: Number((latePenaltyCents / 100).toFixed(2)),
      coach_payout: Number((lateCoachCents / 100).toFixed(2)),
      platform_revenue: Number((latePlatformCents / 100).toFixed(2)),
    },
  };
}

function lessonDurationMs(lesson) {
  const mins = Number(lesson.duration_minutes) || 60;
  return mins * 60 * 1000;
}

async function main() {
  const only = parseOnly();
  await sequelize.authenticate();
  const { student, coach, lesson, courtId, profile } = await loadActors();
  const money = moneySnapshot(lesson.price);
  const results = [];

  // Distinct weekday slots so availability / double-book checks pass.
  const slots = {
    a: nextCoachLocalSlot({ weekday: 1, hour: 10, minDaysAhead: 2 }),
    b: nextCoachLocalSlot({ weekday: 2, hour: 11, minDaysAhead: 2 }),
    c: nextCoachLocalSlot({ weekday: 3, hour: 14, minDaysAhead: 2 }),
    d: nextCoachLocalSlot({ weekday: 4, hour: 10, minDaysAhead: 3 }),
    e: nextCoachLocalSlot({ weekday: 5, hour: 10, minDaysAhead: 3 }),
    f: nextCoachLocalSlot({ weekday: 1, hour: 14, minDaysAhead: 4 }),
    g: nextCoachLocalSlot({ weekday: 2, hour: 15, minDaysAhead: 4 }),
    h: nextCoachLocalSlot({ weekday: 3, hour: 11, minDaysAhead: 5 }),
  };

  if (only.has('C3a')) {
    console.log('\nSeeding C3a coach decline (pending + authorized)…');
    const r = await createAuthorizedPending({
      student,
      lesson,
      courtId,
      scheduledAt: slots.a,
      label: 'c3a_decline',
    });
    results.push({
      scenario: 'C3a_coach_decline',
      booking_id: r.booking.id,
      payment_id: r.payment.id,
      payment_intent_id: r.payment_intent_id,
      booking_status: r.booking.status,
      payment_status: r.payment.payment_status,
      scheduled_at: r.booking.scheduled_at,
      login_as: 'coach',
      endpoint: `PUT /api/bookings/${r.booking.id}/decline`,
      body: {
        message_to_student: 'Sorry — that slot no longer works. Please rebook.',
        decline_reason_code: 'availability_conflict',
      },
      expect: {
        booking: { status: 'cancelled', cancelled_by: 'coach' },
        payment: 'pending_void → failed; escrow released (never held); no payment_actions',
        payment_actions: 'none (void, not refund)',
        stripe: 'PI canceled',
        payout: 'none',
      },
    });
  }

  if (only.has('C3b')) {
    console.log('Seeding C3b early student cancel (≥24h, pending + authorized)…');
    const r = await createAuthorizedPending({
      student,
      lesson,
      courtId,
      scheduledAt: slots.b,
      label: 'c3b_early_cancel',
    });
    results.push({
      scenario: 'C3b_early_student_cancel_pre_accept',
      note:
        'No need to book→accept first. Already confirmed + authorized, lesson ≥24h out, awaiting coach accept. Cancel = void auth in full.',
      booking_id: r.booking.id,
      payment_id: r.payment.id,
      payment_intent_id: r.payment_intent_id,
      booking_status: r.booking.status,
      payment_status: r.payment.payment_status,
      scheduled_at: r.booking.scheduled_at,
      login_as: 'student',
      endpoint: `POST /api/bookings/${r.booking.id}/cancel`,
      body: { reason: 'schedule_conflict', reason_notes: 'C3b early cancel' },
      expect: {
        booking: { status: 'cancelled', cancelled_by: 'student' },
        payment: 'pending_void → failed; escrow released (never held); refunded_amount 0',
        payment_actions: 'none',
        stripe: 'PI canceled',
        payout_status: 'none',
      },
      sql_check: [
        `SELECT id, status, cancelled_by, payout_status FROM bookings WHERE id=${r.booking.id};`,
        `SELECT id, payment_status, refunded_amount, escrow_status, payment_intent_id FROM payments WHERE id=${r.payment.id};`,
        `SELECT COUNT(*) AS actions FROM payment_actions WHERE payment_id=${r.payment.id};`,
      ],
    });
  }

  if (only.has('C3c')) {
    console.log('Seeding C3c late student cancel after capture…');
    const r = await createCapturedConfirmed({
      student,
      lesson,
      courtId,
      scheduledAt: slots.c,
      label: 'c3c_late',
      afterCaptureScheduledAt: new Date(Date.now() + 12 * hourMs),
    });
    results.push({
      scenario: 'C3c_late_student_cancel',
      note: 'Already confirmed + captured; scheduled_at forced to ~12h from now so cancel is late (<24h).',
      booking_id: r.booking.id,
      payment_id: r.payment.id,
      payment_intent_id: r.payment_intent_id,
      charge_id: r.payment.charge_id,
      booking_status: r.booking.status,
      payment_status: r.payment.payment_status,
      scheduled_at: r.booking.scheduled_at,
      login_as: 'student',
      endpoint: `POST /api/bookings/${r.booking.id}/cancel`,
      body: { reason: 'forgot', reason_notes: 'C3c late cancel' },
      expect: {
        booking: { status: 'cancelled', cancelled_by: 'student' },
        payment_after_refund_worker: {
          payment_status: 'partially_refunded',
          refund_status: 'succeeded',
          refunded_amount: money.late_student_cancel.refund_to_student,
        },
        payment_actions: {
          action_type: 'booking_cancel_refund',
          status: 'succeeded',
          refund_cents: money.late_student_cancel.refund_cents,
        },
        stripe: `Partial refund ${money.late_student_cancel.refund_cents} cents (student gets full half; no fee deducted from refund)`,
        picklecoach_net_retained: money.late_student_cancel.net_retained,
        coach_payout: money.late_student_cancel.coach_payout,
        platform_share: money.late_student_cancel.platform_revenue,
        terminology:
          'PickleCoach net retained = gross − refund only (split base). Do NOT use Stripe Dashboard "Net amount" (after processing fee) as 92% base. Stripe fee = platform expense.',
        payout: `Later: 92% of PickleCoach net retained ≈ $${money.late_student_cancel.coach_payout} (not 92% of Stripe Net)`,
        wait: 'paymentActionWorker ~2 min; then payoutWorker ~10 min if payout_status pending',
      },
      sql_check: [
        `SELECT id, status, cancelled_by, payout_status FROM bookings WHERE id=${r.booking.id};`,
        `SELECT id, payment_status, refund_status, refunded_amount, escrow_status FROM payments WHERE id=${r.payment.id};`,
        `SELECT id, action_type, status, refund_cents FROM payment_actions WHERE payment_id=${r.payment.id};`,
      ],
    });
  }

  if (only.has('C3d')) {
    console.log('Seeding C3d coach cancel after capture…');
    const r = await createCapturedConfirmed({
      student,
      lesson,
      courtId,
      scheduledAt: slots.d,
      label: 'c3d_coach_cancel',
    });
    results.push({
      scenario: 'C3d_coach_cancel_after_capture',
      note: 'Already confirmed + captured. Coach cancel → full student refund via payment_actions.',
      booking_id: r.booking.id,
      payment_id: r.payment.id,
      payment_intent_id: r.payment_intent_id,
      charge_id: r.payment.charge_id,
      booking_status: r.booking.status,
      payment_status: r.payment.payment_status,
      scheduled_at: r.booking.scheduled_at,
      login_as: 'coach',
      endpoint: `POST /api/bookings/${r.booking.id}/cancel`,
      body: { reason: 'schedule_conflict', reason_notes: 'C3d coach cancel' },
      expect: {
        booking: { status: 'cancelled', cancelled_by: 'coach' },
        payment_after_refund_worker: {
          payment_status: 'refunded',
          refunded_amount: money.total_charge,
        },
        payment_actions: {
          action_type: 'booking_cancel_refund',
          status: 'succeeded',
          refund_cents: money.total_charge_cents,
        },
        stripe: 'Charge fully refunded',
        payout: 'No coach transfer',
        wait: 'paymentActionWorker ~2 min',
      },
      sql_check: [
        `SELECT id, status, cancelled_by, payout_status FROM bookings WHERE id=${r.booking.id};`,
        `SELECT id, payment_status, refund_status, refunded_amount FROM payments WHERE id=${r.payment.id};`,
        `SELECT id, action_type, status, refund_cents FROM payment_actions WHERE payment_id=${r.payment.id};`,
      ],
    });
  }

  if (only.has('C4')) {
    console.log('Seeding C4 completion → escrow → Connect payout…');
    // Capture against a valid future slot, then age the lesson so the 24h review window has already ended.
    const endedStart = new Date(Date.now() - lessonDurationMs(lesson) - 25 * 60 * 60 * 1000);
    const r = await createCapturedConfirmed({
      student,
      lesson,
      courtId,
      scheduledAt: slots.e,
      label: 'c4_payout',
      afterCaptureScheduledAt: endedStart,
    });
    results.push({
      scenario: 'C4_completion_escrow_payout',
      note:
        'Already confirmed + captured; scheduled_at moved so lesson end was 25h ago (24h financial review window elapsed). Complete confirms attendance only; payoutWorker can then release escrow.',
      booking_id: r.booking.id,
      payment_id: r.payment.id,
      payment_intent_id: r.payment_intent_id,
      charge_id: r.payment.charge_id,
      booking_status: r.booking.status,
      payment_status: r.payment.payment_status,
      escrow_status: r.payment.escrow_status,
      scheduled_at: r.booking.scheduled_at,
      coach_stripe_account_id: profile.stripe_account_id,
      login_as: 'coach',
      steps: [
        `POST /api/bookings/${r.booking.id}/complete  → status completed, payout_status pending`,
        'Wait for payoutWorker (~10 min) → Stripe Connect transfer ~92% of lesson',
        'Wait for transfer webhook → escrow released + bookings.payout_status paid',
      ],
      expect: {
        booking: { status: 'completed', payout_status: 'pending → processing → paid' },
        payment: {
          payment_status: 'captured',
          escrow_status: 'held → released (or briefly pending_release)',
        },
        stripe_platform: 'Original charge still succeeded',
        stripe_connect: `Transfer ≈ $${money.full_coach_payout} to ${profile.stripe_account_id || 'acct_…'}`,
      },
      sql_check: [
        `SELECT id, status, payout_status FROM bookings WHERE id=${r.booking.id};`,
        `SELECT id, payment_status, escrow_status, coach_payout_expected FROM payments WHERE id=${r.payment.id};`,
        `SELECT id, amount, status, stripe_transfer_id FROM payouts WHERE payment_id=${r.payment.id};`,
      ],
    });
  }

  if (only.has('C5')) {
    console.log('Seeding C5 idempotency fixtures…');

    const intentOnly = await createAuthorizedIntentOnly({
      student,
      lesson,
      courtId,
      scheduledAt: slots.f,
      label: 'c5_double_confirm',
    });
    results.push({
      scenario: 'C5_double_confirm',
      note: 'PI authorized, no booking yet. Confirm twice with the same payment_intent_id.',
      payment_intent_id: intentOnly.payment_intent_id,
      scheduled_at: intentOnly.scheduled_at,
      login_as: 'student',
      steps: [
        `POST /api/bookings/confirm  body: { "payment_intent_id": "${intentOnly.payment_intent_id}" }`,
        'Repeat same body — expect same booking / error, not a second booking',
      ],
      expect: {
        db: 'COUNT bookings for PI = 1; COUNT payments for PI = 1',
        stripe: 'Still one PI; no second auth/charge',
      },
      sql_check: [
        `SELECT COUNT(*) AS bookings FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE p.payment_intent_id='${intentOnly.payment_intent_id}';`,
        `SELECT COUNT(*) AS payments FROM payments WHERE payment_intent_id='${intentOnly.payment_intent_id}';`,
      ],
    });

    const accept = await createAuthorizedPending({
      student,
      lesson,
      courtId,
      scheduledAt: slots.g,
      label: 'c5_double_accept',
    });
    results.push({
      scenario: 'C5_double_accept',
      booking_id: accept.booking.id,
      payment_id: accept.payment.id,
      payment_intent_id: accept.payment_intent_id,
      booking_status: accept.booking.status,
      payment_status: accept.payment.payment_status,
      login_as: 'coach',
      steps: [
        `PUT /api/bookings/${accept.booking.id}/accept`,
        'Repeat accept — safe failure or idempotent success; one capture only',
      ],
      expect: {
        payment: 'One capture → captured (or pending_capture then webhook)',
        stripe: 'One capture on the PI',
      },
    });

    const cancel = await createCapturedConfirmed({
      student,
      lesson,
      courtId,
      scheduledAt: slots.h,
      label: 'c5_double_cancel',
    });
    results.push({
      scenario: 'C5_double_cancel',
      booking_id: cancel.booking.id,
      payment_id: cancel.payment.id,
      payment_intent_id: cancel.payment_intent_id,
      booking_status: cancel.booking.status,
      payment_status: cancel.payment.payment_status,
      login_as: 'student',
      steps: [
        `POST /api/bookings/${cancel.booking.id}/cancel  body: { "reason": "schedule_conflict", "reason_notes": "C5 first cancel" }`,
        'Repeat cancel — one cancel transition; at most one succeeded booking_cancel_refund action',
      ],
      expect: {
        payment_actions: 'One succeeded refund row (not two)',
        stripe: 'At most one refund of expected amount',
      },
      sql_check: [
        `SELECT id, status, cancelled_by FROM bookings WHERE id=${cancel.booking.id};`,
        `SELECT id, action_type, status, refund_cents FROM payment_actions WHERE payment_id=${cancel.payment.id};`,
      ],
    });

    results.push({
      scenario: 'C5_webhook_duplicate_and_failures',
      note: 'No extra rows seeded — use Dashboard / CLI replay and integration tests.',
      how: [
        'Webhook duplicate: Stripe CLI `stripe events resend <evt_…>` or Dashboard resend — local state unchanged; no double refund/payout',
        'Capture failure: npm run test:integration (booking-capture-failure) or force Stripe capture error',
        'Refund failure: integration booking-refund-failure — payment_actions failed/pending, not falsely succeeded',
      ],
    });
  }

  console.log(
    JSON.stringify(
      {
        how_to_use: [
          'You do NOT need to manually book→accept for C3b/c/d/C4 — seed already did authorize (+ capture when needed).',
          'Login with credentials below, call the listed endpoint(s), then verify SQL/Stripe expectations.',
          'Keep `stripe listen` forwarding to /api/webhooks/stripe and workers running for refund/payout.',
        ],
        credentials: {
          student: { email: student.email, password: PASSWORD },
          coach: { email: coach.email, password: PASSWORD },
        },
        lesson: { id: lesson.id, price: money.lesson_price, amounts: money },
        prerequisites: [
          'Backend + stripe listen running',
          'STRIPE_WEBHOOK_SECRET matches listen whsec_',
          'Workers enabled (refund ~2 min, payout ~10 min)',
        ],
        scenarios_seeded: [...only],
        scenarios: results,
      },
      null,
      2,
    ),
  );

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
