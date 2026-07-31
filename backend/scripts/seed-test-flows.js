/**
 * Reset and reseed the booking/dispute test data used to exercise these endpoints
 * end-to-end (without needing Stripe credentials in most paths):
 *
 *   - POST /api/bookings/:id/cancel                       (student/coach/admin)
 *   - POST /api/disputes                                  (create dispute)
 *   - POST /api/bookings/:id/student-no-show              (coach marks student no-show)
 *   - POST /api/admin/bookings/:id/student-no-show        (admin override)
 *   - POST /api/admin/bookings/:id/coach-no-show          (admin marks coach no-show)
 *   - POST /api/admin/bookings/:id/refund                 (admin refund — see Stripe note below)
 *   - PUT  /api/disputes/:id/resolve                      (admin resolves dispute)
 *
 * Stripe note:
 *   We never set a real `charge_id` on seeded payments. That makes most of the
 *   endpoints above succeed without ever calling Stripe (the controllers detect
 *   "no Stripe charge" and skip the API call). The admin refund endpoint and any
 *   refund_student* dispute resolution still require a real Stripe charge to
 *   fully execute; without `STRIPE_SECRET_KEY` they return a clear 400/502 that
 *   you can still validate as the wired-up error path.
 *
 *   The `confirmed_for_student_no_show` booking includes a `payments` row
 *   (`captured`, `held`, `charge_id` null) so it matches production: money is
 *   recorded locally and `payoutWorker` can select it after student no-show;
 *   `releaseEscrow` still needs Stripe + Connect to actually pay the coach.
 *
 * Test users (all email_verified):
 *   Admin   admin.testflow@picklecoach.example.org    / Test1234!Ab
 *   Coach   coach.testflow@picklecoach.example.org    / Test1234!Ab
 *   Student student.testflow@picklecoach.example.org  / Test1234!Ab
 *
 * Preserves demo-seed coach profiles (coachN@example.com) so student
 * `GET /api/coaches` still returns marketplace results after this reseed.
 *
 * Run from `backend/`:
 *   npm run seed:test-flows
 */

import dotenv from 'dotenv';
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import {
  sequelize,
  User,
  UserRole,
  UserReliability,
  CoachProfile,
  CoachAvailability,
  CourtLocation,
  CoachCourtLocation,
  Lesson,
  Booking,
  BookingPlayer,
  Payment,
  PaymentAction,
  Payout,
  Dispute,
  DisputeType,
  DisputeResolutionAction,
  CancellationHistory,
  Review,
  StudentFeedback,
  Conversation,
  Message,
  Notification,
  AuditLog,
} from '../models/index.js';

/** Joi-valid; not matched by demo seeder wipe (`%@example.com`). */
const TEST_EMAIL_DOMAIN = 'picklecoach.example.org';
const PASSWORD = 'Test1234!Ab';
const PASSWORD_HASH_ROUNDS = 10;

const dayMs = 24 * 60 * 60 * 1000;
const minMs = 60 * 1000;

const idemKey = (label) =>
  `seed_testflow_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function checkReferenceData() {
  const requiredTypeCodes = ['coach_no_show_claim', 'student_no_show_claim', 'misconduct'];
  const requiredActionCodes = ['approved_refund', 'no_action', 'partial_refund'];

  const types = await DisputeType.findAll({ where: { code: requiredTypeCodes } });
  const missingTypes = requiredTypeCodes.filter(
    (c) => !types.find((t) => t.code === c),
  );
  if (missingTypes.length) {
    throw new Error(
      `dispute_types missing codes: ${missingTypes.join(
        ', ',
      )}. Run \`npm run db:migrate\` (and \`npm run db:seed\` if needed) before reseeding test flows.`,
    );
  }

  const actions = await DisputeResolutionAction.findAll({ where: { code: requiredActionCodes } });
  const missingActions = requiredActionCodes.filter(
    (c) => !actions.find((a) => a.code === c),
  );
  if (missingActions.length) {
    throw new Error(
      `dispute_resolution_actions missing codes: ${missingActions.join(
        ', ',
      )}. Run \`npm run db:migrate\` before reseeding test flows.`,
    );
  }
}

async function wipe() {
  console.log('Wiping booking/payment/dispute data...');

  // Only delete users we created (preserve demo coaches/students and any real admin).
  const testUsers = await User.findAll({
    where: { email: { [Op.like]: `%@${TEST_EMAIL_DOMAIN}` } },
    attributes: ['id'],
  });
  // Also pick up a renamed/suspended leftover that still owns the test-flow profile
  // (e.g. email changed during admin UX testing → coach disappears from GET /api/coaches).
  const leftoverProfiles = await CoachProfile.findAll({
    where: { headline: 'Test Flow Coach Pro' },
    attributes: ['user_id'],
  });
  const testIds = [...new Set([
    ...testUsers.map((u) => u.id),
    ...leftoverProfiles.map((p) => p.user_id),
  ])];

  // FK-safe order: leaves first, parents last. Booking/payment/dispute tables are
  // wiped fully (dev only) so reseeded fixture IDs stay predictable.
  await Notification.destroy({ where: {} });
  await AuditLog.destroy({ where: {} });
  await Review.destroy({ where: {} });
  await Payout.destroy({ where: {} });
  await PaymentAction.destroy({ where: {} });
  await CancellationHistory.destroy({ where: {} });
  await StudentFeedback.destroy({ where: {} });
  await Message.destroy({ where: {} });
  await Conversation.destroy({ where: {} });
  await Payment.destroy({ where: {} });
  await Dispute.destroy({ where: {} });
  await BookingPlayer.destroy({ where: {} });
  await Booking.destroy({ where: {} });

  // Marketplace rows for *testflow* coaches only. Do NOT wipe demo coach_profiles —
  // otherwise GET /api/coaches (student discovery) returns empty after this seed.
  if (testIds.length > 0) {
    await Lesson.destroy({ where: { coach_id: { [Op.in]: testIds } } });
    await CoachAvailability.destroy({ where: { coach_id: { [Op.in]: testIds } } });
    await CoachCourtLocation.destroy({ where: { coach_id: { [Op.in]: testIds } } });
    await CoachProfile.destroy({ where: { user_id: { [Op.in]: testIds } } });
    await CourtLocation.destroy({ where: { created_by_user_id: { [Op.in]: testIds } } });
    await UserReliability.destroy({ where: { user_id: { [Op.in]: testIds } } });
    await UserRole.destroy({ where: { user_id: { [Op.in]: testIds } } });
    await User.destroy({ where: { id: { [Op.in]: testIds } } });
  }

  console.log('Wipe complete.');
}

/**
 * Demo seed coaches can be left without profiles if an older test-flow wipe
 * deleted every coach_profiles row. Recreate bare profiles so student search works.
 */
async function ensureOrphanCoachProfiles() {
  const coaches = await User.findAll({
    where: { is_active: true, deleted_at: null },
    include: [
      { model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true, attributes: ['role'] },
      { model: CoachProfile, as: 'coachProfile', required: false },
    ],
  });

  let created = 0;
  for (const coach of coaches) {
    if (coach.coachProfile) continue;
    await CoachProfile.create({
      user_id: coach.id,
      headline: `${coach.full_name} — Pickleball Coach`,
      bio: 'Profile restored for marketplace discovery after test-flow reseed.',
      experience_years: 3,
      skill_rating: 3.5,
      rating_system: 'self',
      rating_average: 4.5,
      rating_count: 0,
      location: 'New York',
      coach_commission_percent: 92.0,
      stripe_account_id: `acct_restored_${coach.id}`,
      stripe_ready: true,
      stripe_onboarding_completed_at: new Date(),
    });
    created += 1;
  }
  if (created > 0) {
    console.log(`Restored ${created} missing coach profile(s) for marketplace discovery.`);
  }
}

async function createUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, PASSWORD_HASH_ROUNDS);
  const verifiedAt = new Date();

  const admin = await User.create({
    full_name: 'Test Flow Admin',
    email: `admin.testflow@${TEST_EMAIL_DOMAIN}`,
    password_hash: passwordHash,
    phone: '555-9001',
    timezone: 'America/New_York',
    is_active: true,
    email_verified_at: verifiedAt,
  });
  await UserRole.create({ user_id: admin.id, role: 'admin' });

  const coach = await User.create({
    full_name: 'Test Flow Coach',
    email: `coach.testflow@${TEST_EMAIL_DOMAIN}`,
    password_hash: passwordHash,
    phone: '555-9002',
    timezone: 'America/New_York',
    is_active: true,
    email_verified_at: verifiedAt,
  });
  await UserRole.create({ user_id: coach.id, role: 'coach' });

  const student = await User.create({
    full_name: 'Test Flow Student',
    email: `student.testflow@${TEST_EMAIL_DOMAIN}`,
    password_hash: passwordHash,
    phone: '555-9003',
    timezone: 'America/New_York',
    is_active: true,
    email_verified_at: verifiedAt,
  });
  await UserRole.create({ user_id: student.id, role: 'student' });

  return { admin, coach, student };
}

async function createCoachStack(coach) {
  await CoachProfile.create({
    user_id: coach.id,
    headline: 'Test Flow Coach Pro',
    bio: 'Seeded coach for endpoint testing. Skill 4.0, NY-based.',
    experience_years: 6,
    skill_rating: 4.0,
    rating_system: 'self',
    rating_average: 4.7,
    rating_count: 12,
    location: 'New York',
    coach_commission_percent: 92.0,
    stripe_account_id: 'acct_testflow_seed',
    stripe_ready: true,
    stripe_onboarding_completed_at: new Date(),
  });

  const court = await CourtLocation.create({
    name: 'Test Flow Court',
    address_line1: '1 Pickleball Lane',
    city: 'New York',
    state: 'NY',
    postal_code: '10001',
    country: 'US',
    latitude: 40.7128,
    longitude: -74.006,
    is_private: false,
    source: 'manual',
    created_by_user_id: coach.id,
  });

  await CoachCourtLocation.create({
    coach_id: coach.id,
    court_id: court.id,
  });

  // Recurring weekday windows (no stored datetimes); bookings use coach timezone + weekday.
  for (let weekday = 1; weekday <= 5; weekday++) {
    await CoachAvailability.create({
      coach_id: coach.id,
      weekday,
      start_time: '09:00:00',
      end_time: '17:00:00',
    });
  }

  const lesson = await Lesson.create({
    coach_id: coach.id,
    title: 'Test Flow Lesson',
    description: 'Seed lesson — pickleball fundamentals.',
    price: 80,
    duration_minutes: 60,
    max_students: 1,
    is_active: true,
  });

  return { court, lesson };
}

/**
 * Create a payment row with no Stripe identifiers (`charge_id` / `payment_intent_id` null).
 * Controllers skip Stripe when there is no charge; `payoutWorker` can still see
 * `escrow_status: held` + `payment_status: captured` for student_no_show (actual
 * transfer still requires Stripe + Connect).
 */
async function createNoStripePayment(booking, { paymentStatus = 'captured', escrowStatus = 'held' } = {}) {
  const price = Number(booking.price);
  return Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: booking.primary_student_id,
    lesson_price: price.toFixed(2),
    platform_fee_percent: 8.0,
    platform_fee_amount: ((price * 8) / 100).toFixed(2),
    total_charge_to_student: Number(price).toFixed(2),
    coach_payout_expected: ((price * 92) / 100).toFixed(2),
    escrow_status: escrowStatus,
    payment_status: paymentStatus,
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: null,
    charge_id: null,
  });
}

async function createBookings({ coach, student, lesson, court }) {
  const now = Date.now();
  const out = {};

  // 1) Legacy pending booking (authorized label, no Stripe PI) — cancel-only offline testing.
  //    For accept/decline with authorize-first shape, run: npm run seed:booking-action-tests
  out.pending_future = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: new Date(now + 5 * dayMs),
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'pending',
    payout_status: 'none',
    messaging_locked: true,
    idempotency_key: idemKey('pending_future'),
  });
  await createNoStripePayment(out.pending_future, { paymentStatus: 'authorized' });

  // 2) Confirmed future booking — cancel with payment row but no Stripe linkage
  out.confirmed_future = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: new Date(now + 7 * dayMs),
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'confirmed',
    payout_status: 'none',
    messaging_locked: false,
    idempotency_key: idemKey('confirmed_future'),
  });
  await createNoStripePayment(out.confirmed_future);

  // 3) Confirmed booking starting in 12h — late-cancel split path (50/50 student)
  const lateScheduled = new Date(now + 12 * 60 * minMs);
  out.confirmed_late_cancel = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: lateScheduled,
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'confirmed',
    payout_status: 'none',
    messaging_locked: false,
    idempotency_key: idemKey('confirmed_late_cancel'),
  });
  await createNoStripePayment(out.confirmed_late_cancel);

  // 4) Awaiting verification (lesson ended ~30m ago) — create dispute target
  const end4 = new Date(now - 30 * minMs);
  const sched4 = new Date(end4.getTime() - lesson.duration_minutes * minMs);
  out.awaiting_for_dispute = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: sched4,
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'awaiting_verification',
    payout_status: 'awaiting_verification',
    messaging_locked: false,
    idempotency_key: idemKey('awaiting_for_dispute'),
  });
  await createNoStripePayment(out.awaiting_for_dispute);

  // 5) Confirmed lesson ended 1h ago — coach/admin marks student no-show.
  // Payment row: captured + held + no charge_id (realistic "money in DB, Stripe not wired").
  const end5 = new Date(now - 60 * minMs);
  const sched5 = new Date(end5.getTime() - lesson.duration_minutes * minMs);
  out.confirmed_for_student_no_show = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: sched5,
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'confirmed',
    payout_status: 'none',
    messaging_locked: false,
    idempotency_key: idemKey('confirmed_for_student_no_show'),
  });
  await createNoStripePayment(out.confirmed_for_student_no_show);

  // 6) Confirmed lesson ended ~75m ago — admin marks coach no-show.
  // Payment exists with no charge_id so the auto-refund path skips Stripe with
  // reason `charge_missing` (`auto_refund.status: skipped` in the response).
  const end6 = new Date(now - 75 * minMs);
  const sched6 = new Date(end6.getTime() - lesson.duration_minutes * minMs);
  out.confirmed_for_coach_no_show = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: sched6,
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'confirmed',
    payout_status: 'none',
    messaging_locked: false,
    idempotency_key: idemKey('confirmed_for_coach_no_show'),
  });
  await createNoStripePayment(out.confirmed_for_coach_no_show);

  // 7) Completed (lesson ended yesterday) — admin refund target.
  // Without Stripe this returns 400 "Payment has no Stripe charge to refund"
  // (validates the controller is wired up). With Stripe + a real charge it
  // would queue a `payment_action`.
  const end7 = new Date(now - dayMs);
  const sched7 = new Date(end7.getTime() - lesson.duration_minutes * minMs);
  out.completed_for_refund = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: sched7,
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'completed',
    payout_status: 'pending',
    messaging_locked: false,
    idempotency_key: idemKey('completed_for_refund'),
  });
  await createNoStripePayment(out.completed_for_refund, { escrowStatus: 'held' });

  // 8) Disputed (attendance) — booking with an OPEN coach_no_show_claim dispute.
  // Reject path: decision=rejected + outcome=student_no_show + financial_action=no_change (Stripe-free).
  // Rejecting student_no_show_claim with outcome coach_no_show requires refund_student|partial (Stripe charge needed).
  const end8 = new Date(now - 2 * dayMs);
  const sched8 = new Date(end8.getTime() - lesson.duration_minutes * minMs);
  out.disputed_attendance = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: sched8,
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'disputed',
    payout_status: 'none',
    messaging_locked: true,
    idempotency_key: idemKey('disputed_attendance'),
  });
  await createNoStripePayment(out.disputed_attendance);

  // 9) Disputed (behavior) — booking with an OPEN misconduct dispute.
  // Resolve with decision=upheld, penalize_role=coach, financial_action=no_change.
  const end9 = new Date(now - 3 * dayMs);
  const sched9 = new Date(end9.getTime() - lesson.duration_minutes * minMs);
  out.disputed_behavior = await Booking.create({
    lesson_id: lesson.id,
    coach_id: coach.id,
    primary_student_id: student.id,
    scheduled_at: sched9,
    duration_minutes: lesson.duration_minutes,
    price: lesson.price,
    court_location_id: court.id,
    status: 'disputed',
    payout_status: 'none',
    messaging_locked: true,
    idempotency_key: idemKey('disputed_behavior'),
  });
  await createNoStripePayment(out.disputed_behavior);

  return out;
}

async function createOpenDisputes(bookings) {
  const attendanceType = await DisputeType.findOne({ where: { code: 'coach_no_show_claim' } });
  const behaviorType = await DisputeType.findOne({ where: { code: 'misconduct' } });

  const attendanceDispute = await Dispute.create({
    booking_id: bookings.disputed_attendance.id,
    dispute_type_id: attendanceType.id,
    notes: 'Coach did not show up to the scheduled lesson.',
    opened_by: 'student',
    status: 'open',
  });

  const behaviorDispute = await Dispute.create({
    booking_id: bookings.disputed_behavior.id,
    dispute_type_id: behaviorType.id,
    notes: 'Coach behaved unprofessionally during the lesson.',
    opened_by: 'student',
    status: 'open',
  });

  return { attendanceDispute, behaviorDispute, attendanceType, behaviorType };
}

function summarize({ users, lesson, court, bookings, disputes }) {
  const fmt = (b) => ({
    id: b.id,
    status: b.status,
    payout_status: b.payout_status,
    scheduled_at: new Date(b.scheduled_at).toISOString(),
  });

  return {
    credentials: {
      admin: { id: users.admin.id, email: users.admin.email, password: PASSWORD },
      coach: { id: users.coach.id, email: users.coach.email, password: PASSWORD },
      student: { id: users.student.id, email: users.student.email, password: PASSWORD },
    },
    lesson: { id: lesson.id, price: Number(lesson.price), duration_minutes: lesson.duration_minutes },
    court: { id: court.id, name: court.name },
    bookings: Object.fromEntries(Object.entries(bookings).map(([k, v]) => [k, fmt(v)])),
    disputes: {
      attendance: {
        id: disputes.attendanceDispute.id,
        booking_id: disputes.attendanceDispute.booking_id,
        type_code: disputes.attendanceType.code,
        type_id: disputes.attendanceType.id,
      },
      behavior: {
        id: disputes.behaviorDispute.id,
        booking_id: disputes.behaviorDispute.booking_id,
        type_code: disputes.behaviorType.code,
        type_id: disputes.behaviorType.id,
      },
    },
  };
}

function printEndpointPlaybook(summary) {
  const b = summary.bookings;
  const d = summary.disputes;

  console.log('\nEndpoint playbook (use one of the seeded bookings per scenario):');
  console.log(
    'For PUT .../accept, PUT .../decline, and pending cancel with dev Stripe stubs, run:\n  npm run seed:booking-action-tests\n',
  );
  console.log(
    JSON.stringify(
      {
        cancel_booking: {
          endpoint: 'POST /api/bookings/:id/cancel',
          stripe_required: false,
          try_with: {
            student_pre_lesson: { booking_id: b.pending_future.id, body: { reason: 'schedule_conflict' } },
            note: 'For pending cancel with PI void (authorize-first), use seed:booking-action-tests pending_for_cancel',
            student_full_refund: { booking_id: b.confirmed_future.id, body: { reason: 'sickness' } },
            student_late_cancel_50_50: {
              booking_id: b.confirmed_late_cancel.id,
              body: { reason: 'forgot' },
            },
          },
        },
        create_dispute: {
          endpoint: 'POST /api/disputes',
          stripe_required: false,
          try_with: {
            student_opens_coach_no_show_claim: {
              booking_id: b.awaiting_for_dispute.id,
              body: {
                booking_id: b.awaiting_for_dispute.id,
                dispute_type_id: 1,
                notes: 'Coach never showed up.',
              },
            },
          },
        },
        mark_student_no_show_coach_route: {
          endpoint: 'POST /api/bookings/:id/student-no-show',
          stripe_required: false,
          notes:
            'Booking has a payments row (captured, escrow held, charge_id null). Matches production: payoutWorker can see payable state after status becomes student_no_show; actual transfer still needs Stripe + coach Connect.',
          try_with: {
            coach_marks_student_no_show: {
              booking_id: b.confirmed_for_student_no_show.id,
              body: { notes: 'Student did not arrive.' },
            },
          },
        },
        mark_student_no_show_admin_route: {
          endpoint: 'POST /api/admin/bookings/:id/student-no-show',
          stripe_required: false,
          note: 'Same target works for admin override; reseed if you used it for the coach route.',
          try_with: {
            admin_marks_student_no_show: {
              booking_id: b.confirmed_for_student_no_show.id,
              body: { notes: 'Admin override.' },
            },
          },
        },
        mark_coach_no_show: {
          endpoint: 'POST /api/admin/bookings/:id/coach-no-show',
          stripe_required: false,
          notes:
            'Auto refund is queued only when the payment has a Stripe charge_id. With seeded payments (charge_id=null) the response will include `auto_refund.status: skipped` with reason `charge_missing`.',
          try_with: {
            admin_marks_coach_no_show: {
              booking_id: b.confirmed_for_coach_no_show.id,
              body: { notes: 'Coach failed to attend.' },
            },
          },
        },
        admin_refund_booking: {
          endpoint: 'POST /api/admin/bookings/:id/refund',
          stripe_required: true,
          notes:
            'Without STRIPE_SECRET_KEY this returns 400 "Payment has no Stripe charge to refund" because seeded payments intentionally have charge_id=null. Validates the endpoint is wired up; full execution requires a real Stripe charge.',
          try_with: {
            admin_full_refund: {
              booking_id: b.completed_for_refund.id,
              body: { reason: 'requested_by_customer', reason_notes: 'Service issue.' },
            },
            admin_partial_refund: {
              booking_id: b.completed_for_refund.id,
              body: { refund_amount: 25, reason: 'requested_by_customer' },
            },
          },
        },
        resolve_dispute_attendance: {
          endpoint: 'PUT /api/disputes/:id/resolve',
          stripe_required: false,
          notes:
            'reject_attendance_claim: coach_no_show_claim + rejected requires outcome student_no_show and financial_action no_change (student at fault; no refund). uphold_coach_no_show uses refund_student: without a real Stripe charge on the payment the API returns 400 from the refund planner.',
          try_with: {
            uphold_coach_no_show: {
              dispute_id: d.attendance.id,
              body: {
                decision: 'upheld',
                outcome: 'coach_no_show',
                financial_action: 'refund_student',
                resolution_notes: 'Coach confirmed absent; refund student per policy.',
              },
            },
            reject_attendance_claim: {
              dispute_id: d.attendance.id,
              body: {
                decision: 'rejected',
                outcome: 'student_no_show',
                financial_action: 'no_change',
                resolution_notes: 'Insufficient evidence for coach no-show; student no-show recorded.',
              },
            },
          },
        },
        resolve_dispute_behavior: {
          endpoint: 'PUT /api/disputes/:id/resolve',
          stripe_required: false,
          try_with: {
            uphold_misconduct_penalize_coach: {
              dispute_id: d.behavior.id,
              body: {
                decision: 'upheld',
                penalize_role: 'coach',
                financial_action: 'no_change',
                resolution_notes: 'Coach conduct was inappropriate.',
              },
            },
          },
        },
      },
      null,
      2,
    ),
  );
}

async function main() {
  try {
    await sequelize.authenticate();
    await checkReferenceData();
    await wipe();

    const users = await createUsers();
    const { court, lesson } = await createCoachStack(users.coach);
    await ensureOrphanCoachProfiles();
    const bookings = await createBookings({
      coach: users.coach,
      student: users.student,
      lesson,
      court,
    });
    const disputes = await createOpenDisputes(bookings);

    const summary = summarize({ users, lesson, court, bookings, disputes });
    console.log('\nSeed summary:');
    console.log(JSON.stringify(summary, null, 2));
    printEndpointPlaybook(summary);

    console.log('\nDone. Login any of the test users and exercise the endpoints above.');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

main();
