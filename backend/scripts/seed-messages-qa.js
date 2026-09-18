/**
 * Messages UI QA fixtures for counterpart identity + chat-pane scroll behavior.
 *
 * Creates (or refreshes) three confirmed bookings between the testflow student/coach:
 *   1. long_thread  — many messages so `.chat-list` is scrollable
 *   2. empty_thread — conversation with zero messages (counterpart still resolvable)
 *   3. unread_thread — short thread with unread coach messages for the student
 *
 * Prerequisites (from backend/):
 *   npm run seed:test-flows
 *
 * Run:
 *   npm run seed:messages-qa
 *   npm run seed:messages-qa -- --count=60
 *
 * Login (password Test1234!Ab):
 *   student.testflow@picklecoach.example.org
 *   coach.testflow@picklecoach.example.org
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
  Conversation,
  Message,
  ConversationRead,
} from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const TEST_EMAIL_DOMAIN = 'picklecoach.example.org';
const PASSWORD = 'Test1234!Ab';
const dayMs = 24 * 60 * 60 * 1000;
const minMs = 60 * 1000;

const STABLE_KEYS = {
  long_thread: 'seed_messages_qa_long_thread',
  empty_thread: 'seed_messages_qa_empty_thread',
  unread_thread: 'seed_messages_qa_unread_thread',
};

const getArg = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
};

const parseIntArg = (name, fallback) => {
  const raw = getArg(name);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
};

async function findTestUser(emailLocal) {
  return User.findOne({
    where: { email: `${emailLocal}@${TEST_EMAIL_DOMAIN}` },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
}

async function createNoStripePayment(booking) {
  const existing = await Payment.findOne({ where: { booking_id: booking.id } });
  if (existing) return existing;
  const price = Number(booking.price);
  const platformFee = (price * 8) / 100;
  const coachPayout = (price * 92) / 100;
  return Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: booking.primary_student_id,
    lesson_price: price.toFixed(2),
    platform_fee_percent: 8.0,
    platform_fee_amount: platformFee.toFixed(2),
    total_charge_to_student: price.toFixed(2),
    coach_payout_expected: coachPayout.toFixed(2),
    escrow_status: 'held',
    payment_status: 'captured',
    refund_status: 'none',
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: null,
    charge_id: null,
    metadata: { seed: 'messages_qa' },
  });
}

async function ensureBooking({
  key,
  student,
  coach,
  lesson,
  courtLocationId,
  scheduledAt,
}) {
  let booking = await Booking.findOne({ where: { idempotency_key: key } });
  if (booking) {
    await booking.update({
      lesson_id: lesson.id,
      coach_id: coach.id,
      primary_student_id: student.id,
      scheduled_at: scheduledAt,
      duration_minutes: lesson.duration_minutes,
      price: lesson.price,
      court_location_id: courtLocationId,
      status: 'confirmed',
      payout_status: 'none',
      messaging_locked: false,
    });
  } else {
    booking = await Booking.create({
      lesson_id: lesson.id,
      coach_id: coach.id,
      primary_student_id: student.id,
      scheduled_at: scheduledAt,
      duration_minutes: lesson.duration_minutes,
      price: lesson.price,
      court_location_id: courtLocationId,
      status: 'confirmed',
      payout_status: 'none',
      messaging_locked: false,
      idempotency_key: key,
    });
  }
  await createNoStripePayment(booking);
  return booking;
}

async function ensureConversation(booking) {
  let conversation = await Conversation.findOne({ where: { booking_id: booking.id } });
  if (!conversation) {
    conversation = await Conversation.create({ booking_id: booking.id });
  }
  return conversation;
}

async function replaceMessages(conversationId, rows) {
  await ConversationRead.destroy({ where: { conversation_id: conversationId } });
  await Message.destroy({ where: { conversation_id: conversationId } });
  if (!rows.length) return [];
  return Message.bulkCreate(rows);
}

function buildLongThreadMessages({ conversationId, studentId, coachId, count }) {
  const scripts = [
    { from: 'student', text: 'Hi! Looking forward to Thursday’s lesson.' },
    { from: 'coach', text: 'Same here — we’ll focus on third-shot drops first.' },
    { from: 'student', text: 'Perfect. Should I bring indoor shoes?' },
    { from: 'coach', text: 'Yes, and a spare paddle if you have one.' },
    { from: 'student', text: 'Got it. Any warm-up I should do beforehand?' },
    { from: 'coach', text: 'Light shadow swings and a short jog are enough.' },
    { from: 'student', text: 'Are we still good for the scheduled time?' },
    { from: 'coach', text: 'Yes — court is reserved and I’ll be there early.' },
    { from: 'student', text: 'Quick question about kitchen foot faults.' },
    { from: 'coach', text: 'We’ll drill that in the second half of the session.' },
    { from: 'student', text: 'Also, is parking easier on the east side?' },
    { from: 'coach', text: 'East lot is usually open; enter near the practice courts.' },
    { from: 'student', text: 'Thanks. I’ll arrive about 10 minutes early.' },
    { from: 'coach', text: 'Sounds good — see you then!' },
    { from: 'student', text: 'One more: can we review my backhand dink?' },
    { from: 'coach', text: 'Absolutely. Bring any notes from last time if you have them.' },
    { from: 'student', text: 'Will do. Weather looks clear, right?' },
    { from: 'coach', text: 'Yes — outdoor courts should be dry.' },
    { from: 'student', text: 'Great, catching up on older notes from our last chat…' },
    { from: 'coach', text: 'Scroll test padding: keep reading older messages above.' },
    { from: 'student', text: 'Still scrolling… message history filler for QA.' },
    { from: 'coach', text: 'Keep going — we need enough height to scroll the pane.' },
    { from: 'student', text: 'Almost there. Checking that the header stays put.' },
    { from: 'coach', text: 'When you open this thread, only `.chat-list` should jump.' },
    { from: 'student', text: 'If I scroll up and a poll arrives, I should stay put.' },
    { from: 'coach', text: 'If I’m near the bottom, a poll may stick me to newest.' },
    { from: 'student', text: 'Sending a message should force the pane to the bottom.' },
    { from: 'coach', text: 'Newest coach note before the end of the seed thread.' },
    { from: 'student', text: 'Newest student note — end of long-thread fixture.' },
    { from: 'coach', text: 'Final seeded coach reply for long-thread scroll QA.' },
  ];

  const now = Date.now();
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const script = scripts[i % scripts.length];
    const senderId = script.from === 'coach' ? coachId : studentId;
    const created = new Date(now - (count - i) * 3 * minMs);
    rows.push({
      conversation_id: conversationId,
      sender_id: senderId,
      message_text: `${script.text} (#${i + 1})`,
      created_at: created,
      updated_at: created,
    });
  }
  return rows;
}

function buildUnreadThreadMessages({ conversationId, studentId, coachId }) {
  const now = Date.now();
  const stamps = [
    now - 40 * minMs,
    now - 30 * minMs,
    now - 20 * minMs,
    now - 10 * minMs,
    now - 4 * minMs,
    now - 2 * minMs,
  ];
  const texts = [
    { sender_id: studentId, text: 'Running a few minutes behind — still on my way.' },
    { sender_id: coachId, text: 'No problem, I’ll warm up the court.' },
    { sender_id: studentId, text: 'Thanks! Just parked.' },
    { sender_id: coachId, text: 'Unread QA: please check this before we start.' },
    { sender_id: coachId, text: 'Unread QA: second coach ping for the badge count.' },
    { sender_id: coachId, text: 'Unread QA: latest coach message — should bump unread.' },
  ];
  return texts.map((row, i) => ({
    conversation_id: conversationId,
    sender_id: row.sender_id,
    message_text: row.text,
    created_at: new Date(stamps[i]),
    updated_at: new Date(stamps[i]),
  }));
}

async function main() {
  const messageCount = Math.max(20, parseIntArg('count', 48));

  await sequelize.authenticate();

  const student = await findTestUser('student.testflow');
  const coach = await findTestUser('coach.testflow');
  if (!student || !coach) {
    console.error('Testflow users missing. Run: npm run seed:test-flows');
    process.exit(1);
  }

  const lesson = await Lesson.findOne({
    where: { coach_id: coach.id, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
  });
  if (!lesson) {
    console.error('No active lesson for testflow coach. Run: npm run seed:test-flows');
    process.exit(1);
  }

  const coachCourt = await CoachCourtLocation.findOne({
    where: { coach_id: coach.id },
    order: [['id', 'ASC']],
  });
  if (!coachCourt?.court_id) {
    console.error('No court for testflow coach. Run: npm run seed:test-flows');
    process.exit(1);
  }

  const now = Date.now();
  const longBooking = await ensureBooking({
    key: STABLE_KEYS.long_thread,
    student,
    coach,
    lesson,
    courtLocationId: coachCourt.court_id,
    scheduledAt: new Date(now + 3 * dayMs),
  });
  const emptyBooking = await ensureBooking({
    key: STABLE_KEYS.empty_thread,
    student,
    coach,
    lesson,
    courtLocationId: coachCourt.court_id,
    scheduledAt: new Date(now + 5 * dayMs),
  });
  const unreadBooking = await ensureBooking({
    key: STABLE_KEYS.unread_thread,
    student,
    coach,
    lesson,
    courtLocationId: coachCourt.court_id,
    scheduledAt: new Date(now + 2 * dayMs),
  });

  const longConversation = await ensureConversation(longBooking);
  const emptyConversation = await ensureConversation(emptyBooking);
  const unreadConversation = await ensureConversation(unreadBooking);

  const longMessages = await replaceMessages(
    longConversation.id,
    buildLongThreadMessages({
      conversationId: longConversation.id,
      studentId: student.id,
      coachId: coach.id,
      count: messageCount,
    }),
  );
  await replaceMessages(emptyConversation.id, []);
  const unreadMessages = await replaceMessages(
    unreadConversation.id,
    buildUnreadThreadMessages({
      conversationId: unreadConversation.id,
      studentId: student.id,
      coachId: coach.id,
    }),
  );

  // Student has read only through the first student reply — later coach pings stay unread.
  const studentLastRead = unreadMessages[2]?.created_at || new Date(now - 25 * minMs);
  await ConversationRead.create({
    conversation_id: unreadConversation.id,
    user_id: student.id,
    last_read_at: studentLastRead,
  });
  // Coach has read everything (so unread badge is student-facing for this fixture).
  await ConversationRead.create({
    conversation_id: unreadConversation.id,
    user_id: coach.id,
    last_read_at: unreadMessages[unreadMessages.length - 1].created_at,
  });

  // Touch conversation updated_at for inbox ordering (long first after refresh).
  await longConversation.update({ updated_at: new Date() });
  await unreadConversation.update({ updated_at: new Date(Date.now() - minMs) });
  await emptyConversation.update({ updated_at: new Date(Date.now() - 2 * minMs) });

  console.log(
    JSON.stringify(
      {
        ok: true,
        password: PASSWORD,
        users: {
          student: {
            id: student.id,
            email: student.email,
            full_name: student.full_name,
          },
          coach: {
            id: coach.id,
            email: coach.email,
            full_name: coach.full_name,
          },
        },
        fixtures: {
          long_thread: {
            purpose: 'Scrollable chat pane — header should stay visible on open',
            booking_id: longBooking.id,
            conversation_id: longConversation.id,
            message_count: longMessages.length,
            path: `/messages/${longConversation.id}`,
          },
          empty_thread: {
            purpose: 'Counterpart name with zero messages',
            booking_id: emptyBooking.id,
            conversation_id: emptyConversation.id,
            message_count: 0,
            path: `/messages/${emptyConversation.id}`,
          },
          unread_thread: {
            purpose: 'Unread badge on student inbox (3 unread coach messages)',
            booking_id: unreadBooking.id,
            conversation_id: unreadConversation.id,
            message_count: unreadMessages.length,
            path: `/messages/${unreadConversation.id}`,
          },
        },
        how_to_test: [
          `Log in as student (${student.email}) or coach (${coach.email})`,
          'Open /messages and confirm counterpart names + booking context',
          `Hard-refresh /messages/${longConversation.id}`,
          'Confirm page header stays put; only the message pane scrolls to newest',
          'Scroll up in the chat pane, wait ~8s for poll — position should hold',
          'Send a message — chat pane should stick to bottom',
          `Open empty thread /messages/${emptyConversation.id} — name still shows, No messages yet`,
        ],
      },
      null,
      2,
    ),
  );

  await sequelize.close();
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
