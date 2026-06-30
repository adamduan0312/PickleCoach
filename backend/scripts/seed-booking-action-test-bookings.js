/**
 * Seed pending bookings for accept / decline / cancel testing (authorize-first shape).
 *
 * Uses dev-only Stripe stubs (`pi_seed_dev_*`) — no live Stripe key required for
 * accept/decline/cancel on seeded bookings (API hydrates stubs from DB).
 *
 * Prerequisites:
 *   npm run seed:test-flows
 *
 * Run:
 *   npm run seed:booking-action-tests
 *
 * Accept flow (Postman):
 *   1. PUT /api/bookings/:id/accept  (pending_for_accept)
 *   2. npm run dev:simulate-capture -- --booking-id=<id>
 *   3. GET booking → status confirmed, messaging unlocked
 *
 * Test users (password Test1234!Ab):
 *   coach.testflow@picklecoach.example.org
 *   student.testflow@picklecoach.example.org
 */
import dotenv from 'dotenv';
import {
  sequelize,
  User,
  UserRole,
  Lesson,
  CoachCourtLocation,
  Booking,
  Payment,
} from '../models/index.js';
import { registerDevSeedPaymentIntent } from '../services/stripeService.js';
import { calculatePaymentAmounts } from '../services/paymentEngine.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const TEST_EMAIL_DOMAIN = 'picklecoach.example.org';
const dayMs = 24 * 60 * 60 * 1000;

const idemKey = (label) =>
  `seed_action_test_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function findTestUser(emailLocal) {
  return User.findOne({
    where: { email: `${emailLocal}@${TEST_EMAIL_DOMAIN}` },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
}

function devPaymentIntentId(label, bookingId) {
  return `pi_seed_dev_${label}_${bookingId}`;
}

async function createAuthorizeFirstPayment(booking, { label, scheduledAtIso }) {
  const amounts = calculatePaymentAmounts(booking.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  const amountCapturableCents = Math.round(totalCharge * 100);
  const paymentIntentId = devPaymentIntentId(label, booking.id);

  registerDevSeedPaymentIntent(paymentIntentId, { amountCapturableCents });

  return Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: booking.primary_student_id,
    lesson_price: amounts.lesson_price,
    platform_fee_percent: amounts.platform_fee_percent,
    platform_fee_amount: amounts.platform_fee_amount,
    total_charge_to_student: amounts.total_charge_to_student,
    coach_payout_expected: amounts.coach_payout_expected,
    escrow_status: 'held',
    payment_status: 'authorized',
    refund_status: 'none',
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: paymentIntentId,
    charge_id: null,
    metadata: {
      capture_on_accept: true,
      flow: 'authorize_then_book',
      authorization_succeeded_at: new Date().toISOString(),
      seed_label: label,
      scheduled_at: scheduledAtIso,
    },
  });
}

async function main() {
  await sequelize.authenticate();

  const coach = await findTestUser('coach.testflow');
  const student = await findTestUser('student.testflow');
  if (!coach || !student) {
    console.error('Test-flow users not found. Run first:\n  npm run seed:test-flows');
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
      label: 'pending_for_accept',
      scheduledAt: new Date(now + 5 * dayMs),
      note: 'Coach accept → then npm run dev:simulate-capture → confirmed + messaging',
    },
    {
      label: 'pending_for_decline',
      scheduledAt: new Date(now + 6 * dayMs),
      note: 'Coach PUT .../decline → cancelled, PI voided (dev stub)',
    },
    {
      label: 'pending_for_cancel',
      scheduledAt: new Date(now + 7 * dayMs),
      note: 'Student/coach POST .../cancel → cancelled, PI voided (dev stub)',
    },
  ];

  const created = [];

  for (const spec of specs) {
    const scheduledAtIso = spec.scheduledAt.toISOString();
    const booking = await Booking.create({
      lesson_id: lesson.id,
      coach_id: coach.id,
      primary_student_id: student.id,
      scheduled_at: spec.scheduledAt,
      duration_minutes: lesson.duration_minutes,
      price: lesson.price,
      court_location_id: courtId,
      status: 'pending',
      payout_status: 'none',
      messaging_locked: true,
      idempotency_key: idemKey(spec.label),
    });

    const payment = await createAuthorizeFirstPayment(booking, {
      label: spec.label,
      scheduledAtIso,
    });

    created.push({
      label: spec.label,
      booking_id: booking.id,
      payment_id: payment.id,
      payment_intent_id: payment.payment_intent_id,
      scheduled_at: scheduledAtIso,
      note: spec.note,
    });
  }

  console.log('\nBooking action test seeds (authorize-first shape, dev Stripe stubs):\n');
  console.log(
    JSON.stringify(
      {
        credentials: {
          coach: { email: coach.email, password: 'Test1234!Ab' },
          student: { email: student.email, password: 'Test1234!Ab' },
        },
        bookings: created,
        playbook: {
          accept: {
            step1: 'PUT /api/bookings/:id/accept as coach (pending_for_accept booking_id)',
            step2: 'npm run dev:simulate-capture -- --booking-id=<id>',
            step3: 'GET /api/bookings/:id → status confirmed, messaging_locked false',
          },
          decline: {
            endpoint: 'PUT /api/bookings/:id/decline',
            booking_id: created.find((b) => b.label === 'pending_for_decline')?.booking_id,
            body: {
              message_to_student: 'Sorry, that time no longer works. Please pick another slot.',
              decline_reason_code: 'availability_conflict',
            },
          },
          cancel: {
            endpoint: 'POST /api/bookings/:id/cancel',
            booking_id: created.find((b) => b.label === 'pending_for_cancel')?.booking_id,
            body: { reason: 'schedule_conflict' },
          },
        },
      },
      null,
      2,
    ),
  );

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
