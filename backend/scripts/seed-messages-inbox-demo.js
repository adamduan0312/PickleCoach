/**
 * Messages inbox demo for adamduan0312@gmail.com (dual-role).
 *
 * Seeds bookings + conversations so /messages shows the intended bands:
 *   Unread → active (has messages) → empty booking threads
 *
 * Both sides of dual-role:
 *   - As student: threads with marketplace coaches
 *   - As coach: threads with students
 *
 * Idempotent on prefix `qa_msg_inbox_demo_`.
 *
 * Run (from backend/):
 *   NODE_ENV=development npm run seed:messages-inbox-demo
 *
 * Optional:
 *   TARGET_EMAIL=adamduan0312@gmail.com
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
  Conversation,
  ConversationRead,
  Message,
  Review,
  Dispute,
  PaymentAction,
  CancellationHistory,
  Notification,
} from '../models/index.js';
import { calculatePaymentAmounts } from '../services/paymentEngine.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const IDEM_PREFIX = 'qa_msg_inbox_demo_';
const TARGET_EMAIL = process.env.TARGET_EMAIL || 'adamduan0312@gmail.com';

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const minMs = 60 * 1000;

async function findUser(email) {
  return User.findOne({
    where: { email },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
}

async function wipePrior(targetUserId, transaction) {
  const prior = await Booking.findAll({
    where: {
      idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` },
      [Op.or]: [{ coach_id: targetUserId }, { primary_student_id: targetUserId }],
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

async function ensureLesson(coachId, title, transaction) {
  let lesson = await Lesson.findOne({
    where: { coach_id: coachId, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
    transaction,
  });
  if (lesson) return lesson;

  return Lesson.create(
    {
      coach_id: coachId,
      title,
      description: 'Seeded for Messages inbox demo.',
      duration_minutes: 60,
      price: 55,
      max_students: 1,
      is_active: true,
    },
    { transaction },
  );
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
      metadata: { seed: 'messages_inbox_demo' },
    },
    { transaction },
  );
}

/**
 * @param {object} opts
 * @param {string} opts.key
 * @param {import('../models/User.js').default} opts.student
 * @param {import('../models/User.js').default} opts.coach
 * @param {import('../models/Lesson.js').default} opts.lesson
 * @param {number} opts.courtId
 * @param {Date} opts.scheduledAt
 * @param {Date} opts.conversationCreatedAt
 * @param {Array<{ senderId: number, text: string, at: Date }>} [opts.messages]
 * @param {{ userId: number, lastReadAt: Date }[]} [opts.reads]
 * @param {import('sequelize').Transaction} opts.transaction
 */
async function seedThread({
  key,
  student,
  coach,
  lesson,
  courtId,
  scheduledAt,
  conversationCreatedAt,
  messages = [],
  reads = [],
  transaction,
}) {
  const booking = await Booking.create(
    {
      lesson_id: lesson.id,
      coach_id: coach.id,
      primary_student_id: student.id,
      scheduled_at: scheduledAt,
      duration_minutes: lesson.duration_minutes,
      price: lesson.price,
      court_location_id: courtId,
      status: 'confirmed',
      payout_status: 'none',
      messaging_locked: false,
      idempotency_key: key,
    },
    { transaction },
  );
  await createCapturedPayment(booking, transaction);

  const conversation = await Conversation.create(
    {
      booking_id: booking.id,
      created_at: conversationCreatedAt,
      updated_at: conversationCreatedAt,
    },
    { transaction },
  );

  let createdMessages = [];
  if (messages.length) {
    createdMessages = await Message.bulkCreate(
      messages.map((m) => ({
        conversation_id: conversation.id,
        sender_id: m.senderId,
        message_text: m.text,
        created_at: m.at,
        updated_at: m.at,
      })),
      { transaction },
    );
    const latestAt = messages[messages.length - 1].at;
    await conversation.update({ updated_at: latestAt }, { transaction });
  }

  for (const read of reads) {
    await ConversationRead.create(
      {
        conversation_id: conversation.id,
        user_id: read.userId,
        last_read_at: read.lastReadAt,
      },
      { transaction },
    );
  }

  return {
    key,
    booking_id: booking.id,
    conversation_id: conversation.id,
    message_count: createdMessages.length,
  };
}

function threadScripts({ viewerId, otherId, kind, latestOffsetMin, unreadForViewer }) {
  const now = Date.now();
  const t = (minsAgo) => new Date(now - minsAgo * minMs);

  if (kind === 'empty') {
    return { messages: [], reads: [] };
  }

  if (kind === 'unread') {
    // Short history; other party sent the last few — viewer left mid-thread.
    const messages = [
      { senderId: viewerId, text: 'Hey — confirming we’re still on for the lesson?', at: t(latestOffsetMin + 40) },
      { senderId: otherId, text: 'Yes, looking forward to it.', at: t(latestOffsetMin + 30) },
      { senderId: viewerId, text: 'Great. Anything I should bring?', at: t(latestOffsetMin + 20) },
      { senderId: otherId, text: 'Unread: please check this before we start.', at: t(latestOffsetMin + 8) },
      { senderId: otherId, text: 'Unread: second ping for the badge count.', at: t(latestOffsetMin + 3) },
      { senderId: otherId, text: `Unread: latest note (${latestOffsetMin}m ago).`, at: t(latestOffsetMin) },
    ];
    const reads = unreadForViewer
      ? [
          // Viewer read only through their last send — three other-party messages stay unread.
          { userId: viewerId, lastReadAt: messages[2].at },
          { userId: otherId, lastReadAt: messages[messages.length - 1].at },
        ]
      : [
          { userId: viewerId, lastReadAt: messages[messages.length - 1].at },
          { userId: otherId, lastReadAt: messages[messages.length - 1].at },
        ];
    return { messages, reads };
  }

  // Active (fully read by viewer)
  const messages = [
    { senderId: viewerId, text: 'Quick check-in about parking.', at: t(latestOffsetMin + 50) },
    { senderId: otherId, text: 'East lot is usually open.', at: t(latestOffsetMin + 40) },
    { senderId: viewerId, text: 'Perfect — see you then.', at: t(latestOffsetMin + 25) },
    { senderId: otherId, text: `All set. Catch you soon (active · ${latestOffsetMin}m).`, at: t(latestOffsetMin) },
  ];
  return {
    messages,
    reads: [
      { userId: viewerId, lastReadAt: messages[messages.length - 1].at },
      { userId: otherId, lastReadAt: messages[messages.length - 1].at },
    ],
  };
}

async function main() {
  await sequelize.authenticate();

  const target = await findUser(TARGET_EMAIL);
  if (!target) throw new Error(`User not found: ${TARGET_EMAIL}`);
  const roles = (target.userRoles || []).map((r) => r.role);
  if (!roles.includes('student') || !roles.includes('coach')) {
    throw new Error(`${TARGET_EMAIL} needs both student and coach roles for this demo`);
  }

  const coachPartners = await Promise.all(
    [1, 2, 3, 4].map((n) => findUser(`coach${n}@example.com`)),
  );
  const studentPartners = await Promise.all(
    [1, 2, 3, 4].map((n) => findUser(`student${n}@example.com`)),
  );
  if (coachPartners.some((u) => !u) || studentPartners.some((u) => !u)) {
    throw new Error('Missing coach1–4 or student1–4@example.com partners');
  }

  const now = Date.now();
  const fixtures = [];
  let wiped = 0;

  await sequelize.transaction(async (transaction) => {
    wiped = await wipePrior(target.id, transaction);

    const adamLesson = await ensureLesson(target.id, 'Messages inbox demo lesson', transaction);
    const adamCourtId = await ensureCourt(target.id, transaction);

    const coachMeta = [];
    for (const c of coachPartners) {
      const lesson = await ensureLesson(c.id, `${c.full_name} lesson`, transaction);
      const courtId = await ensureCourt(c.id, transaction);
      coachMeta.push({ user: c, lesson, courtId });
    }

    /** @type {Array<{ key: string, side: 'as_student'|'as_coach', partner: object, lesson: object, courtId: number, scheduledOffsetDays: number, conversationAgeMin: number, kind: string, latestOffsetMin?: number }>} */
    const plan = [
      // Unread first (newest unread on top when sorted)
      {
        key: `${IDEM_PREFIX}coa_unread_recent`,
        side: 'as_coach',
        partner: studentPartners[0],
        lesson: adamLesson,
        courtId: adamCourtId,
        scheduledOffsetDays: 2,
        conversationAgeMin: 200,
        kind: 'unread',
        latestOffsetMin: 2,
      },
      {
        key: `${IDEM_PREFIX}stu_unread_recent`,
        side: 'as_student',
        partner: coachMeta[0].user,
        lesson: coachMeta[0].lesson,
        courtId: coachMeta[0].courtId,
        scheduledOffsetDays: 3,
        conversationAgeMin: 210,
        kind: 'unread',
        latestOffsetMin: 5,
      },
      {
        key: `${IDEM_PREFIX}coa_unread_older`,
        side: 'as_coach',
        partner: studentPartners[1],
        lesson: adamLesson,
        courtId: adamCourtId,
        scheduledOffsetDays: 4,
        conversationAgeMin: 220,
        kind: 'unread',
        latestOffsetMin: 12,
      },
      {
        key: `${IDEM_PREFIX}stu_unread_older`,
        side: 'as_student',
        partner: coachMeta[1].user,
        lesson: coachMeta[1].lesson,
        courtId: coachMeta[1].courtId,
        scheduledOffsetDays: 5,
        conversationAgeMin: 230,
        kind: 'unread',
        latestOffsetMin: 18,
      },
      // Active (read) — below unread
      {
        key: `${IDEM_PREFIX}coa_active_recent`,
        side: 'as_coach',
        partner: studentPartners[2],
        lesson: adamLesson,
        courtId: adamCourtId,
        scheduledOffsetDays: 6,
        conversationAgeMin: 300,
        kind: 'active',
        latestOffsetMin: 35,
      },
      {
        key: `${IDEM_PREFIX}stu_active_recent`,
        side: 'as_student',
        partner: coachMeta[2].user,
        lesson: coachMeta[2].lesson,
        courtId: coachMeta[2].courtId,
        scheduledOffsetDays: 7,
        conversationAgeMin: 310,
        kind: 'active',
        latestOffsetMin: 55,
      },
      {
        key: `${IDEM_PREFIX}coa_active_older`,
        side: 'as_coach',
        partner: studentPartners[3],
        lesson: adamLesson,
        courtId: adamCourtId,
        scheduledOffsetDays: 8,
        conversationAgeMin: 400,
        kind: 'active',
        latestOffsetMin: 120,
      },
      {
        key: `${IDEM_PREFIX}stu_active_older`,
        side: 'as_student',
        partner: coachMeta[3].user,
        lesson: coachMeta[3].lesson,
        courtId: coachMeta[3].courtId,
        scheduledOffsetDays: 9,
        conversationAgeMin: 410,
        kind: 'active',
        latestOffsetMin: 180,
      },
      // Empty booking threads — bottom of inbox (newest empty created last in plan = higher)
      {
        key: `${IDEM_PREFIX}coa_empty_newer`,
        side: 'as_coach',
        partner: studentPartners[0],
        lesson: adamLesson,
        courtId: adamCourtId,
        scheduledOffsetDays: 10,
        conversationAgeMin: 40,
        kind: 'empty',
      },
      {
        key: `${IDEM_PREFIX}stu_empty_newer`,
        side: 'as_student',
        partner: coachMeta[0].user,
        lesson: coachMeta[0].lesson,
        courtId: coachMeta[0].courtId,
        scheduledOffsetDays: 11,
        conversationAgeMin: 50,
        kind: 'empty',
      },
      {
        key: `${IDEM_PREFIX}coa_empty_older`,
        side: 'as_coach',
        partner: studentPartners[1],
        lesson: adamLesson,
        courtId: adamCourtId,
        scheduledOffsetDays: 12,
        conversationAgeMin: 90,
        kind: 'empty',
      },
      {
        key: `${IDEM_PREFIX}stu_empty_older`,
        side: 'as_student',
        partner: coachMeta[1].user,
        lesson: coachMeta[1].lesson,
        courtId: coachMeta[1].courtId,
        scheduledOffsetDays: 13,
        conversationAgeMin: 100,
        kind: 'empty',
      },
    ];

    // Second empty pair needs distinct partners — reuse coach3/student3 for empties that
    // would collide on unique booking constraints? Bookings don't unique on parties.
    // But empty_newer reused studentPartners[0] with a different scheduled time — fine.
    // For empty with same student twice as coach: OK (different bookings).

    for (const item of plan) {
      const student = item.side === 'as_student' ? target : item.partner;
      const coach = item.side === 'as_coach' ? target : item.partner;
      const otherId = item.partner.id;
      const { messages, reads } = threadScripts({
        viewerId: target.id,
        otherId,
        kind: item.kind,
        latestOffsetMin: item.latestOffsetMin || 0,
        unreadForViewer: item.kind === 'unread',
      });

      const row = await seedThread({
        key: item.key,
        student,
        coach,
        lesson: item.lesson,
        courtId: item.courtId,
        scheduledAt: new Date(now + item.scheduledOffsetDays * dayMs + 10 * hourMs),
        conversationCreatedAt: new Date(now - item.conversationAgeMin * minMs),
        messages,
        reads,
        transaction,
      });

      fixtures.push({
        ...row,
        side: item.side,
        band: item.kind,
        counterpart: item.partner.full_name,
        path: `/messages/${row.conversation_id}`,
      });
    }
  });

  const expectedOrder = [
    'Alice Cooper (unread · coach side)',
    'John Smith (unread · student side)',
    'Bob Miller (unread · coach side)',
    'Sarah Johnson (unread · student side)',
    'Carol White (active · coach side)',
    'Mike Davis (active · student side)',
    'Dan Green (active · coach side)',
    'Emily Wilson (active · student side)',
    '…then empty threads (No messages yet) at the bottom',
  ];

  console.log(
    JSON.stringify(
      {
        ok: true,
        wiped_prior: wiped,
        target: { id: target.id, email: target.email, full_name: target.full_name, roles },
        fixture_count: fixtures.length,
        fixtures,
        expected_inbox_top: expectedOrder,
        how_to_test: [
          `Log in as ${TARGET_EMAIL}`,
          'Open /messages — unread first, then active, empty booking threads last',
          'Student mode: counterparts who are coaches (John, Sarah, Mike, Emily)',
          'Coach mode: counterparts who are students (Alice, Bob, Carol, Dan)',
          'Inbox is shared across modes; mode only changes chrome — open a few threads in each mode',
        ],
      },
      null,
      2,
    ),
  );

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('seed-messages-inbox-demo failed:', err.message);
  console.error(err);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
