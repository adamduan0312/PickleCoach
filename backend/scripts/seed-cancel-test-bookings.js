/**
 * Seed four confirmed bookings for cancel-policy testing (no Stripe charge_id).
 *
 * Without real Stripe IDs the cancel API still runs the full policy math and writes
 * cancellation_history + audit logs; it skips Stripe refund/void calls.
 *
 * Prerequisites (from backend/):
 *   npm run seed:test-flows    # creates coach/student/lesson/court test users
 *
 * Run:
 *   npm run seed:cancel-test-bookings
 *
 * Test users (password Test1234!Ab):
 *   student.testflow@picklecoach.example.org
 *   coach.testflow@picklecoach.example.org
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  User,
  UserRole,
  Lesson,
  CoachCourtLocation,
  Booking,
  Payment,
} from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const TEST_EMAIL_DOMAIN = 'picklecoach.example.org';
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;

const idemKey = (label) =>
  `seed_cancel_test_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function findTestUser(emailLocal) {
  return User.findOne({
    where: { email: `${emailLocal}@${TEST_EMAIL_DOMAIN}` },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
}

async function createNoStripePayment(booking) {
  const price = Number(booking.price);
  const platformFee = (price * 8) / 100;
  const coachPayout = (price * 92) / 100;
  return Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: booking.primary_student_id,
    lesson_price: price.toFixed(2),
    platform_fee_percent: 8.0,
    platform_fee_amount: platformFee.toFixed(2),
    total_charge_to_student: price.toFixed(2),
    coach_payout_expected: coachPayout.toFixed(2),
    escrow_status: 'held',
    payment_status: 'captured',
    refund_status: 'none',
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: null,
    charge_id: null,
  });
}

function fmtBooking(booking, payment) {
  const price = Number(booking.price);
  const total = price.toFixed(2);
  const half = (Math.floor(Number(total) * 50) / 100).toFixed(2);
  return {
    id: booking.id,
    label: booking._seedLabel,
    scheduled_at: booking.scheduled_at.toISOString(),
    hours_until_lesson: booking._hoursUntil,
    total_charge: total,
    expected_on_student_cancel: booking._expectedStudent,
    expected_on_coach_cancel: booking._expectedCoach,
    payment_id: payment?.id ?? null,
  };
}

async function main() {
  await sequelize.authenticate();

  const coach = await findTestUser('coach.testflow');
  const student = await findTestUser('student.testflow');
  if (!coach || !student) {
    console.error(
      'Test-flow users not found. Run first:\n  npm run seed:test-flows',
    );
    process.exit(1);
  }

  const lesson = await Lesson.findOne({
    where: { coach_id: coach.id, is_active: true, deleted_at: null },
    order: [['id', 'DESC']],
  });
  if (!lesson) {
    console.error('No active lesson for test-flow coach. Run: npm run seed:test-flows');
    process.exit(1);
  }

  const link = await CoachCourtLocation.findOne({ where: { coach_id: coach.id } });
  const courtId = link?.court_id ?? null;

  const now = Date.now();
  const specs = [
    {
      label: 'non_late_student_cancel',
      scheduledAt: new Date(now + 7 * dayMs),
      hoursUntil: 168,
      cancelAs: 'student',
      expectedStudent: { refund: 'full (100%)', penalty: '0.00', is_late: false },
      expectedCoach: { refund: 'full (100%)', penalty: '0.00', is_late: false },
      suggestedReason: 'schedule_conflict',
    },
    {
      label: 'non_late_coach_cancel',
      scheduledAt: new Date(now + 6 * dayMs),
      hoursUntil: 144,
      cancelAs: 'coach',
      expectedStudent: { refund: 'full (100%)', penalty: '0.00', is_late: false },
      expectedCoach: { refund: 'full (100%)', penalty: '0.00', is_late: false },
      suggestedReason: 'schedule_conflict',
    },
    {
      label: 'late_student_cancel',
      scheduledAt: new Date(now + 12 * hourMs),
      hoursUntil: 12,
      cancelAs: 'student',
      expectedStudent: { refund: '50%', penalty: '50%', is_late: true },
      expectedCoach: { refund: 'full (100%)', penalty: '0.00', is_late: false },
      suggestedReason: 'forgot',
    },
    {
      label: 'late_coach_cancel',
      scheduledAt: new Date(now + 6 * hourMs),
      hoursUntil: 6,
      cancelAs: 'coach',
      expectedStudent: { refund: 'full (100%)', penalty: '0.00', is_late: false },
      expectedCoach: { refund: 'full (100%)', penalty: '0.00', is_late: true },
      suggestedReason: 'schedule_conflict',
    },
  ];

  const created = [];

  for (const spec of specs) {
    const booking = await Booking.create({
      lesson_id: lesson.id,
      coach_id: coach.id,
      primary_student_id: student.id,
      scheduled_at: spec.scheduledAt,
      duration_minutes: lesson.duration_minutes,
      price: lesson.price,
      court_location_id: courtId,
      status: 'confirmed',
      payout_status: 'none',
      messaging_locked: false,
      idempotency_key: idemKey(spec.label),
    });
    booking._seedLabel = spec.label;
    booking._hoursUntil = spec.hoursUntil;
    booking._expectedStudent = spec.expectedStudent;
    booking._expectedCoach = spec.expectedCoach;

    const payment = await createNoStripePayment(booking);
    created.push({ spec, booking, payment });
  }

  const price = Number(lesson.price);
  const totalCharge = price.toFixed(2);
  const lateRefund = (Math.floor(Number(totalCharge) * 50) / 100).toFixed(2);
  const latePenalty = (Number(totalCharge) - Number(lateRefund)).toFixed(2);

  console.log('\n=== Cancel test bookings seeded ===\n');
  console.log(`Lesson price / student charge: $${totalCharge}`);
  console.log(`Late student cancel expected: refund $${lateRefund}, penalty $${latePenalty}\n`);

  for (const { spec, booking, payment } of created) {
    console.log(`--- ${spec.label} ---`);
    console.log(JSON.stringify(fmtBooking(booking, payment), null, 2));
    console.log(
      `POST /api/bookings/${booking.id}/cancel  (login as ${spec.cancelAs})`,
    );
    console.log(
      `Body: { "reason": "${spec.suggestedReason}", "reason_notes": "Cancel test — ${spec.label}" }`,
    );
    console.log('');
  }

  console.log('=== How to verify cancel is working ===\n');
  console.log(`
1. API response (200)
   - booking.status = "cancelled"
   - booking.cancelled_by = "student" | "coach"
   - cancellation.refund_amount / penalty_amount match policy
   - Late student cancel: penalty_amount ≈ ${latePenalty}, refund_amount ≈ ${lateRefund}
   - Non-late or coach cancel: penalty_amount = "0.00", refund_amount = "${totalCharge}" (or 0 if voided auth only)

2. Tables to check (MySQL)

   bookings
     - status = cancelled
     - cancelled_by, cancelled_at set
     - messaging_locked = true
     - payout_status = pending  (only student late cancel with penalty > 0 and real charge_id)

   cancellation_history  (one row per cancel)
     - cancelled_by, reason, reason_notes
     - refund_amount, penalty_amount, penalty_reason
     - affects_reliability (false for weather/emergency/sickness; true for forgot/travel_delay/etc.)
     - Note: affects_reliability is stripped from API responses to clients

   payments
     - payment_status (unchanged without Stripe charge_id; with Stripe: partially_refunded after refund worker)
     - refunded_amount, refund_status after real Stripe refund

   payment_actions  (only when charge_id exists and refund > 0)
     - action_type = booking_cancel_refund
     - status pending → succeeded after worker

   audit_logs
     - action = booking_cancelled
     - action = cancellation_recorded
     - action = cancellation_financials  (check is_late_cancel, refund_cents, retained_penalty_cents)

   user_reliability  (after unexcused cancel)
     - student: late_cancels_* or student_cancels_non_late_*
     - coach: late_cancels_* or coach_cancels_non_late_*

3. SQL snippets (replace :booking_id)

   SELECT id, status, cancelled_by, cancelled_at, payout_status, messaging_locked
   FROM bookings WHERE id = :booking_id;

   SELECT cancelled_by, reason, refund_amount, penalty_amount, penalty_reason, affects_reliability, cancelled_at
   FROM cancellation_history WHERE booking_id = :booking_id;

   SELECT id, payment_status, total_charge_to_student, refunded_amount, refund_status, charge_id
   FROM payments WHERE booking_id = :booking_id ORDER BY id DESC LIMIT 1;

   SELECT id, action_type, status, refund_cents FROM payment_actions WHERE booking_id = :booking_id;

   SELECT action, after_state FROM audit_logs
   WHERE table_name = 'bookings' AND record_id = :booking_id
   ORDER BY id DESC LIMIT 5;

4. Phase 1 vs Phase 2
   - These seeds have charge_id = null → cancel tests policy + DB without Stripe.
   - For real Stripe refunds: create booking via POST /api/bookings, authorize, coach accept, then cancel.
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
