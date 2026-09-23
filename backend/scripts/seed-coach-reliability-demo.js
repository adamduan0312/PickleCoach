/**
 * Seed coach reliability demo for adamduan0312@gmail.com (coach mode Settings).
 *
 * Creates 8 recent coach bookings: 6 completed, 1 late cancel, 1 coach no-show.
 * Settings → Reliability (coach mode) should show:
 *   Recent booking activity: 8
 *   Late cancellations: 1
 *   No-shows: 1
 *
 * Idempotent on prefix `qa_coach_rel_demo_`.
 *
 * Run (from backend/):
 *   NODE_ENV=development npm run seed:coach-reliability-demo
 *
 * Optional:
 *   COACH_EMAIL=adamduan0312@gmail.com
 *   STUDENT_EMAIL=student.testflow@picklecoach.example.org
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  User,
  UserRole,
  Lesson,
  CoachCourtLocation,
  CourtLocation,
  Booking,
  Payment,
  CancellationHistory,
  Conversation,
  ConversationRead,
  Message,
  Review,
  Dispute,
  PaymentAction,
  Notification,
} from '../models/index.js';
import { calculatePaymentAmounts } from '../services/paymentEngine.js';
import { updateUserReliability } from '../services/reliabilityService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const IDEM_PREFIX = 'qa_coach_rel_demo_';
const COACH_EMAIL = process.env.COACH_EMAIL || 'adamduan0312@gmail.com';
const STUDENT_EMAIL = process.env.STUDENT_EMAIL || 'student.testflow@picklecoach.example.org';

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;

async function findUser(email) {
  return User.findOne({
    where: { email },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
}

async function ensureCompositeReliabilityPrimaryKey() {
  const [pkRows] = await sequelize.query(
    "SHOW INDEX FROM user_reliability WHERE Key_name = 'PRIMARY'",
  );
  const primaryCols = pkRows.map((row) => row.Column_name);
  const hasComposite =
    primaryCols.length === 2
    && primaryCols.includes('user_id')
    && primaryCols.includes('role');
  if (hasComposite) return false;

  // Local DBs may still have PRIMARY (user_id) only — dual-role users then cannot
  // store separate coach + student rows. Fix for development seed only.
  await sequelize.query('ALTER TABLE user_reliability DROP FOREIGN KEY user_reliability_ibfk_1');
  await sequelize.query('ALTER TABLE user_reliability DROP PRIMARY KEY');
  await sequelize.query('ALTER TABLE user_reliability ADD PRIMARY KEY (user_id, role)');
  await sequelize.query(
    `ALTER TABLE user_reliability
     ADD CONSTRAINT user_reliability_ibfk_1
     FOREIGN KEY (user_id) REFERENCES users(id)
     ON DELETE CASCADE ON UPDATE CASCADE`,
  );
  return true;
}

async function wipePrior(coachId, transaction) {
  const prior = await Booking.findAll({
    where: {
      coach_id: coachId,
      idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` },
    },
    attributes: ['id'],
    transaction,
  });
  const ids = prior.map((b) => b.id);
  if (!ids.length) return 0;

  const conversations = await Conversation.findAll({
    where: { booking_id: { [Op.in]: ids } },
    attributes: ['id'],
    transaction,
  });
  const conversationIds = conversations.map((c) => c.id);
  if (conversationIds.length) {
    await ConversationRead.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, transaction });
    await Message.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, transaction });
    await Conversation.destroy({ where: { id: { [Op.in]: conversationIds } }, transaction });
  }
  await Review.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await Notification.destroy({
    where: { entity_type: 'booking', entity_id: { [Op.in]: ids } },
    transaction,
  });
  await sequelize.query('UPDATE payments SET dispute_id = NULL WHERE booking_id IN (:ids)', {
    replacements: { ids },
    transaction,
  });
  await Dispute.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await CancellationHistory.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await PaymentAction.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await Payment.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await Booking.destroy({ where: { id: { [Op.in]: ids } }, transaction });
  return ids.length;
}

async function ensureLesson(coachId, transaction) {
  let lesson = await Lesson.findOne({
    where: { coach_id: coachId, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
    transaction,
  });
  if (lesson) return lesson;

  lesson = await Lesson.create(
    {
      coach_id: coachId,
      title: 'Coach reliability demo lesson',
      description: 'Seeded for Settings → Reliability demo (coach mode).',
      duration_minutes: 60,
      price: 60,
      max_students: 1,
      is_active: true,
    },
    { transaction },
  );
  return lesson;
}

async function ensureCourt(coachId, transaction) {
  const link = await CoachCourtLocation.findOne({
    where: { coach_id: coachId },
    include: [{ model: CourtLocation, as: 'court', where: { deleted_at: null }, required: true }],
    transaction,
  });
  if (link?.court_id) return link.court_id;

  const court = await CourtLocation.findOne({
    where: { deleted_at: null },
    order: [['id', 'ASC']],
    transaction,
  });
  if (!court) throw new Error('No court locations available to link');

  await CoachCourtLocation.findOrCreate({
    where: { coach_id: coachId, court_id: court.id },
    defaults: { coach_id: coachId, court_id: court.id },
    transaction,
  });
  return court.id;
}

async function createCapturedPayment(booking, transaction) {
  const amounts = calculatePaymentAmounts(booking.price);
  return Payment.create(
    {
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
      currency: 'USD',
      payment_intent_id: null,
      charge_id: null,
    },
    { transaction },
  );
}

async function main() {
  await sequelize.authenticate();

  const pkFixed = await ensureCompositeReliabilityPrimaryKey();
  if (pkFixed) {
    console.log('Updated user_reliability primary key to (user_id, role) for dual-role scores.');
  }

  const coach = await findUser(COACH_EMAIL);
  if (!coach) {
    throw new Error(`Coach not found: ${COACH_EMAIL}`);
  }
  const roles = (coach.userRoles || []).map((r) => r.role);
  if (!roles.includes('coach')) {
    throw new Error(`${COACH_EMAIL} is missing the coach role`);
  }

  const student = await findUser(STUDENT_EMAIL);
  if (!student) {
    throw new Error(`Student partner not found: ${STUDENT_EMAIL}. Run npm run seed:test-flows`);
  }

  const now = Date.now();
  let wiped = 0;
  const createdIds = [];

  await sequelize.transaction(async (transaction) => {
    wiped = await wipePrior(coach.id, transaction);
    const lesson = await ensureLesson(coach.id, transaction);
    const courtId = await ensureCourt(coach.id, transaction);

    // 6 completed + 1 late cancel + 1 coach no-show = 8 recent booking activity
    for (let i = 1; i <= 6; i += 1) {
      const scheduledAt = new Date(now - i * 3 * dayMs - 2 * hourMs);
      const booking = await Booking.create(
        {
          lesson_id: lesson.id,
          coach_id: coach.id,
          primary_student_id: student.id,
          scheduled_at: scheduledAt,
          duration_minutes: lesson.duration_minutes,
          price: lesson.price,
          court_location_id: courtId,
          status: 'completed',
          payout_status: 'none',
          messaging_locked: false,
          idempotency_key: `${IDEM_PREFIX}completed_${i}`,
        },
        { transaction },
      );
      await createCapturedPayment(booking, transaction);
      createdIds.push(booking.id);
    }

    // 1 late coach cancel (<24h before lesson) — still counts in booking baseline
    const lateScheduled = new Date(now - 5 * dayMs);
    const lateCancelledAt = new Date(lateScheduled.getTime() - 6 * hourMs);
    const lateBooking = await Booking.create(
      {
        lesson_id: lesson.id,
        coach_id: coach.id,
        primary_student_id: student.id,
        scheduled_at: lateScheduled,
        duration_minutes: lesson.duration_minutes,
        price: lesson.price,
        court_location_id: courtId,
        status: 'cancelled',
        cancelled_by: 'coach',
        cancelled_at: lateCancelledAt,
        payout_status: 'none',
        messaging_locked: true,
        idempotency_key: `${IDEM_PREFIX}late_cancel`,
      },
      { transaction },
    );
    await createCapturedPayment(lateBooking, transaction);
    await CancellationHistory.create(
      {
        booking_id: lateBooking.id,
        cancelled_by: 'coach',
        refund_amount: lateBooking.price,
        penalty_amount: 0,
        reason: 'schedule_conflict',
        reason_notes: 'Coach reliability demo late cancel',
        affects_reliability: true,
        cancelled_at: lateCancelledAt,
      },
      { transaction },
    );
    createdIds.push(lateBooking.id);

    // 1 coach no-show (counts toward no_shows_recent for coach role)
    const noShowScheduled = new Date(now - 8 * dayMs - 3 * hourMs);
    const noShowBooking = await Booking.create(
      {
        lesson_id: lesson.id,
        coach_id: coach.id,
        primary_student_id: student.id,
        scheduled_at: noShowScheduled,
        duration_minutes: lesson.duration_minutes,
        price: lesson.price,
        court_location_id: courtId,
        status: 'coach_no_show',
        payout_status: 'none',
        messaging_locked: true,
        idempotency_key: `${IDEM_PREFIX}coach_no_show`,
      },
      { transaction },
    );
    await createCapturedPayment(noShowBooking, transaction);
    createdIds.push(noShowBooking.id);
  });

  await updateUserReliability(coach.id, 'coach');

  const { UserReliability } = await import('../models/index.js');
  const row = await UserReliability.findOne({
    where: { user_id: coach.id, role: 'coach' },
  });

  console.log('\n=== Coach reliability demo ready ===\n');
  console.log(`Coach: ${COACH_EMAIL} (id=${coach.id})`);
  console.log('Switch to Coach mode → Settings → Reliability');
  console.log(`Wiped prior demo bookings: ${wiped}`);
  console.log(`Created bookings: ${createdIds.length} → #${createdIds.join(', #')}`);
  console.log('\nExpected Settings activity:');
  console.log('  Recent booking activity: 8');
  console.log('  Late cancellations: 1');
  console.log('  No-shows: 1');
  if (row) {
    console.log('\nPersisted coach reliability row:');
    console.log(`  reliability_score: ${row.reliability_score}`);
    console.log(`  total_bookings_recent: ${row.total_bookings_recent}`);
    console.log(`  late_cancels_recent: ${row.late_cancels_recent}`);
    console.log(`  no_shows_recent: ${row.no_shows_recent}`);
  }
  console.log('');
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('seed-coach-reliability-demo failed:', err.message);
    console.error(err.stack);
    try { await sequelize.close(); } catch { /* ignore */ }
    process.exit(1);
  });
