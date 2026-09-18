/**
 * Wipe all bookings for student.testflow, then seed one booking per resolved
 * dispute outcome so My Bookings / Booking Detail / Issue Detail can be compared.
 *
 * Product rule (MVP):
 *   After resolve → list/detail badge = underlying booking status (not "Issue reported").
 *   Booking Detail also shows Issue resolved panel. Issue page shows Resolved.
 *   No "Issue resolved" badge on the list.
 *
 * Prerequisites:
 *   npm run seed:test-flows
 *
 * Run (from backend/):
 *   npm run seed:resolved-issues-qa
 *
 * Login: student.testflow@picklecoach.example.org / Test1234!Ab
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
  BookingPlayer,
  Payment,
  PaymentAction,
  Dispute,
  DisputeType,
  DisputeResolutionAction,
  Notification,
  Conversation,
  ConversationRead,
  Message,
  Review,
  StudentFeedback,
  CancellationHistory,
} from '../models/index.js';
import { ACTIVE_DISPUTE_TYPE_CODES } from '../utils/disputeTypeCatalog.js';
import {
  buildResolvedIssuesQaSpecs,
  buildSettlementQaPaymentAttrs,
} from '../utils/settlementQaFixtures.js';
import { registerDevSeedPaymentIntent } from '../services/stripeService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const STUDENT_EMAIL = 'student.testflow@picklecoach.example.org';
const COACH_EMAIL = 'coach.testflow@picklecoach.example.org';
const ADMIN_EMAIL = 'admin.testflow@picklecoach.example.org';
const IDEM_PREFIX = 'qa_resolved_issue_';
const LESSON_TITLE_PREFIX = 'QA Resolved · ';
const dayMs = 24 * 60 * 60 * 1000;
const minMs = 60 * 1000;

async function findUserByEmail(email, role) {
  return User.findOne({
    where: { email, is_active: true, deleted_at: null },
    include: [{ model: UserRole, as: 'userRoles', where: { role }, required: true }],
  });
}

async function resolveActionId(financialAction) {
  const code =
    financialAction === 'refund_student'
      ? 'approved_refund'
      : financialAction === 'refund_student_partial'
        ? 'partial_refund'
        : 'no_action';
  const row = await DisputeResolutionAction.findOne({ where: { code } });
  if (!row) throw new Error(`Missing dispute_resolution_actions row for code=${code}`);
  return row.id;
}

/** Customer-safe admin notes for QA fixtures (never dump raw financial_action codes). */
function humanResolutionNotes(spec) {
  const decision = spec.decision === 'rejected' ? 'Claim not upheld' : 'Claim upheld';
  if (spec.financial === 'refund_student_partial') {
    const dollars = spec.refund_cents != null ? (spec.refund_cents / 100).toFixed(2) : null;
    return dollars
      ? `${decision}. Partial student refund of $${dollars}.`
      : `${decision}. Partial student refund.`;
  }
  if (spec.financial === 'refund_student') {
    return `${decision}. Full student refund.`;
  }
  return `${decision}. No refund.`;
}

async function destroyBookingsForStudent(studentId, transaction) {
  const prior = await Booking.findAll({
    where: { primary_student_id: studentId },
    attributes: ['id'],
    transaction,
  });
  const priorIds = prior.map((b) => b.id);
  if (!priorIds.length) return 0;

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
  await StudentFeedback.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await CancellationHistory.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await PaymentAction.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Notification.destroy({
    where: {
      [Op.or]: [
        { entity_type: 'booking', entity_id: { [Op.in]: priorIds } },
        { entity_type: 'dispute' },
      ],
    },
    transaction,
  });
  await sequelize.query('UPDATE payments SET dispute_id = NULL WHERE booking_id IN (:ids)', {
    replacements: { ids: priorIds },
    transaction,
  });
  await Dispute.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Payment.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await BookingPlayer.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Booking.destroy({ where: { id: { [Op.in]: priorIds } }, transaction, force: true });
  return priorIds.length;
}

async function ensureQaLesson(coachId, title, baseLesson, transaction) {
  const existing = await Lesson.findOne({
    where: { coach_id: coachId, title, deleted_at: null },
    transaction,
  });
  if (existing) return existing;
  return Lesson.create(
    {
      coach_id: coachId,
      title,
      description: 'Seeded for resolved-issue presentation QA. Safe to ignore on public profile.',
      duration_minutes: baseLesson.duration_minutes || 60,
      price: baseLesson.price,
      max_students: 1,
      skill_level: baseLesson.skill_level || 'beginner',
      is_active: true,
    },
    { transaction },
  );
}

function buildPaymentAttrs(booking, money, refundCents = null) {
  const attrs = buildSettlementQaPaymentAttrs(booking, money, {
    paymentIntentId: `pi_seed_dev_${IDEM_PREFIX}${booking.id}`,
    chargeId: `ch_seed_dev_${booking.id}`,
    stripeRefundId: `re_seed_dev_${booking.id}`,
    refundCents,
  });
  if (attrs.payment_intent_id) {
    const totalCharge = Number(attrs.total_charge_to_student) || 0;
    registerDevSeedPaymentIntent(attrs.payment_intent_id, {
      amountCapturableCents: Math.round(totalCharge * 100),
    });
  }
  return attrs;
}

/**
 * Each row: one resolved in-app dispute + the booking status that should show after resolve.
 * Dispute row status is always `resolved` (even when decision is rejected) — matches admin resolve.
 */
function buildSpecs() {
  return buildResolvedIssuesQaSpecs();
}

async function main() {
  const student = await findUserByEmail(STUDENT_EMAIL, 'student');
  const coach = await findUserByEmail(COACH_EMAIL, 'coach');
  const admin = await findUserByEmail(ADMIN_EMAIL, 'admin');
  if (!student || !coach || !admin) {
    console.error('Testflow users missing. Run: npm run seed:test-flows');
    process.exit(1);
  }

  const baseLesson = await Lesson.findOne({
    where: { coach_id: coach.id, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
  });
  if (!baseLesson) {
    console.error('No active lesson for testflow coach. Run: npm run seed:test-flows');
    process.exit(1);
  }

  const coachCourt = await CoachCourtLocation.findOne({
    where: { coach_id: coach.id },
    order: [['id', 'ASC']],
  });
  if (!coachCourt) {
    console.error('No court for testflow coach. Run: npm run seed:test-flows');
    process.exit(1);
  }

  const types = Object.fromEntries(
    (
      await DisputeType.findAll({
        where: { code: { [Op.in]: ACTIVE_DISPUTE_TYPE_CODES } },
        attributes: ['id', 'code'],
      })
    ).map((t) => [t.code, t]),
  );
  for (const code of ACTIVE_DISPUTE_TYPE_CODES) {
    if (!types[code]) throw new Error(`Missing dispute type ${code}`);
  }

  const specs = buildSpecs();
  const created = await sequelize.transaction(async (t) => {
    const wiped = await destroyBookingsForStudent(student.id, t);

    // Also clear prior QA lessons with our title prefix (orphan cleanup).
    await Lesson.destroy({
      where: {
        coach_id: coach.id,
        title: { [Op.like]: `${LESSON_TITLE_PREFIX}%` },
      },
      transaction: t,
    });

    const rows = [];
    const now = Date.now();

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const lesson = await ensureQaLesson(
        coach.id,
        `${LESSON_TITLE_PREFIX}${spec.title}`,
        baseLesson,
        t,
      );
      const end = new Date(now - (2 + i) * dayMs);
      const scheduledAt = new Date(end.getTime() - (lesson.duration_minutes || 60) * minMs);

      const booking = await Booking.create(
        {
          lesson_id: lesson.id,
          coach_id: coach.id,
          primary_student_id: student.id,
          scheduled_at: scheduledAt,
          duration_minutes: lesson.duration_minutes,
          price: lesson.price,
          court_location_id: coachCourt.court_location_id,
          status: spec.bookingStatus,
          payout_status: 'none',
          attendance_finalized: true,
          messaging_locked: true,
          cancelled_by: spec.cancelled_by ?? null,
          idempotency_key: `${IDEM_PREFIX}${spec.key}`,
        },
        { transaction: t },
      );

      const payment = await Payment.create(
        buildPaymentAttrs(booking, spec.money, spec.refund_cents ?? null),
        { transaction: t },
      );

      const actionId = await resolveActionId(spec.financial);
      const openedAt = new Date(scheduledAt.getTime() + (lesson.duration_minutes || 60) * minMs + hourOffset(i));
      const dispute = await Dispute.create(
        {
          booking_id: booking.id,
          dispute_type_id: types[spec.type].id,
          notes: `QA resolved fixture: ${spec.key}`,
          opened_by: spec.opened_by,
          status: 'resolved',
          decision: spec.decision,
          outcome: spec.outcome,
          penalize_role: spec.penalize_role,
          resolution_action_id: actionId,
          resolution_notes: humanResolutionNotes(spec),
          refund_cents:
            spec.financial === 'refund_student_partial'
              ? (spec.refund_cents ?? null)
              : null,
          admin_id: admin.id,
          opened_at: openedAt,
          resolved_at: new Date(openedAt.getTime() + 6 * 60 * 60 * 1000),
        },
        { transaction: t },
      );

      // Link payment ↔ dispute so GET /disputes/:id settlement matches booking detail.
      await payment.update({ dispute_id: dispute.id }, { transaction: t });

      rows.push({
        key: spec.key,
        booking_id: booking.id,
        dispute_id: dispute.id,
        list_status: spec.expectList,
        type: spec.type,
        decision: spec.decision,
        outcome: spec.outcome,
        financial: spec.financial,
        money: spec.money,
        paths: {
          booking: `/bookings/${booking.id}`,
          issue: `/issues/${dispute.id}`,
        },
      });
    }

    return { wiped, rows };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        wiped_student_bookings: created.wiped,
        student: STUDENT_EMAIL,
        password: 'Test1234!Ab',
        count: created.rows.length,
        note: [
          'List badge = underlying booking status (never Issue reported / Issue resolved).',
          'Open each booking for Issue resolved panel; /issues/:id shows Resolved.',
        ],
        fixtures: created.rows,
      },
      null,
      2,
    ),
  );

  await sequelize.close();
}

function hourOffset(i) {
  return (2 + (i % 5)) * 60 * 60 * 1000;
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
