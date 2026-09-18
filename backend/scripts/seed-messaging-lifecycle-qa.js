/**
 * Messaging lifecycle QA — closed vs open send rules for testflow student/coach.
 *
 * Idempotent — destroys prior rows with idempotency_key prefix `qa_msg_lifecycle_`.
 *
 * Covers manual checks:
 *   - completed + thread → View messages, full history, no composer
 *   - completed without thread → no create / no View messages
 *   - confirmed + awaiting_verification → can send
 *   - cancelled / no-show / disputed / pending → cannot send; history readable when threaded
 *   - status-specific closed notices
 *
 * Prerequisites (from backend/):
 *   npm run seed:test-flows
 *
 * Run:
 *   npm run seed:messaging-lifecycle-qa
 *
 * Login: student.testflow@picklecoach.example.org / Test1234!Ab
 *        coach.testflow@picklecoach.example.org / Test1234!Ab
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
import { messagingLockedValueForStatus } from '../utils/bookingMessaging.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const IDEM_PREFIX = 'qa_msg_lifecycle_';
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const minMs = 60 * 1000;

const STUDENT_EMAIL = 'student.testflow@picklecoach.example.org';
const COACH_EMAIL = 'coach.testflow@picklecoach.example.org';

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

function buildThreadMessages({ conversationId, studentId, coachId, label }) {
  const now = Date.now();
  const lines = [
    { from: 'student', text: `[${label}] Hi — confirming the lesson details.` },
    { from: 'coach', text: `[${label}] Confirmed. See you at the court.` },
    { from: 'student', text: `[${label}] Quick question about parking.` },
    { from: 'coach', text: `[${label}] East lot is usually open.` },
    { from: 'student', text: `[${label}] Thanks — last pre-lesson note.` },
    { from: 'coach', text: `[${label}] Closing note for history QA.` },
  ];
  return lines.map((row, i) => {
    const created = new Date(now - (lines.length - i) * 12 * minMs);
    return {
      conversation_id: conversationId,
      sender_id: row.from === 'coach' ? coachId : studentId,
      message_text: row.text,
      created_at: created,
      updated_at: created,
    };
  });
}

function buildSpecs(anchor, durationMinutes) {
  const durMs = durationMinutes * 60 * 1000;
  return [
    {
      key: 'completed_with_thread',
      check: 'Completed + thread → View messages, history, no composer',
      expectSend: false,
      withThread: true,
      fields: {
        status: 'completed',
        scheduled_at: new Date(anchor.getTime() - 30 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 5 * dayMs),
        payout_status: 'pending',
      },
      payment: 'captured',
    },
    {
      key: 'completed_no_thread',
      check: 'Completed without thread → no View messages / must not create thread',
      expectSend: false,
      withThread: false,
      fields: {
        status: 'completed',
        scheduled_at: new Date(anchor.getTime() - 32 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 6 * dayMs),
        payout_status: 'pending',
      },
      payment: 'captured',
    },
    {
      key: 'confirmed_can_send',
      check: 'Confirmed → Open conversation + composer / send works',
      expectSend: true,
      withThread: true,
      fields: {
        status: 'confirmed',
        scheduled_at: new Date(anchor.getTime() + 2 * dayMs),
        created_at: new Date(anchor.getTime() - dayMs),
        payout_status: 'none',
      },
      payment: 'captured',
    },
    {
      key: 'awaiting_verification_can_send',
      check: 'Awaiting verification → still can send',
      expectSend: true,
      withThread: true,
      fields: {
        status: 'awaiting_verification',
        scheduled_at: new Date(anchor.getTime() - 3 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 3 * dayMs),
        payout_status: 'awaiting_verification',
      },
      payment: 'captured',
    },
    {
      key: 'cancelled_with_thread',
      check: 'Cancelled → closed notice; history readable; no send',
      expectSend: false,
      withThread: true,
      fields: {
        status: 'cancelled',
        scheduled_at: new Date(anchor.getTime() + 4 * dayMs),
        created_at: new Date(anchor.getTime() - 4 * dayMs),
        cancelled_by: 'student',
        cancelled_at: new Date(anchor.getTime() - hourMs),
        payout_status: 'none',
      },
      payment: null,
    },
    {
      key: 'coach_no_show_with_thread',
      check: 'Coach no-show → closed notice; history readable; no send',
      expectSend: false,
      withThread: true,
      fields: {
        status: 'coach_no_show',
        scheduled_at: new Date(anchor.getTime() - 40 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 7 * dayMs),
        payout_status: 'none',
      },
      payment: 'captured',
    },
    {
      key: 'student_no_show_with_thread',
      check: 'Student no-show → closed notice; history readable; no send',
      expectSend: false,
      withThread: true,
      fields: {
        status: 'student_no_show',
        scheduled_at: new Date(anchor.getTime() - 42 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 8 * dayMs),
        payout_status: 'pending',
      },
      payment: 'captured',
    },
    {
      key: 'disputed_with_thread',
      check: 'Disputed → dispute closed notice; history readable; no send',
      expectSend: false,
      withThread: true,
      fields: {
        status: 'disputed',
        scheduled_at: new Date(anchor.getTime() - 36 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 9 * dayMs),
        payout_status: 'none',
      },
      payment: 'captured',
    },
    {
      key: 'pending_no_send',
      check: 'Pending → messaging opens after accept; cannot send',
      expectSend: false,
      withThread: false,
      fields: {
        status: 'pending',
        scheduled_at: new Date(anchor.getTime() + 5 * dayMs),
        created_at: new Date(anchor.getTime() - hourMs),
        payout_status: 'none',
      },
      payment: 'authorized',
    },
  ];
}

async function wipePrior(transaction) {
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
    await ConversationRead.destroy({
      where: { conversation_id: { [Op.in]: conversationIds } },
      transaction,
    });
    await Message.destroy({
      where: { conversation_id: { [Op.in]: conversationIds } },
      transaction,
    });
    await Conversation.destroy({
      where: { id: { [Op.in]: conversationIds } },
      transaction,
    });
  }

  await Review.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
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
  await Dispute.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Payment.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Booking.destroy({ where: { id: { [Op.in]: priorIds } }, transaction });
}

async function main() {
  try {
    await sequelize.authenticate();

    const student = await findUserByEmail(STUDENT_EMAIL, 'student');
    if (!student) {
      console.error(`Student not found: ${STUDENT_EMAIL}. Run: npm run seed:test-flows`);
      process.exit(1);
    }
    const coach = await findUserByEmail(COACH_EMAIL, 'coach');
    if (!coach) {
      console.error(`Coach not found: ${COACH_EMAIL}. Run: npm run seed:test-flows`);
      process.exit(1);
    }

    const lesson = await pickLesson(coach.id);
    if (!lesson) {
      console.error('No active lesson for testflow coach. Run: npm run seed:test-flows');
      process.exit(1);
    }
    const courtId = await pickCourtId(coach.id);
    const anchor = new Date();
    const specs = buildSpecs(anchor, lesson.duration_minutes || 60);

    const created = await sequelize.transaction(async (t) => {
      await wipePrior(t);
      const rows = [];

      for (const spec of specs) {
        const status = spec.fields.status;
        const booking = await Booking.create(
          {
            lesson_id: lesson.id,
            coach_id: coach.id,
            primary_student_id: student.id,
            duration_minutes: lesson.duration_minutes,
            price: lesson.price,
            court_location_id: courtId,
            messaging_locked: messagingLockedValueForStatus(status),
            attendance_finalized: ['completed', 'coach_no_show', 'student_no_show', 'disputed', 'cancelled'].includes(status),
            idempotency_key: `${IDEM_PREFIX}${spec.key}`,
            ...spec.fields,
          },
          { transaction: t },
        );

        if (spec.payment === 'captured') {
          await ensureCapturedPayment(booking, { label: spec.key, transaction: t });
        } else if (spec.payment === 'authorized') {
          await ensureAuthorizedPayment(booking, { label: spec.key, transaction: t });
        }

        let conversationId = null;
        let messageCount = 0;
        if (spec.withThread) {
          const conversation = await Conversation.create(
            { booking_id: booking.id },
            { transaction: t },
          );
          conversationId = conversation.id;
          const messages = buildThreadMessages({
            conversationId,
            studentId: student.id,
            coachId: coach.id,
            label: spec.key,
          });
          await Message.bulkCreate(messages, { transaction: t });
          messageCount = messages.length;
          await conversation.update({ updated_at: new Date() }, { transaction: t });
        }

        rows.push({
          key: spec.key,
          check: spec.check,
          booking_id: booking.id,
          status: booking.status,
          messaging_locked: booking.messaging_locked,
          expect_send: spec.expectSend,
          conversation_id: conversationId,
          message_count: messageCount,
          detail_url: `/bookings/${booking.id}`,
          messages_url: conversationId ? `/messages/${conversationId}` : null,
        });
      }

      return rows;
    });

    console.log('Seeded messaging lifecycle QA\n');
    console.log(JSON.stringify({
      student: { id: student.id, email: student.email, password_hint: 'Test1234!Ab' },
      coach: { id: coach.id, email: coach.email, password_hint: 'Test1234!Ab' },
      lesson: { id: lesson.id, title: lesson.title },
      checklist: [
        'completed_with_thread → booking shows View messages; thread has history; no composer/send',
        'completed_no_thread → no View messages; opening conversation create must fail / not invent a thread',
        'confirmed_can_send + awaiting_verification_can_send → Open conversation + send works',
        'cancelled / coach_no_show / student_no_show / disputed → View messages + closed notice; no send',
        'pending_no_send → pending copy; cannot send',
        'disputed_with_thread notice mentions payment dispute',
      ],
      bookings: created,
    }, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
