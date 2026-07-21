/**
 * Frontend-dev fixtures on top of seed:test-flows (+ optional action/cancel seeds).
 *
 * Adds:
 *   - One in-app example of every product notification type (student + coach where relevant)
 *   - Resolved dispute examples covering common outcomes (attendance + behavior + other)
 *   - Current payment states only (authorized / captured / none — no legacy fake charge_ids)
 *
 * Prerequisites (from backend/):
 *   npm run db:reset:test          # or migrate + demo seed
 *   npm run seed:test-flows
 *   npm run seed:booking-action-tests   # optional but recommended
 *   npm run seed:cancel-test-bookings   # optional but recommended
 *
 * Run:
 *   npm run seed:dev-frontend
 *
 * Test users (password Test1234!Ab):
 *   student.testflow@picklecoach.example.org
 *   coach.testflow@picklecoach.example.org
 *   admin.testflow@picklecoach.example.org
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
  Payment,
  Dispute,
  DisputeType,
  DisputeResolutionAction,
  Notification,
  Conversation,
  Message,
} from '../models/index.js';
import {
  buildBookingConfirmedNotificationContent,
  buildBookingRequestCoachNotificationContent,
  buildBookingDeclinedNotificationContent,
  buildBookingCancelledNotificationContent,
  buildPreLessonReminderNotificationContent,
  buildNewMessageNotificationPayload,
} from '../notifications/payloadBuilders.js';
import { withNotificationRoute } from '../notifications/notificationRoutes.js';
import { ACTIVE_DISPUTE_TYPE_CODES } from '../utils/disputeTypeCatalog.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const TEST_EMAIL_DOMAIN = 'picklecoach.example.org';
const dayMs = 24 * 60 * 60 * 1000;
const minMs = 60 * 1000;

const idemKey = (label) =>
  `seed_fe_fixture_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function findTestUser(emailLocal) {
  return User.findOne({
    where: { email: `${emailLocal}@${TEST_EMAIL_DOMAIN}` },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
}

async function createNoStripePayment(booking, { paymentStatus = 'captured', escrowStatus = 'held' } = {}) {
  const price = Number(booking.price);
  const platformFee = (price * 8) / 100;
  const total = price + platformFee;
  const coachPayout = (price * 92) / 100;
  return Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: booking.primary_student_id,
    lesson_price: price.toFixed(2),
    platform_fee_percent: 8.0,
    platform_fee_amount: platformFee.toFixed(2),
    total_charge_to_student: total.toFixed(2),
    coach_payout_expected: coachPayout.toFixed(2),
    escrow_status: escrowStatus,
    payment_status: paymentStatus,
    refund_status: 'none',
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: paymentStatus === 'authorized' ? `pi_seed_fe_${booking.id}` : null,
    charge_id: null,
    metadata:
      paymentStatus === 'authorized'
        ? { capture_on_accept: true, flow: 'authorize_then_book' }
        : {},
  });
}

async function createSentInApp(userId, type, payload, { entity_type = null, entity_id = null } = {}) {
  return Notification.create({
    user_id: userId,
    type,
    channel: 'in_app',
    entity_type,
    entity_id,
    payload: withNotificationRoute(type, payload || {}),
    status: 'sent',
    sent_at: new Date(),
  });
}

async function seedNotificationExamples({ student, coach, bookingId, conversationId, message }) {
  const lessonTitle = 'Frontend fixture lesson';
  const scheduledAt = new Date(Date.now() + 2 * dayMs).toISOString();

  const studentNotifs = [
    [
      'booking_confirmed',
      {
        booking_id: bookingId,
        coach_name: coach.full_name,
        lesson_title: lessonTitle,
        scheduled_at: scheduledAt,
        ...buildBookingConfirmedNotificationContent({
          coach_name: coach.full_name,
          lesson_title: lessonTitle,
        }),
      },
    ],
    [
      'booking_declined',
      {
        booking_id: bookingId,
        decline_reason_code: 'schedule_conflict',
        message_to_student: 'Sorry — that slot no longer works.',
        ...buildBookingDeclinedNotificationContent({
          decline_reason_code: 'schedule_conflict',
          message_to_student: 'Sorry — that slot no longer works.',
        }),
      },
    ],
    [
      'booking_cancelled',
      {
        booking_id: bookingId,
        cancelled_by: 'coach',
        reason: 'weather',
        reason_notes: 'Court flooded.',
        refund_amount: 54,
        refund_status: 'pending_stripe_execution',
        ...buildBookingCancelledNotificationContent({
          cancelled_by: 'coach',
          reason: 'weather',
          reason_notes: 'Court flooded.',
          refund_amount: 54,
          refund_status: 'pending_stripe_execution',
        }),
      },
    ],
    [
      'pre_lesson_24h',
      {
        booking_id: bookingId,
        scheduled_at: scheduledAt,
        coach_name: coach.full_name,
        lesson_title: lessonTitle,
        reminder_type: '24h',
        audience: 'student',
        ...buildPreLessonReminderNotificationContent({
          reminder_type: '24h',
          audience: 'student',
          coach_name: coach.full_name,
          lesson_title: lessonTitle,
        }),
      },
    ],
    [
      'pre_lesson_1h',
      {
        booking_id: bookingId,
        scheduled_at: scheduledAt,
        coach_name: coach.full_name,
        lesson_title: lessonTitle,
        reminder_type: '1h',
        audience: 'student',
        ...buildPreLessonReminderNotificationContent({
          reminder_type: '1h',
          audience: 'student',
          coach_name: coach.full_name,
          lesson_title: lessonTitle,
        }),
      },
    ],
    [
      'new_message',
      buildNewMessageNotificationPayload({
        message,
        booking: { id: bookingId },
        sender: coach,
        conversationId,
      }),
      { entity_type: 'message', entity_id: message.id },
    ],
  ];

  const coachNotifs = [
    [
      'booking_request_coach',
      {
        booking_id: bookingId,
        student_name: student.full_name,
        lesson_title: lessonTitle,
        scheduled_at: scheduledAt,
        ...buildBookingRequestCoachNotificationContent({
          student_name: student.full_name,
          lesson_title: lessonTitle,
        }),
      },
    ],
    [
      'booking_cancelled',
      {
        booking_id: bookingId,
        cancelled_by: 'student',
        reason: 'sickness',
        ...buildBookingCancelledNotificationContent({
          cancelled_by: 'student',
          reason: 'sickness',
        }),
      },
    ],
    [
      'pre_lesson_24h',
      {
        booking_id: bookingId,
        scheduled_at: scheduledAt,
        student_name: student.full_name,
        lesson_title: lessonTitle,
        reminder_type: '24h',
        audience: 'coach',
        ...buildPreLessonReminderNotificationContent({
          reminder_type: '24h',
          audience: 'coach',
          student_name: student.full_name,
          lesson_title: lessonTitle,
        }),
      },
    ],
    [
      'pre_lesson_1h',
      {
        booking_id: bookingId,
        scheduled_at: scheduledAt,
        student_name: student.full_name,
        lesson_title: lessonTitle,
        reminder_type: '1h',
        audience: 'coach',
        ...buildPreLessonReminderNotificationContent({
          reminder_type: '1h',
          audience: 'coach',
          student_name: student.full_name,
          lesson_title: lessonTitle,
        }),
      },
    ],
    [
      'new_message',
      buildNewMessageNotificationPayload({
        message: { id: message.id, message_text: 'Looking forward to the lesson!', conversation_id: conversationId },
        booking: { id: bookingId },
        sender: student,
        conversationId,
      }),
      { entity_type: 'message', entity_id: message.id },
    ],
  ];

  const created = [];
  for (const [type, payload, opts] of studentNotifs) {
    created.push(await createSentInApp(student.id, type, payload, opts));
  }
  for (const [type, payload, opts] of coachNotifs) {
    created.push(await createSentInApp(coach.id, type, payload, opts));
  }
  return created;
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

async function seedResolvedDisputeExamples({ student, coach, lesson, courtId, admin }) {
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

  const specs = [
    {
      key: 'resolved_coach_no_show_upheld',
      type: 'coach_no_show_claim',
      bookingStatus: 'coach_no_show',
      opened_by: 'student',
      decision: 'upheld',
      outcome: 'coach_no_show',
      financial: 'refund_student',
      penalize_role: 'none',
      status: 'resolved',
    },
    {
      key: 'resolved_student_no_show_upheld',
      type: 'student_no_show_claim',
      bookingStatus: 'student_no_show',
      opened_by: 'coach',
      decision: 'upheld',
      outcome: 'student_no_show',
      financial: 'no_change',
      penalize_role: 'none',
      status: 'resolved',
    },
    {
      key: 'resolved_misconduct_upheld_coach',
      type: 'misconduct',
      bookingStatus: 'completed',
      opened_by: 'student',
      decision: 'upheld',
      outcome: null,
      financial: 'no_change',
      penalize_role: 'coach',
      status: 'resolved',
    },
    {
      key: 'resolved_lesson_not_completed_partial',
      type: 'lesson_not_completed',
      bookingStatus: 'completed',
      opened_by: 'student',
      decision: 'partial',
      outcome: null,
      financial: 'refund_student_partial',
      penalize_role: 'coach',
      status: 'resolved',
      refund_cents: 2500,
    },
    {
      key: 'resolved_other_rejected',
      type: 'other',
      bookingStatus: 'completed',
      opened_by: 'student',
      decision: 'rejected',
      outcome: null,
      financial: 'no_change',
      penalize_role: 'none',
      status: 'rejected',
    },
  ];

  const out = [];
  const now = Date.now();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const end = new Date(now - (4 + i) * dayMs);
    const scheduledAt = new Date(end.getTime() - lesson.duration_minutes * minMs);
    const booking = await Booking.create({
      lesson_id: lesson.id,
      coach_id: coach.id,
      primary_student_id: student.id,
      scheduled_at: scheduledAt,
      duration_minutes: lesson.duration_minutes,
      price: lesson.price,
      court_location_id: courtId,
      status: spec.bookingStatus,
      payout_status: 'none',
      messaging_locked: true,
      idempotency_key: idemKey(spec.key),
    });
    await createNoStripePayment(booking, { paymentStatus: 'captured', escrowStatus: 'held' });

    const actionId = await resolveActionId(spec.financial);
    const dispute = await Dispute.create({
      booking_id: booking.id,
      dispute_type_id: types[spec.type].id,
      notes: `Frontend fixture: ${spec.key}`,
      opened_by: spec.opened_by,
      status: spec.status,
      decision: spec.decision,
      outcome: spec.outcome,
      penalize_role: spec.penalize_role,
      resolution_action_id: actionId,
      resolution_notes: `Seeded ${spec.decision} / ${spec.financial}`,
      refund_cents: spec.refund_cents ?? null,
      admin_id: admin.id,
      resolved_at: new Date(),
    });
    out.push({
      key: spec.key,
      booking_id: booking.id,
      dispute_id: dispute.id,
      type: spec.type,
      decision: spec.decision,
      financial_action: spec.financial,
      booking_status: booking.status,
    });
  }
  return out;
}

async function main() {
  const admin = await findTestUser('admin.testflow');
  const coach = await findTestUser('coach.testflow');
  const student = await findTestUser('student.testflow');
  if (!admin || !coach || !student) {
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
  if (!coachCourt) {
    console.error('No court for testflow coach. Run: npm run seed:test-flows');
    process.exit(1);
  }

  // Anchor booking + conversation for notification deep links
  const anchor = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: new Date(Date.now() + 5 * dayMs),
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: coachCourt.court_location_id,
    status: 'confirmed',
    payout_status: 'none',
    messaging_locked: false,
    idempotency_key: idemKey('notif_anchor'),
  });
  await createNoStripePayment(anchor, { paymentStatus: 'captured' });

  const conversation = await Conversation.create({
    booking_id: anchor.id,
  });
  const message = await Message.create({
    conversation_id: conversation.id,
    sender_id: coach.id,
    message_text: 'See you on the court!',
  });

  const notifications = await seedNotificationExamples({
    student,
    coach,
    bookingId: anchor.id,
    conversationId: conversation.id,
    message,
  });

  const disputes = await seedResolvedDisputeExamples({
    student,
    coach,
    lesson,
    courtId: coachCourt.court_location_id,
    admin,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        users: {
          student: { id: student.id, email: student.email },
          coach: { id: coach.id, email: coach.email },
          admin: { id: admin.id, email: admin.email },
        },
        notification_anchor: {
          booking_id: anchor.id,
          conversation_id: conversation.id,
          message_id: message.id,
        },
        notifications_seeded: notifications.length,
        notification_types: [...new Set(notifications.map((n) => n.type))],
        resolved_disputes: disputes,
        next: [
          'npm run seed:booking-action-tests  # pending accept/decline/cancel',
          'npm run seed:cancel-test-bookings  # cancel policy windows',
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
