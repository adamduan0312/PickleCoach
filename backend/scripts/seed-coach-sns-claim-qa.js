/**
 * Coach student-no-show workflow QA (two bookings).
 *
 * 1. awaiting_verification within 24h → Mark Complete / Student no-show available;
 *    Report issue must NOT list student_no_show_claim
 * 2. completed (auto-complete style) within review window → no attendance buttons;
 *    Report issue must NOT list student_no_show_claim
 *
 * Backend also rejects coach POST /disputes with student_no_show_claim.
 *
 * Idempotent — keys `qa_coach_sns_awaiting` / `qa_coach_sns_completed`.
 *
 * Login: student.testflow@picklecoach.example.org / Test1234!Ab
 *        coach.testflow@picklecoach.example.org / Test1234!Ab
 *
 * Run (from backend/):
 *   npm run seed:coach-sns-claim-qa
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
  Dispute,
  Review,
  Notification,
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

const IDEM_PREFIX = 'qa_coach_sns_';
const IDEM_KEYS = [`${IDEM_PREFIX}awaiting`, `${IDEM_PREFIX}completed`, 'qa_coach_sns_claim_completed'];
const STUDENT_EMAIL = 'student.testflow@picklecoach.example.org';
const COACH_EMAIL = 'coach.testflow@picklecoach.example.org';
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

async function findUserByEmail(email, role) {
  return User.findOne({
    where: { email, is_active: true, deleted_at: null },
    include: [{ model: UserRole, as: 'userRoles', where: { role }, required: true }],
  });
}

async function wipeKeys(transaction) {
  const prior = await Booking.findAll({
    where: { idempotency_key: { [Op.in]: IDEM_KEYS } },
    attributes: ['id'],
    transaction,
  });
  const ids = prior.map((b) => b.id);
  if (!ids.length) return;

  const conversations = await Conversation.findAll({
    where: { booking_id: { [Op.in]: ids } },
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
  await Review.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await Notification.destroy({
    where: { entity_type: 'booking', entity_id: { [Op.in]: ids } },
    transaction,
  });
  await sequelize.query(
    'UPDATE payments SET dispute_id = NULL WHERE booking_id IN (:ids)',
    { replacements: { ids }, transaction },
  );
  await Dispute.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await Payment.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await Booking.destroy({ where: { id: { [Op.in]: ids } }, transaction });
}

async function createCapturedPayment(booking, { label, transaction }) {
  const amounts = calculatePaymentAmounts(booking.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  const paymentIntentId = `pi_seed_dev_${label}_${booking.id}`;
  registerDevSeedPaymentIntent(paymentIntentId, {
    amountCapturableCents: Math.round(totalCharge * 100),
  });
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
    charge_id: `ch_seed_dev_${label}_${booking.id}`,
  }, { transaction });
}

async function main() {
  try {
    await sequelize.authenticate();

    const student = await findUserByEmail(STUDENT_EMAIL, 'student');
    const coach = await findUserByEmail(COACH_EMAIL, 'coach');
    if (!student || !coach) {
      console.error('Testflow users missing. Run: npm run seed:test-flows');
      process.exit(1);
    }

    const lesson = await Lesson.findOne({
      where: { coach_id: coach.id, is_active: true, deleted_at: null },
      order: [['id', 'ASC']],
    });
    if (!lesson) {
      console.error('No active lesson for testflow coach.');
      process.exit(1);
    }

    const link = await CoachCourtLocation.findOne({
      where: { coach_id: coach.id },
      include: [{ model: CourtLocation, as: 'court', where: { deleted_at: null }, required: true }],
      order: [['id', 'ASC']],
    });
    const courtId = link?.court?.id ?? null;
    const durationMinutes = lesson.duration_minutes || 60;
    const now = Date.now();

    const specs = [
      {
        key: `${IDEM_PREFIX}awaiting`,
        status: 'awaiting_verification',
        // Lesson ended ~2h ago — attendance actions available, claim hidden.
        scheduledAt: new Date(now - 2 * hourMs - durationMinutes * 60 * 1000),
        payout_status: 'awaiting_verification',
        attendance_finalized: false,
        check: 'Within 24h: Complete + Student no-show YES; student_no_show_claim NO',
      },
      {
        key: `${IDEM_PREFIX}completed`,
        status: 'completed',
        // Auto-complete style: lesson ended ~3h ago but already completed.
        scheduledAt: new Date(now - 3 * hourMs - durationMinutes * 60 * 1000),
        payout_status: 'pending',
        attendance_finalized: false,
        check: 'Auto-completed: attendance buttons NO; student_no_show_claim NO',
      },
    ];

    const created = await sequelize.transaction(async (t) => {
      await wipeKeys(t);
      const rows = [];

      for (const spec of specs) {
        const booking = await Booking.create(
          {
            lesson_id: lesson.id,
            coach_id: coach.id,
            primary_student_id: student.id,
            scheduled_at: spec.scheduledAt,
            duration_minutes: durationMinutes,
            price: lesson.price,
            court_location_id: courtId,
            status: spec.status,
            payout_status: spec.payout_status,
            attendance_finalized: spec.attendance_finalized,
            messaging_locked: messagingLockedValueForStatus(spec.status),
            idempotency_key: spec.key,
            created_at: new Date(now - 4 * dayMs),
          },
          { transaction: t },
        );
        await createCapturedPayment(booking, { label: spec.key, transaction: t });
        rows.push({
          key: spec.key,
          check: spec.check,
          booking_id: booking.id,
          status: booking.status,
          detail_url: `/bookings/${booking.id}`,
        });
      }
      return rows;
    });

    console.log(JSON.stringify({
      student: { email: STUDENT_EMAIL, password_hint: 'Test1234!Ab' },
      coach: { email: COACH_EMAIL, password_hint: 'Test1234!Ab' },
      enforce: [
        'Frontend: Report issue omits student_no_show_claim for coaches',
        'Backend: POST /disputes with student_no_show_claim → 400 dispute_create_student_no_show_claim_use_attendance',
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
