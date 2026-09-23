/**
 * Deterministic Admin QA matrix — wipe + reseed bookings/users for manual admin acceptance.
 *
 * Idempotent on prefix `qa_admin_matrix_` (bookings) and emails `qa.admin.*@picklecoach.example.org`.
 * Reuses Test Flow coach/student/admin. Does NOT alter booking/dispute/refund product rules.
 *
 * Prerequisites (from backend/):
 *   npm run seed:test-flows
 *   npm run seed:admin-qa
 *
 * Login (admin):
 *   admin.testflow@picklecoach.example.org / Test1234!Ab
 *
 * Stripe:
 *   Cases K/L use `ch_seed_dev_*` stubs (in-process refund stubs). Live Stripe not required for UI gates.
 *   Live charge refunds still need seed:admin-resolve-charged + sk_test.
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import {
  sequelize,
  Booking,
  BookingPlayer,
  Lesson,
  User,
  UserRole,
  UserReliability,
  CoachProfile,
  CoachAvailability,
  CoachCourtLocation,
  CourtLocation,
  Dispute,
  DisputeType,
  DisputeResolutionAction,
  Payment,
  PaymentAction,
  CancellationHistory,
  Conversation,
  ConversationRead,
  Message,
  Review,
  Notification,
} from '../models/index.js';
import { calculatePaymentAmounts } from '../services/paymentEngine.js';
import { registerDevSeedPaymentIntent } from '../services/stripeService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const IDEM_PREFIX = 'qa_admin_matrix_';
const QA_EMAIL_DOMAIN = 'picklecoach.example.org';
const PASSWORD = 'Test1234!Ab';
const PAGE_USER_COUNT = 55;

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const minMs = 60 * 1000;

async function findTestflow(role, emailLocal) {
  const email = `${emailLocal}@${QA_EMAIL_DOMAIN}`;
  const user = await User.findOne({
    where: { email },
    include: [{ model: UserRole, as: 'userRoles', where: { role }, required: true }],
  });
  if (!user) {
    throw new Error(`Missing ${email}. Run: npm run seed:test-flows`);
  }
  return user;
}

async function pickLesson(coachId) {
  return Lesson.findOne({
    where: { coach_id: coachId, is_active: true, deleted_at: null },
    order: [['id', 'ASC']],
  });
}

async function listCoachCourtIds(coachId) {
  const links = await CoachCourtLocation.findAll({
    where: { coach_id: coachId },
    include: [{ model: CourtLocation, as: 'court', where: { deleted_at: null }, required: true }],
    order: [['id', 'ASC']],
  });
  return links.map((l) => l.court.id);
}

async function ensureSecondCourt(coachId, transaction) {
  const existing = await listCoachCourtIds(coachId);
  if (existing.length >= 2) return existing;
  const court = await CourtLocation.create(
    {
      name: 'QA Admin Matrix Court B',
      address_line1: '200 QA Seed Ave',
      city: 'Miami',
      state: 'FL',
      postal_code: '33101',
      country: 'US',
      latitude: 25.7617,
      longitude: -80.1918,
      is_private: false,
      created_by_user_id: coachId,
    },
    { transaction },
  );
  await CoachCourtLocation.create(
    { coach_id: coachId, court_id: court.id, coach_notes: 'QA Admin Matrix second court' },
    { transaction },
  );
  return [...existing, court.id];
}

async function ensureCoachAvailability(coachId, label, transaction) {
  const existing = await CoachAvailability.count({ where: { coach_id: coachId }, transaction });
  if (existing > 0) return existing;
  await CoachAvailability.bulkCreate(
    [
      {
        coach_id: coachId,
        weekday: 1,
        start_time: '09:00:00',
        end_time: '12:00:00',
        start_date: null,
        end_date: null,
      },
      {
        coach_id: coachId,
        weekday: 3,
        start_time: '14:00:00',
        end_time: '17:00:00',
        start_date: null,
        end_date: null,
      },
    ],
    { transaction },
  );
  console.log(`  + availability slots for ${label}`);
  return 2;
}

async function ensureReliabilityRow(userId, role, score, transaction) {
  const [row] = await UserReliability.findOrCreate({
    where: { user_id: userId, role },
    defaults: {
      user_id: userId,
      role,
      reliability_score: score,
      score_source: 'computed',
      total_bookings_recent: 5,
      last_updated: new Date(),
    },
    transaction,
  });
  if (Number(row.reliability_score) !== score) {
    await row.update(
      { reliability_score: score, score_source: 'computed', last_updated: new Date() },
      { transaction },
    );
  }
  return row;
}

async function wipePriorBookings(transaction) {
  const prior = await Booking.findAll({
    where: { idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` } },
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
    await ConversationRead.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, transaction });
    await Message.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, transaction });
    await Conversation.destroy({ where: { id: { [Op.in]: conversationIds } }, transaction });
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
  await sequelize.query('UPDATE payments SET dispute_id = NULL WHERE booking_id IN (:ids)', {
    replacements: { ids: priorIds },
    transaction,
  });
  await Dispute.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await CancellationHistory.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await PaymentAction.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Payment.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await BookingPlayer.destroy({ where: { booking_id: { [Op.in]: priorIds } }, transaction });
  await Booking.destroy({ where: { id: { [Op.in]: priorIds } }, transaction });
  return priorIds.length;
}

async function ensureCapturedPayment(booking, { label, transaction, refunded = false }) {
  const amounts = calculatePaymentAmounts(booking.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  const amountCapturableCents = Math.round(totalCharge * 100);
  const paymentIntentId = `pi_seed_dev_${IDEM_PREFIX}${label}_${booking.id}`;
  registerDevSeedPaymentIntent(paymentIntentId, { amountCapturableCents });
  const refundedAmount = refunded ? amounts.total_charge_to_student : 0;
  return Payment.create(
    {
      booking_id: booking.id,
      coach_id: booking.coach_id,
      student_id: booking.primary_student_id,
      lesson_price: amounts.lesson_price,
      platform_fee_percent: amounts.platform_fee_percent,
      platform_fee_amount: amounts.platform_fee_amount,
      total_charge_to_student: amounts.total_charge_to_student,
      coach_payout_expected: refunded ? 0 : amounts.coach_payout_expected,
      escrow_status: refunded ? 'refunded' : 'held',
      payment_status: refunded ? 'refunded' : 'captured',
      refund_status: refunded ? 'succeeded' : 'none',
      refunded_amount: refundedAmount,
      payment_method: 'stripe',
      payment_intent_id: paymentIntentId,
      charge_id: `ch_seed_dev_${IDEM_PREFIX}${label}_${booking.id}`,
      ...(refunded ? { stripe_refund_id: `re_seed_dev_${booking.id}` } : {}),
    },
    { transaction },
  );
}

async function ensureAuthorizedPayment(booking, { label, transaction }) {
  const amounts = calculatePaymentAmounts(booking.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  const amountCapturableCents = Math.round(totalCharge * 100);
  const paymentIntentId = `pi_seed_dev_${IDEM_PREFIX}${label}_${booking.id}`;
  registerDevSeedPaymentIntent(paymentIntentId, { amountCapturableCents });
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
      escrow_status: 'pending',
      payment_status: 'authorized',
      refund_status: 'none',
      payment_method: 'stripe',
      payment_intent_id: paymentIntentId,
    },
    { transaction },
  );
}

function buildBookingSpecs(anchor, durationMinutes) {
  const durMs = durationMinutes * 60 * 1000;
  return [
    {
      key: 'A_pending',
      title: 'A · Pending (admin cancel OK)',
      status: 'pending',
      scheduled_at: new Date(anchor.getTime() + 2 * dayMs),
      payout_status: 'none',
      messaging_locked: true,
      payment: 'authorized',
      notes: 'Admin Cancel should be available',
    },
    {
      key: 'B_confirmed_upcoming',
      title: 'B · Confirmed upcoming (admin cancel OK)',
      status: 'confirmed',
      scheduled_at: new Date(anchor.getTime() + 3 * dayMs),
      payout_status: 'none',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Admin Cancel should be available; not no-show eligible yet',
    },
    {
      key: 'C_confirmed_started',
      title: 'C · Confirmed started (cancel blocked)',
      status: 'confirmed',
      scheduled_at: new Date(anchor.getTime() - 30 * minMs),
      payout_status: 'none',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Lesson started — Admin Cancel unavailable',
    },
    {
      key: 'D_awaiting_student_ns',
      title: 'D · Awaiting verification (mark student no-show)',
      status: 'awaiting_verification',
      scheduled_at: new Date(anchor.getTime() - 3 * hourMs - durMs),
      payout_status: 'awaiting_verification',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Admin Mark student no-show',
    },
    {
      key: 'D2_awaiting_coach_ns',
      title: 'D2 · Awaiting verification (mark coach no-show)',
      status: 'awaiting_verification',
      scheduled_at: new Date(anchor.getTime() - 4 * hourMs - durMs),
      payout_status: 'awaiting_verification',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Admin Mark coach no-show',
    },
    {
      key: 'E_completed',
      title: 'E · Completed (cancel/no-show blocked)',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 48 * hourMs - durMs),
      payout_status: 'pending',
      messaging_locked: false,
      payment: 'captured',
      attendance_finalized: false,
      notes: 'Outside review window; cancel/no-show unavailable',
    },
    {
      key: 'F_student_no_show',
      title: 'F · Student no-show',
      status: 'student_no_show',
      scheduled_at: new Date(anchor.getTime() - 40 * hourMs - durMs),
      payout_status: 'pending',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Filter: Student no-show',
    },
    {
      key: 'G_coach_no_show',
      title: 'G · Coach no-show',
      status: 'coach_no_show',
      scheduled_at: new Date(anchor.getTime() - 42 * hourMs - durMs),
      payout_status: 'none',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Filter: Coach no-show',
    },
    {
      key: 'H_cancelled',
      title: 'H · Cancelled',
      status: 'cancelled',
      scheduled_at: new Date(anchor.getTime() + dayMs),
      payout_status: 'none',
      messaging_locked: true,
      payment: null,
      notes: 'Cancel unavailable',
    },
    {
      key: 'I_open_dispute',
      title: 'I · Open dispute (refund blocked)',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 36 * hourMs - durMs),
      payout_status: 'pending',
      messaging_locked: false,
      payment: 'captured',
      openDispute: true,
      notes: 'Refund unavailable — resolve dispute',
    },
    {
      key: 'J_resolved_dispute_refund',
      title: 'J · Resolved dispute (refund path used)',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 50 * hourMs - durMs),
      payout_status: 'none',
      messaging_locked: false,
      payment: 'refunded',
      resolvedDispute: true,
      notes: 'Refund path already used',
    },
    {
      key: 'K_eligible_full_refund',
      title: 'K · Eligible full refund',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 52 * hourMs - durMs),
      payout_status: 'pending',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Outside review window — full refund + reason',
    },
    {
      key: 'L_eligible_partial_refund',
      title: 'L · Eligible partial refund',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 54 * hourMs - durMs),
      payout_status: 'pending',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Outside review window — partial amount',
    },
    {
      key: 'M_already_refunded',
      title: 'M · Already refunded',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 56 * hourMs - durMs),
      payout_status: 'none',
      messaging_locked: false,
      payment: 'refunded',
      notes: 'Refund button unavailable',
    },
    {
      key: 'N_review_window_open',
      title: 'N · Financial review window open',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 2 * hourMs - durMs),
      payout_status: 'pending',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Refund unavailable (24h window)',
    },
    {
      key: 'O_no_payment',
      title: 'O · No payment row (refund missing payment)',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 60 * hourMs - durMs),
      payout_status: 'none',
      messaging_locked: false,
      payment: null,
      notes: 'Soft UI: no captured charge; API 404 if forced',
    },
    {
      key: 'P_admin_create_dispute',
      title: 'P · Eligible for admin-created dispute',
      status: 'completed',
      scheduled_at: new Date(anchor.getTime() - 5 * hourMs - durMs),
      payout_status: 'pending',
      messaging_locked: false,
      payment: 'captured',
      notes: 'Create dispute (admin) form should appear',
    },
  ];
}

async function upsertQaUser({
  email,
  fullName,
  roles,
  passwordHash,
  isActive = true,
  deletedAt = null,
  transaction,
}) {
  let user = await User.findOne({ where: { email }, transaction });
  if (!user) {
    user = await User.create(
      {
        full_name: fullName,
        email,
        password_hash: passwordHash,
        phone: '555-0100',
        timezone: 'America/New_York',
        is_active: isActive,
        deleted_at: deletedAt,
        email_verified_at: new Date(),
      },
      { transaction },
    );
  } else {
    await user.update(
      {
        full_name: fullName,
        is_active: isActive,
        deleted_at: deletedAt,
        password_hash: passwordHash,
        email_verified_at: user.email_verified_at || new Date(),
      },
      { transaction },
    );
  }
  await UserRole.destroy({ where: { user_id: user.id }, transaction });
  for (const role of roles) {
    await UserRole.create({ user_id: user.id, role }, { transaction });
  }
  return user;
}

async function ensureSuspendedCoachStack(passwordHash, transaction) {
  const coach = await upsertQaUser({
    email: `qa.admin.coach.suspended@${QA_EMAIL_DOMAIN}`,
    fullName: 'QA Admin Suspended Coach',
    roles: ['coach'],
    passwordHash,
    isActive: false,
    deletedAt: null,
    transaction,
  });
  let profile = await CoachProfile.findOne({ where: { user_id: coach.id }, transaction });
  if (!profile) {
    profile = await CoachProfile.create(
      {
        user_id: coach.id,
        headline: 'QA Suspended Coach (admin availability list)',
        bio: 'Suspended coach for admin courts/availability QA',
        experience_years: 3,
        stripe_ready: false,
      },
      { transaction },
    );
  }
  const courtCount = await CoachCourtLocation.count({ where: { coach_id: coach.id }, transaction });
  if (courtCount === 0) {
    const court = await CourtLocation.create(
      {
        name: 'QA Suspended Coach Court',
        address_line1: '1 Suspended Lane',
        city: 'Miami',
        state: 'FL',
        postal_code: '33101',
        country: 'US',
        latitude: 25.77,
        longitude: -80.2,
        is_private: false,
        created_by_user_id: coach.id,
      },
      { transaction },
    );
    await CoachCourtLocation.create(
      { coach_id: coach.id, court_id: court.id, coach_notes: 'QA suspended coach court' },
      { transaction },
    );
  }
  await ensureCoachAvailability(coach.id, 'suspended coach', transaction);
  return coach;
}

async function main() {
  await sequelize.authenticate();

  const admin = await findTestflow('admin', 'admin.testflow');
  const coach = await findTestflow('coach', 'coach.testflow');
  const student = await findTestflow('student', 'student.testflow');
  const lesson = await pickLesson(coach.id);
  if (!lesson) {
    throw new Error('Test flow coach has no active lesson. Run seed:test-flows.');
  }

  const misconduct = await DisputeType.findOne({ where: { code: 'misconduct' } });
  const refundAction = await DisputeResolutionAction.findOne({ where: { code: 'approved_refund' } });
  if (!misconduct || !refundAction) {
    throw new Error('Missing dispute type/action catalog. Run db:migrate / db:seed.');
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const anchor = new Date();
  const specs = buildBookingSpecs(anchor, lesson.duration_minutes || 60);

  const summary = await sequelize.transaction(async (t) => {
    const wiped = await wipePriorBookings(t);
    console.log(`Wiped ${wiped} prior qa_admin_matrix_ booking(s).`);

    const courtIds = await ensureSecondCourt(coach.id, t);
    await ensureCoachAvailability(coach.id, 'testflow coach', t);
    await ensureReliabilityRow(coach.id, 'coach', 88, t);
    await ensureReliabilityRow(student.id, 'student', 91, t);

    const suspendedCoach = await ensureSuspendedCoachStack(passwordHash, t);

    const suspendedStudent = await upsertQaUser({
      email: `qa.admin.student.suspended@${QA_EMAIL_DOMAIN}`,
      fullName: 'QA Admin Suspended Student',
      roles: ['student'],
      passwordHash,
      isActive: false,
      deletedAt: null,
      transaction: t,
    });

    const deletedStudent = await upsertQaUser({
      email: `qa.admin.student.deleted@${QA_EMAIL_DOMAIN}`,
      fullName: 'QA Admin Deleted Student',
      roles: ['student'],
      passwordHash,
      isActive: false,
      deletedAt: new Date('2026-01-15T12:00:00.000Z'),
      transaction: t,
    });

    const pageUsers = [];
    for (let i = 1; i <= PAGE_USER_COUNT; i += 1) {
      const n = String(i).padStart(3, '0');
      const u = await upsertQaUser({
        email: `qa.admin.page.${n}@${QA_EMAIL_DOMAIN}`,
        fullName: `QA Admin Page User ${n}`,
        roles: ['student'],
        passwordHash,
        isActive: true,
        deletedAt: null,
        transaction: t,
      });
      pageUsers.push(u);
    }

    const created = [];
    for (const spec of specs) {
      const booking = await Booking.create(
        {
          lesson_id: lesson.id,
          coach_id: coach.id,
          primary_student_id: student.id,
          duration_minutes: lesson.duration_minutes,
          price: lesson.price,
          court_location_id: courtIds[0] || null,
          idempotency_key: `${IDEM_PREFIX}${spec.key}`,
          status: spec.status,
          scheduled_at: spec.scheduled_at,
          payout_status: spec.payout_status,
          messaging_locked: Boolean(spec.messaging_locked),
          attendance_finalized: Boolean(spec.attendance_finalized),
          created_at: new Date(anchor.getTime() - 7 * dayMs),
        },
        { transaction: t },
      );

      if (spec.payment === 'authorized') {
        await ensureAuthorizedPayment(booking, { label: spec.key, transaction: t });
      } else if (spec.payment === 'captured') {
        await ensureCapturedPayment(booking, { label: spec.key, transaction: t });
      } else if (spec.payment === 'refunded') {
        await ensureCapturedPayment(booking, { label: spec.key, transaction: t, refunded: true });
      }

      let disputeId = null;
      if (spec.openDispute) {
        const dispute = await Dispute.create(
          {
            booking_id: booking.id,
            dispute_type_id: misconduct.id,
            notes: `QA Admin Matrix · ${spec.title} · open`,
            opened_by: 'student',
            status: 'open',
            opened_at: new Date(anchor.getTime() - hourMs),
          },
          { transaction: t },
        );
        disputeId = dispute.id;
        await booking.update({ status: 'disputed' }, { transaction: t });
      }

      if (spec.resolvedDispute) {
        const dispute = await Dispute.create(
          {
            booking_id: booking.id,
            dispute_type_id: misconduct.id,
            notes: `QA Admin Matrix · ${spec.title} · resolved with refund`,
            opened_by: 'student',
            status: 'resolved',
            decision: 'upheld',
            penalize_role: 'coach',
            resolution_action_id: refundAction.id,
            resolution_notes: 'QA seed resolved with full refund path',
            admin_id: admin.id,
            opened_at: new Date(anchor.getTime() - 3 * dayMs),
            resolved_at: new Date(anchor.getTime() - 2 * dayMs),
            refund_cents: Math.round(Number(calculatePaymentAmounts(booking.price).total_charge_to_student) * 100),
          },
          { transaction: t },
        );
        disputeId = dispute.id;
        await sequelize.query(
          'UPDATE payments SET dispute_id = :disputeId WHERE booking_id = :bookingId',
          { replacements: { disputeId: dispute.id, bookingId: booking.id }, transaction: t },
        );
      }

      if (spec.key === 'H_cancelled') {
        await CancellationHistory.create(
          {
            booking_id: booking.id,
            cancelled_by: 'admin',
            reason: 'schedule_conflict',
            reason_notes: 'QA Admin Matrix cancelled fixture',
            refund_amount: 0,
          },
          { transaction: t },
        );
      }

      created.push({
        id: booking.id,
        key: spec.key,
        title: spec.title,
        status: spec.openDispute ? 'disputed' : spec.status,
        disputeId,
        notes: spec.notes,
      });
    }

    return {
      wiped,
      created,
      courtIds,
      suspendedCoach,
      suspendedStudent,
      deletedStudent,
      pageUserCount: pageUsers.length,
    };
  });

  console.log('\n=== Admin QA matrix ready ===\n');
  console.log('Login admin:', `admin.testflow@${QA_EMAIL_DOMAIN}`, '/', PASSWORD);
  console.log('Coach / student (bookings):', `coach.testflow@${QA_EMAIL_DOMAIN}`, '/', `student.testflow@${QA_EMAIL_DOMAIN}`);
  console.log(`Courts on testflow coach: ${summary.courtIds.length} (unlink one on coach support page)`);
  console.log(`Pagination users: ${summary.pageUserCount} × qa.admin.page.NNN@${QA_EMAIL_DOMAIN}`);
  console.log('Suspended student:', summary.suspendedStudent.email);
  console.log('Deleted student (restore):', summary.deletedStudent.email);
  console.log('Suspended coach (availability admin list):', summary.suspendedCoach.email);
  console.log('\nBookings:');
  for (const row of summary.created) {
    console.log(
      `  #${row.id}  ${row.key.padEnd(28)}  status=${row.status.padEnd(22)}  ${row.title}`
        + (row.disputeId ? `  dispute=#${row.disputeId}` : ''),
    );
  }
  console.log('\nStripe: K/L/M use ch_seed_dev_* stubs (no live Stripe required for UI).');
  console.log('Live charge refunds: npm run seed:admin-resolve-charged (separate).');
  console.log(`\nWiped prior matrix bookings: ${summary.wiped}`);
  console.log(`Created matrix bookings: ${summary.created.length}`);
}

main()
  .catch(async (err) => {
    console.error('seed-admin-qa-matrix failed:', err.message);
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await sequelize.close();
    } catch {
      /* ignore */
    }
  });
