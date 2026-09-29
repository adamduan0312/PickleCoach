/**
 * Report-an-issue deadline QA: one completed lesson whose 24h issue window is open,
 * so the booking detail shows "Report an issue … until <date> · <time> <Zone>".
 *
 * Student: adamduan0312@gmail.com  (sees the deadline in their timezone)
 * Coach:   adamduan0312+coach@gmail.com (sees the same deadline in theirs)
 *
 * The lesson ends today at 08:00 in the student's timezone when that is already in
 * the past (deadline = tomorrow 08:00 student time); otherwise it ends at the top of
 * the current hour. Idempotent on prefix `qa_tz_report_issue_`.
 *
 * Run (from backend/):
 *   NODE_ENV=development npm run seed:report-issue-deadline-qa
 *
 * Optional: STUDENT_EMAIL, COACH_EMAIL
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  User,
  Lesson,
  CoachCourtLocation,
  CourtLocation,
  Booking,
  Payment,
  PaymentAction,
  CancellationHistory,
  Conversation,
  ConversationRead,
  Message,
  Review,
  Dispute,
  Notification,
} from '../models/index.js';
import { calculatePaymentAmounts } from '../services/paymentEngine.js';
import { getFinancialReviewUntil, getLessonEndAt } from '../utils/financialReviewWindow.js';
import { timezoneDisplayName } from '../utils/lessonReminderCopy.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const IDEM_PREFIX = 'qa_tz_report_issue_';
const STUDENT_EMAIL = process.env.STUDENT_EMAIL || 'adamduan0312@gmail.com';
const COACH_EMAIL = process.env.COACH_EMAIL || 'adamduan0312+coach@gmail.com';
const DURATION_MINUTES = 60;
const hourMs = 60 * 60 * 1000;

function ymdInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

function wallTimeToUtc(ymd, hour, timeZone) {
  const guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(guess).map((p) => [p.type, p.value]),
  );
  const asZoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asZoned - guess.getTime()));
}

function fmt(date, timeZone) {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
  return `${when} ${timezoneDisplayName(timeZone)}`;
}

function pickLessonEnd(studentTz, now = new Date()) {
  const eightAm = wallTimeToUtc(ymdInZone(now, studentTz), 8, studentTz);
  if (eightAm.getTime() <= now.getTime()) return eightAm;
  return new Date(Math.floor(now.getTime() / hourMs) * hourMs);
}

async function wipePrior(transaction) {
  const prior = await Booking.findAll({
    where: { idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` } },
    attributes: ['id'],
    transaction,
  });
  const ids = prior.map((b) => b.id);
  if (!ids.length) return 0;
  const convs = await Conversation.findAll({ where: { booking_id: { [Op.in]: ids } }, attributes: ['id'], transaction });
  const convIds = convs.map((c) => c.id);
  if (convIds.length) {
    await ConversationRead.destroy({ where: { conversation_id: { [Op.in]: convIds } }, transaction });
    await Message.destroy({ where: { conversation_id: { [Op.in]: convIds } }, transaction });
    await Conversation.destroy({ where: { id: { [Op.in]: convIds } }, transaction });
  }
  await Review.destroy({ where: { booking_id: { [Op.in]: ids } }, transaction });
  await Notification.destroy({ where: { entity_type: 'booking', entity_id: { [Op.in]: ids } }, transaction });
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

async function main() {
  await sequelize.authenticate();
  sequelize.options.logging = false;

  const student = await User.findOne({ where: { email: STUDENT_EMAIL } });
  const coach = await User.findOne({ where: { email: COACH_EMAIL } });
  if (!student) throw new Error(`Student not found: ${STUDENT_EMAIL}`);
  if (!coach) throw new Error(`Coach not found: ${COACH_EMAIL}`);

  const studentTz = student.timezone || 'UTC';
  const coachTz = coach.timezone || 'UTC';
  const lessonEnd = pickLessonEnd(studentTz);
  const scheduledAt = new Date(lessonEnd.getTime() - DURATION_MINUTES * 60 * 1000);

  let booking;
  let wiped = 0;
  await sequelize.transaction(async (transaction) => {
    wiped = await wipePrior(transaction);

    const lesson = await Lesson.findOne({
      where: { coach_id: coach.id, is_active: true, deleted_at: null },
      order: [['id', 'ASC']],
      transaction,
    });
    if (!lesson) throw new Error(`${COACH_EMAIL} has no active lesson (run npm run seed:timezone-qa)`);

    const courtLink = await CoachCourtLocation.findOne({
      where: { coach_id: coach.id },
      include: [{ model: CourtLocation, as: 'court', where: { deleted_at: null }, required: true }],
      transaction,
    });
    if (!courtLink) throw new Error(`${COACH_EMAIL} has no linked court`);

    booking = await Booking.create(
      {
        lesson_id: lesson.id,
        coach_id: coach.id,
        primary_student_id: student.id,
        scheduled_at: scheduledAt,
        duration_minutes: DURATION_MINUTES,
        price: lesson.price,
        court_location_id: courtLink.court_id,
        status: 'completed',
        payout_status: 'none',
        messaging_locked: false,
        idempotency_key: `${IDEM_PREFIX}completed`,
      },
      { transaction },
    );

    const amounts = calculatePaymentAmounts(booking.price);
    await Payment.create(
      {
        booking_id: booking.id,
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
        currency: 'USD',
        payment_intent_id: null,
        charge_id: null,
      },
      { transaction },
    );
  });

  const reviewUntil = getFinancialReviewUntil(booking);
  const ended = getLessonEndAt(booking);

  console.log('\n=== Report-an-issue deadline QA ready ===\n');
  console.log(`Wiped prior QA bookings: ${wiped}`);
  console.log(`Booking #${booking.id} (completed, payment captured, issue window open)`);
  console.log(`URL: http://localhost:5173/bookings/${booking.id}\n`);
  console.log(`Lesson (UTC):        ${scheduledAt.toISOString()} – ${ended.toISOString()}`);
  console.log(`Report-by (UTC):     ${reviewUntil.toISOString()}\n`);
  console.log(`Student ${STUDENT_EMAIL} (${studentTz}) should see:`);
  console.log(`  When:              ${fmt(scheduledAt, studentTz)}`);
  console.log(`  Report an issue until ${fmt(reviewUntil, studentTz)}`);
  console.log(`Coach ${COACH_EMAIL} (${coachTz}) should see:`);
  console.log(`  When:              ${fmt(scheduledAt, coachTz)}`);
  console.log(`  Issue-reporting period until ${fmt(reviewUntil, coachTz)}\n`);
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('seed-report-issue-deadline-qa failed:', err.message);
    try { await sequelize.close(); } catch { /* ignore */ }
    process.exit(1);
  });
