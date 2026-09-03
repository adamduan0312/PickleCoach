/**
 * Seed one admin-resolve QA fixture with a REAL Stripe test-mode charge.
 *
 * Why: most seeds leave charge_id null, so resolve with refund_student fails:
 *   "Payment has no Stripe charge to refund"
 *
 * Creates:
 *   - pending → authorize (pm_card_visa) → capture (real ch_…)
 *   - lesson forced into the past
 *   - booking status awaiting_verification
 *   - open misconduct dispute (resolvable in admin UI)
 *
 * Defaults (overridable via env):
 *   STUDENT_EMAIL=adamduan0312@gmail.com
 *   COACH_EMAIL=adamduan0312+coach@gmail.com
 *
 * Run from backend/:
 *   npm run seed:admin-resolve-charged
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
  CoachProfile,
  Lesson,
  CoachCourtLocation,
  CoachAvailability,
  Booking,
  Dispute,
  DisputeType,
} from '../models/index.js';
import stripe from '../services/stripeService.js';
import {
  createBookingIntent,
  confirmBookingFromPaymentIntent,
} from '../services/bookingIntentService.js';
import * as paymentService from '../services/paymentService.js';

const STUDENT_EMAIL = process.env.RESOLVE_STUDENT_EMAIL || 'adamduan0312@gmail.com';
const COACH_EMAIL = process.env.RESOLVE_COACH_EMAIL || 'adamduan0312+coach@gmail.com';

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
        lWd === weekdayShort[weekday] &&
        lH === hour &&
        lMin === minute
      ) {
        return candidate;
      }
    }
  }
  throw new Error(`Could not find slot weekday=${weekday} hour=${hour}`);
}

async function loadActors() {
  const student = await User.findOne({ where: { email: STUDENT_EMAIL, deleted_at: null } });
  if (!student) throw new Error(`Student not found: ${STUDENT_EMAIL}`);
  const coach = await User.findOne({ where: { email: COACH_EMAIL, deleted_at: null } });
  if (!coach) throw new Error(`Coach not found: ${COACH_EMAIL}`);
  const profile = await CoachProfile.findOne({ where: { user_id: coach.id, deleted_at: null } });
  if (!profile?.stripe_ready) {
    throw new Error(`${COACH_EMAIL} must be stripe_ready`);
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

async function main() {
  await sequelize.authenticate();
  const { student, coach, lesson, courtId, profile } = await loadActors();

  const misconduct = await DisputeType.findOne({ where: { code: 'misconduct' } });
  if (!misconduct) throw new Error('dispute type misconduct missing — run migrations');

  const futureSlot = nextCoachLocalSlot({ weekday: 2, hour: 15, minDaysAhead: 2 });
  const durationMs = (Number(lesson.duration_minutes) || 60) * 60 * 1000;
  const pastStart = new Date(Date.now() - durationMs - 2 * 60 * 60 * 1000);

  console.log('Creating authorized booking (live Stripe test)…');
  const intent = await createBookingIntent({
    studentId: student.id,
    studentRoles: ['student'],
    lessonId: lesson.id,
    scheduledAt: futureSlot.toISOString(),
    courtLocationId: courtId,
    paymentMethod: 'stripe',
    idempotencyKey: `admin_resolve_charged_${Date.now()}`,
  });
  await authorizeWithTestCard(intent.payment_intent_id);
  const { booking, payment } = await confirmBookingFromPaymentIntent({
    studentId: student.id,
    paymentIntentId: intent.payment_intent_id,
  });

  console.log(`Capturing PaymentIntent ${intent.payment_intent_id}…`);
  await paymentService.capturePaymentOnCoachAccept(payment.id);
  await payment.reload();
  await booking.reload();

  if (!payment.charge_id) {
    throw new Error(
      `Capture did not produce charge_id (payment_status=${payment.payment_status}). ` +
        'Check Stripe test keys / capture response.',
    );
  }

  // Force into post-lesson issue window without waiting.
  await booking.update({
    scheduled_at: pastStart,
    status: 'awaiting_verification',
    payout_status: 'none',
    attendance_finalized: false,
    messaging_locked: false,
  });

  const dispute = await Dispute.create({
    booking_id: booking.id,
    dispute_type_id: misconduct.id,
    notes: 'Admin resolve QA — misconduct with live Stripe charge. Safe to resolve with refund.',
    opened_by: 'student',
    status: 'open',
    opened_at: new Date(),
  });

  await payment.update({ dispute_id: dispute.id });

  console.log('\n=== Admin resolve fixture ready ===');
  console.log(
    JSON.stringify(
      {
        booking_id: booking.id,
        dispute_id: dispute.id,
        dispute_type: 'misconduct',
        booking_status: 'awaiting_verification',
        payment_id: payment.id,
        payment_status: payment.payment_status,
        escrow_status: payment.escrow_status,
        charge_id: payment.charge_id,
        payment_intent_id: payment.payment_intent_id,
        amount: payment.total_charge_to_student,
        coach_payout_expected: payment.coach_payout_expected,
        student: STUDENT_EMAIL,
        coach: COACH_EMAIL,
        coach_stripe_account_id: profile.stripe_account_id,
        admin_ui: {
          dispute: `http://localhost:5173/admin/disputes/${dispute.id}`,
          booking: `http://localhost:5173/admin/bookings/${booking.id}`,
        },
        suggested_resolve: {
          decision: 'upheld',
          penalize_role: 'coach',
          financial_action: 'refund_student',
          resolution_notes: 'QA: uphold misconduct and full student refund against live test charge.',
        },
        note:
          'Refund enqueues payment_actions; Stripe refund worker runs ~2 min later. Escrow should stay held until refund path settles.',
      },
      null,
      2,
    ),
  );

  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
