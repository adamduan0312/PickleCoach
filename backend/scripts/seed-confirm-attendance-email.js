/**
 * Seed one awaiting_verification booking and send confirm_attendance_reminder
 * (in-app + email) so you can preview the new dual-channel email.
 *
 * Defaults:
 *   STUDENT_EMAIL=adamduan0312@gmail.com
 *   COACH_EMAIL=adamduan0312+coach@gmail.com
 *
 * Prerequisites: SENDGRID_* in .env.development
 *
 * Run from backend/:
 *   npm run seed:confirm-attendance-email
 *   node scripts/seed-confirm-attendance-email.js
 *   node scripts/seed-confirm-attendance-email.js --force   # resend even if already sent
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}
if (!process.env.SENDGRID_API_KEY) {
  console.error('SENDGRID_API_KEY required in .env.development');
  process.exit(1);
}

import {
  sequelize,
  User,
  Lesson,
  CoachCourtLocation,
  Booking,
  Payment,
  Notification,
} from '../models/index.js';
import { calculatePaymentAmounts } from '../services/paymentEngine.js';
import { registerDevSeedPaymentIntent } from '../services/stripeService.js';
import { notifyCoachConfirmAttendanceReminder } from '../services/notificationService.js';

const IDEM_PREFIX = 'qa_confirm_attend_email_';
const STUDENT_EMAIL = process.env.ATTEND_STUDENT_EMAIL || 'adamduan0312@gmail.com';
const COACH_EMAIL = process.env.ATTEND_COACH_EMAIL || 'adamduan0312+coach@gmail.com';
const force = process.argv.includes('--force');

async function main() {
  await sequelize.authenticate();

  const student = await User.findOne({ where: { email: STUDENT_EMAIL, deleted_at: null } });
  if (!student) throw new Error(`Student not found: ${STUDENT_EMAIL}`);
  const coach = await User.findOne({ where: { email: COACH_EMAIL, deleted_at: null } });
  if (!coach) throw new Error(`Coach not found: ${COACH_EMAIL}`);

  const lesson = await Lesson.findOne({
    where: { coach_id: coach.id, is_active: true, deleted_at: null },
    order: [['id', 'DESC']],
  });
  if (!lesson) throw new Error(`No active lesson for coach ${COACH_EMAIL}`);

  const link = await CoachCourtLocation.findOne({ where: { coach_id: coach.id } });
  if (!link) throw new Error(`Coach has no court: ${COACH_EMAIL}`);

  const durationMinutes = Number(lesson.duration_minutes) || 60;
  const durationMs = durationMinutes * 60 * 1000;
  // Lesson ended ~2 hours ago → within the 24h attendance window.
  const scheduledAt = new Date(Date.now() - durationMs - 2 * 60 * 60 * 1000);
  const idempotencyKey = `${IDEM_PREFIX}${Date.now()}`;

  const booking = await sequelize.transaction(async (transaction) => {
    const created = await Booking.create(
      {
        lesson_id: lesson.id,
        coach_id: coach.id,
        primary_student_id: student.id,
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
        price: lesson.price,
        status: 'awaiting_verification',
        payout_status: 'awaiting_verification',
        attendance_finalized: false,
        messaging_locked: false,
        court_location_id: link.court_id,
        idempotency_key: idempotencyKey,
      },
      { transaction },
    );

    const amounts = calculatePaymentAmounts(created.price);
    const totalCharge = Number(amounts.total_charge_to_student) || 0;
    const paymentIntentId = `pi_seed_dev_${IDEM_PREFIX}${created.id}`;
    registerDevSeedPaymentIntent(paymentIntentId, {
      amountCapturableCents: Math.round(totalCharge * 100),
    });

    await Payment.create(
      {
        booking_id: created.id,
        coach_id: coach.id,
        student_id: student.id,
        lesson_price: amounts.lesson_price,
        platform_fee_percent: amounts.platform_fee_percent,
        platform_fee_amount: amounts.platform_fee_amount,
        total_charge_to_student: amounts.total_charge_to_student,
        coach_payout_expected: amounts.coach_payout_expected,
        escrow_status: 'held',
        payment_status: 'captured',
        refund_status: 'none',
        payment_method: 'stripe',
        payment_intent_id: paymentIntentId,
        charge_id: `ch_seed_dev_${IDEM_PREFIX}${created.id}`,
      },
      { transaction },
    );

    return created;
  });

  if (force) {
    await Notification.destroy({
      where: {
        type: 'confirm_attendance_reminder',
        entity_type: 'booking',
        entity_id: booking.id,
      },
    });
  }

  console.log('Sending confirm_attendance_reminder (in-app + email)…');
  await notifyCoachConfirmAttendanceReminder(booking.id);

  const rows = await Notification.findAll({
    where: {
      type: 'confirm_attendance_reminder',
      entity_type: 'booking',
      entity_id: booking.id,
    },
    order: [['channel', 'ASC']],
  });

  console.log('\n=== Confirm attendance email QA ===');
  console.log(
    JSON.stringify(
      {
        booking_id: booking.id,
        status: booking.status,
        scheduled_at: booking.scheduled_at,
        student: STUDENT_EMAIL,
        coach: COACH_EMAIL,
        coach_inbox: coach.email,
        sendgrid_from: process.env.SENDGRID_FROM_EMAIL || null,
        booking_url: `http://localhost:5173/bookings/${booking.id}`,
        notifications: rows.map((n) => ({
          id: n.id,
          channel: n.channel,
          status: n.status,
          sent_at: n.sent_at,
          error_message: n.error_message || null,
          headline: n.payload?.headline,
        })),
        note:
          'Check the coach Gmail inbox (and spam). Subject: Confirm your lesson attendance. ' +
          'Prior qa_confirm_attend_email_* bookings left in place for inspection.',
      },
      null,
      2,
    ),
  );

  // Optional cleanup hint for old fixtures
  const priorCount = await Booking.count({
    where: {
      idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` },
      id: { [Op.ne]: booking.id },
    },
  });
  if (priorCount > 0) {
    console.log(`\n(${priorCount} earlier ${IDEM_PREFIX}* fixtures still in DB — ignore or wipe manually)`);
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sequelize.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
