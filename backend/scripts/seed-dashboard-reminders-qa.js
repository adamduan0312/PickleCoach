/**
 * Seed bookings to exercise dashboard reminder queues (multi-item banners).
 *
 * Creates for the student/coach pair:
 * - 3 pending requests (coach response + student waiting-for-accept queue)
 * - 5 awaiting_verification (coach attendance queue; student review window)
 *
 * Idempotent — destroys prior rows with idempotency_key prefix `qa_dash_remind_`.
 *
 * Usage (from backend/):
 *   npm run seed:dashboard-reminders-qa
 *   node scripts/seed-dashboard-reminders-qa.js
 *   node scripts/seed-dashboard-reminders-qa.js \
 *     --student-email=student.testflow@picklecoach.example.org \
 *     --coach-email=coach.testflow@picklecoach.example.org
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  Booking,
  Lesson,
  User,
  UserRole,
  CoachCourtLocation,
  CourtLocation,
  Payment,
  Conversation,
  ConversationRead,
  Message,
  Review,
  Notification,
  Dispute,
} from '../models/index.js';
import { calculatePaymentAmounts } from '../services/paymentEngine.js';
import { registerDevSeedPaymentIntent } from '../services/stripeService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const IDEM_PREFIX = 'qa_dash_remind_';
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

const getArg = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
};

async function findUserByEmail(email, role) {
  return User.findOne({
    where: { email, is_active: true, deleted_at: null },
    include: [{ model: UserRole, as: 'userRoles', where: { role }, required: true }],
  });
}

async function pickLesson(coachId) {
  return Lesson.findOne({
    where: { coach_id: coachId, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
  });
}

async function pickCourtId(coachId) {
  const link = await CoachCourtLocation.findOne({
    where: { coach_id: coachId },
    include: [{ model: CourtLocation, as: 'court', where: { deleted_at: null }, required: true }],
    order: [['id', 'ASC']],
  });
  return link?.court?.id ?? null;
}

async function ensureAuthorizedPayment(booking, { label, transaction }) {
  const amounts = calculatePaymentAmounts(booking.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  const amountCapturableCents = Math.round(totalCharge * 100);
  const paymentIntentId = `pi_seed_dev_${IDEM_PREFIX}${label}_${booking.id}`;
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
    escrow_status: 'pending',
    payment_status: 'authorized',
    refund_status: 'none',
    payment_method: 'stripe',
    payment_intent_id: paymentIntentId,
  }, { transaction });
}

async function ensureCapturedPayment(booking, { label, transaction }) {
  const amounts = calculatePaymentAmounts(booking.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  const amountCapturableCents = Math.round(totalCharge * 100);
  const paymentIntentId = `pi_seed_dev_${IDEM_PREFIX}${label}_${booking.id}`;
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
    payment_status: 'captured',
    refund_status: 'none',
    payment_method: 'stripe',
    payment_intent_id: paymentIntentId,
    charge_id: `ch_seed_dev_${IDEM_PREFIX}${booking.id}`,
  }, { transaction });
}

function buildSpecs(anchor, durationMinutes) {
  const durMs = durationMinutes * 60 * 1000;
  const pending = [1, 2, 3].map((n) => ({
    key: `pending_${n}`,
    fields: {
      status: 'pending',
      // Stagger deadlines via created_at / scheduled_at so queue order is stable.
      scheduled_at: new Date(anchor.getTime() + (n + 1) * dayMs + 2 * hourMs),
      created_at: new Date(anchor.getTime() - n * hourMs),
      payout_status: 'none',
      messaging_locked: true,
    },
    payment: 'authorized',
  }));

  // Earliest scheduled first in the attendance queue — stagger ended lessons.
  const awaiting = [1, 2, 3, 4, 5].map((n) => ({
    key: `awaiting_${n}`,
    fields: {
      status: 'awaiting_verification',
      scheduled_at: new Date(anchor.getTime() - (n + 1) * hourMs - durMs),
      created_at: new Date(anchor.getTime() - (5 + n) * dayMs),
      payout_status: 'awaiting_verification',
      messaging_locked: false,
    },
    payment: 'captured',
  }));

  return [...pending, ...awaiting];
}

async function destroyPrior(transaction) {
  const prior = await Booking.findAll({
    where: { idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` } },
    attributes: ['id'],
    transaction,
  });
  const priorIds = prior.map((b) => b.id);
  if (!priorIds.length) return;

  const conversations = await Conversation.findAll({
    where: { booking_id: { [Op.in]: priorIds } },
    attributes: ['id'],
    transaction,
  });
  const conversationIds = conversations.map((c) => c.id);
  if (conversationIds.length) {
    await ConversationRead.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, transaction });
    await Message.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, transaction });
    await Conversation.destroy({ where: { id: { [Op.in]: conversationIds } }, transaction });
  }
  await Review.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Dispute.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Notification.destroy({
    where: {
      [Op.or]: [
        { entity_type: 'booking', entity_id: { [Op.in]: priorIds } },
        { entity_type: 'dispute', entity_id: { [Op.in]: priorIds } },
      ],
    },
    transaction,
  });
  await sequelize.query(
    'UPDATE payments SET dispute_id = NULL WHERE booking_id IN (:ids)',
    { replacements: { ids: priorIds }, transaction },
  );
  await Payment.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Booking.destroy({ where: { id: { [Op.in]: priorIds } }, transaction, force: true });
}

async function main() {
  const studentEmail = getArg('student-email') || 'student.testflow@picklecoach.example.org';
  const coachEmail = getArg('coach-email') || 'coach.testflow@picklecoach.example.org';

  await sequelize.authenticate();

  const student = await findUserByEmail(studentEmail, 'student');
  if (!student) {
    console.error(`Student not found: ${studentEmail}`);
    process.exit(1);
  }
  const coach = await findUserByEmail(coachEmail, 'coach');
  if (!coach) {
    console.error(`Coach not found: ${coachEmail}`);
    process.exit(1);
  }
  const lesson = await pickLesson(coach.id);
  if (!lesson) {
    console.error(`No active lesson for coach ${coachEmail}`);
    process.exit(1);
  }
  const courtId = await pickCourtId(coach.id);
  const durationMinutes = lesson.duration_minutes || 60;
  const price = Number(lesson.price) || 55;
  const anchor = new Date();
  const specs = buildSpecs(anchor, durationMinutes);

  const created = await sequelize.transaction(async (t) => {
    await destroyPrior(t);

    // Keep reminder counts clean: neutralize other pending / awaiting rows for this pair
    // so only this seed’s queue drives the dashboard banners.
    await Booking.update(
      {
        status: 'cancelled',
        cancelled_by: 'system',
        cancelled_at: new Date(),
        cancellation_reason: 'other',
        cancellation_reason_notes: 'Cleared for dashboard-reminders QA seed',
        payout_status: 'none',
        messaging_locked: true,
      },
      {
        where: {
          coach_id: coach.id,
          primary_student_id: student.id,
          status: { [Op.in]: ['pending', 'awaiting_verification'] },
          idempotency_key: { [Op.notLike]: `${IDEM_PREFIX}%` },
        },
        transaction: t,
      },
    );

    const rows = [];
    for (const spec of specs) {
      const booking = await Booking.create({
        coach_id: coach.id,
        primary_student_id: student.id,
        lesson_id: lesson.id,
        court_location_id: courtId,
        duration_minutes: durationMinutes,
        price,
        idempotency_key: `${IDEM_PREFIX}${spec.key}`,
        ...spec.fields,
      }, { transaction: t });

      if (spec.payment === 'authorized') {
        await ensureAuthorizedPayment(booking, { label: spec.key, transaction: t });
      } else {
        await ensureCapturedPayment(booking, { label: spec.key, transaction: t });
      }

      rows.push({
        key: spec.key,
        booking_id: booking.id,
        status: booking.status,
        scheduled_at: booking.scheduled_at,
      });
    }
    return rows;
  });

  const pending = created.filter((r) => r.status === 'pending');
  const awaiting = created.filter((r) => r.status === 'awaiting_verification')
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  console.log(JSON.stringify({
    student_email: studentEmail,
    coach_email: coachEmail,
    password_hint: 'Test1234!Ab (testflow default)',
    coach_dashboard: '/coach',
    student_dashboard: '/dashboard',
    expect: {
      coach: [
        `Response needed on ${pending.length} booking requests → next #${pending[0]?.booking_id}`,
        `Confirm attendance for ${awaiting.length} finished lessons → next #${awaiting[0]?.booking_id}`,
      ],
      student: [
        `Waiting for coaches to accept ${pending.length} requests → next #${pending[0]?.booking_id}`,
        `Review window open for ${awaiting.length} recent lessons → next #${awaiting[0]?.booking_id}`,
      ],
    },
    pending_queue: pending.map((r) => r.booking_id),
    attendance_review_queue: awaiting.map((r) => r.booking_id),
    bookings: created,
  }, null, 2));

  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
