/**
 * Seed bookings for manual booking-status presentation QA (list ↔ detail ↔ nav dot).
 *
 * Covers: pending, confirmed, awaiting_verification (×4), completed (open / paid / refunded),
 * issue reported (open dispute), disputed (status only — Payment dispute under review),
 * cancelled, student_no_show.
 *
 * Idempotent — destroys prior rows with idempotency_key prefix `qa_status_ux_`.
 *
 * Defaults:
 *   student: adamduan0312@gmail.com
 *   coach:   adamduan0312+coach@gmail.com  (Chris Martinez)
 *
 * Usage (from backend/):
 *   npm run seed:booking-status-ux
 *   node scripts/seed-booking-status-presentation-qa.js
 *   node scripts/seed-booking-status-presentation-qa.js --coach-email=coach.davie.ftlaud@picklecoach.example.org
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
  Dispute,
  DisputeType,
  DisputeResolutionAction,
  Payment,
  Conversation,
  ConversationRead,
  Message,
  Review,
  Notification,
} from '../models/index.js';
import { ACTIVE_DISPUTE_TYPE_CODES } from '../utils/disputeTypeCatalog.js';
import { calculatePaymentAmounts } from '../services/paymentEngine.js';
import { registerDevSeedPaymentIntent } from '../services/stripeService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const IDEM_PREFIX = 'qa_status_ux_';
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;

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
    charge_id: `ch_seed_dev_${booking.id}`,
  }, { transaction });
}

/** Normal completed settlement: captured charge released to coach. */
async function ensureReleasedPayment(booking, { label, transaction }) {
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
    escrow_status: 'released',
    payment_status: 'captured',
    refund_status: 'none',
    payment_method: 'stripe',
    payment_intent_id: paymentIntentId,
    charge_id: `ch_seed_dev_${booking.id}`,
    transfer_id: `tr_seed_dev_${booking.id}`,
  }, { transaction });
}

/**
 * Completed lesson + later full refund (e.g. admin resolved student complaint).
 * Attendance stays completed; money outcome is separate.
 */
async function ensureRefundedPayment(booking, { label, transaction }) {
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
    coach_payout_expected: 0,
    escrow_status: 'refunded',
    payment_status: 'refunded',
    refund_status: 'succeeded',
    refunded_amount: amounts.total_charge_to_student,
    payment_method: 'stripe',
    payment_intent_id: paymentIntentId,
    charge_id: `ch_seed_dev_${booking.id}`,
    stripe_refund_id: `re_seed_dev_${booking.id}`,
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

/** @param {Date} anchor */
function buildSpecs(anchor, durationMinutes) {
  const durMs = durationMinutes * 60 * 1000;
  return [
    {
      key: 'pending',
      expect: { student: 'Requested', coach: 'Response needed', detailHeadline: 'Booking requested / Response needed' },
      navDot: { student: false, coach: true },
      fields: {
        status: 'pending',
        scheduled_at: new Date(anchor.getTime() + dayMs + 3 * hourMs),
        created_at: new Date(anchor.getTime() - 2 * hourMs),
        payout_status: 'none',
        messaging_locked: true,
      },
      payment: 'authorized',
    },
    {
      key: 'confirmed',
      expect: { student: 'Confirmed', coach: 'Confirmed', detailHeadline: 'Booking confirmed' },
      navDot: { student: false, coach: false },
      fields: {
        status: 'confirmed',
        scheduled_at: new Date(anchor.getTime() + 2 * dayMs),
        created_at: new Date(anchor.getTime() - 3 * dayMs),
        payout_status: 'none',
        messaging_locked: false,
      },
      payment: 'captured',
    },
    {
      key: 'awaiting_verification',
      expect: { student: 'Awaiting confirmation', coach: 'Confirmation needed', detailHeadline: 'Confirm lesson attendance / Awaiting confirmation' },
      navDot: { student: false, coach: true },
      fields: {
        status: 'awaiting_verification',
        // Lesson ended ~2h ago so coach can complete / no-show.
        scheduled_at: new Date(anchor.getTime() - 2 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 5 * dayMs),
        payout_status: 'awaiting_verification',
        messaging_locked: false,
      },
      payment: 'captured',
    },
    {
      key: 'awaiting_verification_2',
      expect: { student: 'Awaiting confirmation', coach: 'Confirmation needed', detailHeadline: 'Confirm lesson attendance / Awaiting confirmation' },
      navDot: { student: false, coach: true },
      fields: {
        status: 'awaiting_verification',
        // Second copy — lesson ended ~3.5h ago (distinct slot from awaiting_verification).
        scheduled_at: new Date(anchor.getTime() - 3.5 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 5.5 * dayMs),
        payout_status: 'awaiting_verification',
        messaging_locked: false,
      },
      payment: 'captured',
    },
    {
      key: 'awaiting_verification_3',
      expect: { student: 'Awaiting confirmation', coach: 'Confirmation needed', detailHeadline: 'Confirm lesson attendance / Awaiting confirmation' },
      navDot: { student: false, coach: true },
      fields: {
        status: 'awaiting_verification',
        scheduled_at: new Date(anchor.getTime() - 5 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 6 * dayMs),
        payout_status: 'awaiting_verification',
        messaging_locked: false,
      },
      payment: 'captured',
    },
    {
      key: 'awaiting_verification_4',
      expect: { student: 'Awaiting confirmation', coach: 'Confirmation needed', detailHeadline: 'Confirm lesson attendance / Awaiting confirmation' },
      navDot: { student: false, coach: true },
      fields: {
        status: 'awaiting_verification',
        scheduled_at: new Date(anchor.getTime() - 7 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 6.5 * dayMs),
        payout_status: 'awaiting_verification',
        messaging_locked: false,
      },
      payment: 'captured',
    },
    {
      key: 'completed_review_open',
      expect: { student: 'Completed', coach: 'Completed', detailHeadline: 'Lesson complete (+ 24h issue-reporting copy)' },
      navDot: { student: false, coach: false },
      fields: {
        status: 'completed',
        scheduled_at: new Date(anchor.getTime() - 4 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 6 * dayMs),
        payout_status: 'pending',
        messaging_locked: false,
      },
      payment: 'captured',
    },
    {
      key: 'completed_paid',
      expect: {
        student: 'Completed',
        coach: 'Completed',
        detailHeadline: 'Lesson complete + Payment released (normal settlement)',
      },
      navDot: { student: false, coach: false },
      fields: {
        status: 'completed',
        // >24h past lesson end so issue-reporting window is closed.
        scheduled_at: new Date(anchor.getTime() - 30 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 8 * dayMs),
        payout_status: 'paid',
        messaging_locked: false,
      },
      payment: 'released',
    },
    {
      key: 'completed_refunded',
      expect: {
        student: 'Completed',
        coach: 'Completed',
        detailHeadline: 'Lesson complete + later full refund ($0 coach payout) + View issue resolution',
      },
      navDot: { student: false, coach: false },
      fields: {
        status: 'completed',
        scheduled_at: new Date(anchor.getTime() - 32 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 9 * dayMs),
        payout_status: 'none',
        messaging_locked: false,
      },
      payment: 'refunded',
      resolvedIssue: true,
    },
    {
      key: 'issue_reported',
      expect: { student: 'Issue reported', coach: 'Issue reported', detailHeadline: 'Issue reported + persistent panel' },
      navDot: { student: true, coach: true },
      fields: {
        status: 'completed',
        scheduled_at: new Date(anchor.getTime() - 6 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 7 * dayMs),
        payout_status: 'pending',
        messaging_locked: false,
      },
      payment: 'captured',
      openIssue: true,
    },
    {
      key: 'disputed',
      expect: { student: 'Payment dispute under review', coach: 'Payment dispute under review', admin: 'Disputed' },
      navDot: { student: true, coach: true },
      fields: {
        status: 'disputed',
        scheduled_at: new Date(anchor.getTime() - dayMs - durMs),
        created_at: new Date(anchor.getTime() - 10 * dayMs),
        payout_status: 'none',
        messaging_locked: false,
      },
      payment: 'captured',
      // No open dispute row — customer label is "Payment dispute under review", admin "Disputed".
    },
    {
      key: 'cancelled',
      expect: { student: 'Cancelled', coach: 'Cancelled', detailHeadline: 'Booking cancelled' },
      navDot: { student: false, coach: false },
      fields: {
        status: 'cancelled',
        scheduled_at: new Date(anchor.getTime() + 3 * dayMs),
        created_at: new Date(anchor.getTime() - 4 * dayMs),
        cancelled_by: 'student',
        cancelled_at: new Date(anchor.getTime() - dayMs),
        payout_status: 'none',
        messaging_locked: true,
      },
    },
    {
      key: 'student_no_show',
      expect: { student: 'Student no-show', coach: 'Student no-show' },
      navDot: { student: true, coach: false },
      fields: {
        status: 'student_no_show',
        scheduled_at: new Date(anchor.getTime() - 8 * hourMs - durMs),
        created_at: new Date(anchor.getTime() - 9 * dayMs),
        payout_status: 'pending',
        messaging_locked: false,
      },
      payment: 'captured',
    },
  ];
}

async function main() {
  const studentEmail = getArg('student-email') || 'adamduan0312@gmail.com';
  const coachEmail = getArg('coach-email') || 'adamduan0312+coach@gmail.com';

  try {
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

    if (student.id === coach.id) {
      console.error('Student and coach must be different users.');
      process.exit(1);
    }

    const lesson = await pickLesson(coach.id);
    if (!lesson) {
      console.error(`No active lesson for coach ${coach.full_name} (${coachEmail}).`);
      process.exit(1);
    }

    const disputeType = await DisputeType.findOne({
      where: { code: ACTIVE_DISPUTE_TYPE_CODES[0] },
    });
    if (!disputeType) {
      console.error(`Missing dispute type ${ACTIVE_DISPUTE_TYPE_CODES[0]}. Run migrations.`);
      process.exit(1);
    }

    const refundAction = await DisputeResolutionAction.findOne({
      where: { code: 'approved_refund' },
    });
    if (!refundAction) {
      console.error('Missing dispute_resolution_actions code approved_refund. Run migrations/seeds.');
      process.exit(1);
    }

    const courtId = await pickCourtId(coach.id);
    const anchor = new Date();
    const specs = buildSpecs(anchor, lesson.duration_minutes || 60);

    const created = await sequelize.transaction(async (t) => {
      const prior = await Booking.findAll({
        where: { idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` } },
        attributes: ['id'],
        transaction: t,
      });
      const priorIds = prior.map((b) => b.id);
      if (priorIds.length) {
        const conversations = await Conversation.findAll({
          where: { booking_id: { [Op.in]: priorIds } },
          attributes: ['id'],
          transaction: t,
        });
        const conversationIds = conversations.map((c) => c.id);
        if (conversationIds.length) {
          await ConversationRead.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, transaction: t });
          await Message.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, transaction: t });
          await Conversation.destroy({ where: { id: { [Op.in]: conversationIds } }, transaction: t });
        }
        await Review.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction: t });
        await Notification.destroy({
          where: {
            [Op.or]: [
              { entity_type: 'booking', entity_id: { [Op.in]: priorIds } },
              { entity_type: 'dispute', entity_id: { [Op.in]: priorIds } },
            ],
          },
          transaction: t,
        });
        await sequelize.query(
          'UPDATE payments SET dispute_id = NULL WHERE booking_id IN (:ids)',
          { replacements: { ids: priorIds }, transaction: t },
        );
        await Dispute.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction: t });
        await Payment.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction: t });
        await Booking.destroy({ where: { id: { [Op.in]: priorIds } }, transaction: t });
      }

      const rows = [];
      for (const spec of specs) {
        const { key, fields, payment, openIssue, resolvedIssue, expect, navDot } = spec;
        const booking = await Booking.create(
          {
            lesson_id: lesson.id,
            coach_id: coach.id,
            primary_student_id: student.id,
            duration_minutes: lesson.duration_minutes,
            price: lesson.price,
            court_location_id: courtId,
            idempotency_key: `${IDEM_PREFIX}${key}`,
            ...fields,
          },
          { transaction: t },
        );

        let paymentRow = null;
        if (payment === 'authorized') {
          paymentRow = await ensureAuthorizedPayment(booking, { label: key, transaction: t });
        } else if (payment === 'captured') {
          paymentRow = await ensureCapturedPayment(booking, { label: key, transaction: t });
        } else if (payment === 'released') {
          paymentRow = await ensureReleasedPayment(booking, { label: key, transaction: t });
        } else if (payment === 'refunded') {
          paymentRow = await ensureRefundedPayment(booking, { label: key, transaction: t });
        }

        let disputeId = null;
        if (openIssue) {
          const dispute = await Dispute.create(
            {
              booking_id: booking.id,
              dispute_type_id: disputeType.id,
              opened_by: 'student',
              status: 'open',
              notes: 'QA seed: presentation check for Issue reported panel.',
            },
            { transaction: t },
          );
          disputeId = dispute.id;
        } else if (resolvedIssue) {
          const amounts = calculatePaymentAmounts(booking.price);
          const refundCents = Math.round(Number(amounts.total_charge_to_student) * 100);
          const openedAt = new Date(booking.scheduled_at.getTime() + (booking.duration_minutes || 60) * 60 * 1000 + hourMs);
          const resolvedAt = new Date(openedAt.getTime() + 2 * hourMs);
          const dispute = await Dispute.create(
            {
              booking_id: booking.id,
              dispute_type_id: disputeType.id,
              opened_by: 'student',
              status: 'resolved',
              notes: 'QA seed: student reported a problem after the lesson was marked complete.',
              decision: 'upheld',
              resolution_action_id: refundAction.id,
              resolution_notes: 'Your issue was reviewed and a full refund was approved.',
              refund_cents: refundCents,
              opened_at: openedAt,
              resolved_at: resolvedAt,
            },
            { transaction: t },
          );
          disputeId = dispute.id;
          if (paymentRow) {
            await paymentRow.update({ dispute_id: dispute.id }, { transaction: t });
          }
        }

        rows.push({
          key,
          booking_id: booking.id,
          status: booking.status,
          scheduled_at: booking.scheduled_at,
          dispute_id: disputeId,
          expect,
          navDot,
          detail_url: `/bookings/${booking.id}`,
          issue_url: disputeId ? `/issues/${disputeId}` : null,
        });
      }
      return rows;
    });

    console.log('Seeded booking-status presentation QA matrix\n');
    console.log(JSON.stringify({
      student: { id: student.id, email: student.email, password_hint: 'Test1234!Ab' },
      coach: { id: coach.id, email: coach.email, name: coach.full_name, password_hint: 'Test1234!Ab' },
      lesson: { id: lesson.id, title: lesson.title },
      checklist: [
        'Student My bookings → badge matches expect.student; open row → detail headline/badge coherent',
        'Coach Bookings → badge matches expect.coach; awaiting_verification → Confirmation needed → Confirm lesson attendance',
        'issue_reported → Issue reported both sides + persistent warning panel (no green flash)',
        'disputed → customer Payment dispute under review; admin /admin/bookings/:id still Disputed',
        'completed_review_open → Completed + open issue-reporting banner; Bookings ● OFF',
        'completed_paid → Completed + Payment released (normal settlement)',
        'completed_refunded → Completed + later refund / $0 payout (attendance vs money are separate)',
        'Nav ● ON for coach: pending + awaiting_verification + issue_reported + disputed',
        'Nav ● ON for student: issue_reported + disputed + (contestable) student_no_show',
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
