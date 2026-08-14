import {
  sequelize,
  Booking,
  Lesson,
  User,
  UserRole,
  Payment,
  CourtLocation,
  CoachCourtLocation,
  CoachProfile,
} from '../models/index.js';
import * as stripeService from './stripeService.js';
import { checkBookingAvailability } from './bookingService.js';
import {
  calculatePaymentAmounts,
  calculatePaymentAmountsFromAuthorizedTotalCents,
  MIN_LESSON_PRICE_USD,
  dollarsToCents,
  normalizeStripeCurrencyCents,
} from './paymentEngine.js';
import { MIN_CHARGE_USD } from './paymentConstants.js';
import { createAuditLog } from '../utils/audit.js';
import { logger } from '../config/logger.js';
import * as notificationService from './notificationService.js';
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';
import {
  buildBookingIntentStripeMetadata,
  isPaymentIntentAuthorizedForBookingConfirm,
  parseBookingIntentMetadata,
  SLOT_NO_LONGER_AVAILABLE_CODE,
} from '../utils/bookingIntentContract.js';
import { COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY } from '../utils/paymentAuthorizationGate.js';
import { isPubliclyActiveUser } from '../utils/userLifecycle.js';
import { escrowForUncapturedAuthorization } from '../utils/paymentEscrowStatus.js';

async function ensureStripeCustomer(student, transaction = null) {
  let stripeCustomerId = student.stripe_customer_id || null;
  if (stripeCustomerId) return stripeCustomerId;
  const customer = await stripeService.createCustomer({
    email: student.email,
    name: student.full_name,
    metadata: { user_id: String(student.id) },
  });
  stripeCustomerId = customer.id;
  await student.update(
    { stripe_customer_id: stripeCustomerId },
    transaction ? { transaction } : {},
  );
  return stripeCustomerId;
}

/**
 * Shared validation for booking intent + confirm (lesson, roles, court, schedule).
 * Duration always comes from the lesson package (not a student override).
 * Court is required for MVP (one of the coach's linked courts).
 */
export async function validateBookingRequestContext({
  studentId,
  studentRoles,
  lessonId,
  scheduledAt,
  courtLocationId,
}) {
  const lesson = await Lesson.findByPk(lessonId);
  if (!lesson || !lesson.is_active) {
    return { ok: false, status: 404, message: 'Lesson not found or inactive' };
  }
  if (!studentRoles.includes('student')) {
    return { ok: false, status: 403, message: 'Only users with the student role can create bookings' };
  }
  const lessonCoachUser = await User.findByPk(lesson.coach_id, {
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  const lessonCoachEffective = getEffectiveRolesForUserRecord(lessonCoachUser);
  if (!lessonCoachUser || !lessonCoachEffective.includes('coach')) {
    return { ok: false, status: 400, message: 'Lesson coach account is not a valid coach' };
  }
  if (!isPubliclyActiveUser(lessonCoachUser)) {
    return { ok: false, status: 404, message: 'Lesson not found or inactive' };
  }
  const coachProfile = await CoachProfile.findOne({
    where: { user_id: lesson.coach_id, deleted_at: null },
  });
  if (!coachProfile) {
    return { ok: false, status: 400, message: 'Coach profile is not available for booking' };
  }
  if (!coachProfile.stripe_ready) {
    return {
      ok: false,
      status: 400,
      message: 'This coach is not yet available for booking (payments setup incomplete)',
      code: 'coach_not_marketplace_ready',
    };
  }
  if (lesson.coach_id === studentId) {
    return {
      ok: false,
      status: 400,
      message: 'You cannot book your own lesson. Coach and student must be different users.',
    };
  }
  const scheduledDate = new Date(scheduledAt);
  if (Number.isNaN(scheduledDate.getTime()) || scheduledDate < new Date()) {
    return { ok: false, status: 400, message: 'Cannot book in the past' };
  }
  if (courtLocationId == null) {
    return {
      ok: false,
      status: 400,
      message: 'court_location_id is required — choose one of the coach\'s courts.',
      code: 'court_required',
    };
  }
  const court = await CourtLocation.findByPk(courtLocationId);
  if (!court || court.deleted_at) {
    return { ok: false, status: 404, message: 'Court location not found' };
  }
  const coachCourtLink = await CoachCourtLocation.findOne({
    where: { coach_id: lesson.coach_id, court_id: courtLocationId },
  });
  if (!coachCourtLink) {
    return {
      ok: false,
      status: 400,
      message: 'Selected court is not available for this coach',
      code: 'court_not_linked_to_coach',
    };
  }
  const finalDuration = lesson.duration_minutes;
  const availabilityCheck = await checkBookingAvailability(
    lessonId,
    scheduledDate.toISOString(),
    finalDuration,
  );
  if (!availabilityCheck.available) {
    return {
      ok: false,
      status: 400,
      message: availabilityCheck.reason || 'This time slot is no longer available.',
      code: SLOT_NO_LONGER_AVAILABLE_CODE,
    };
  }
  return {
    ok: true,
    lesson,
    scheduledDate,
    finalDuration,
    courtLocationId: Number(courtLocationId),
    coachId: lesson.coach_id,
  };
}

/**
 * Create Stripe PaymentIntent for authorize-first flow (no booking row).
 */
export async function createBookingIntent({
  studentId,
  studentRoles,
  lessonId,
  scheduledAt,
  courtLocationId,
  paymentMethod = 'stripe',
  paymentMethodId = null,
  idempotencyKey,
}) {
  const ctx = await validateBookingRequestContext({
    studentId,
    studentRoles,
    lessonId,
    scheduledAt,
    courtLocationId,
  });
  if (!ctx.ok) {
    const err = new Error(ctx.message);
    err.statusCode = ctx.status;
    err.code = ctx.code;
    throw err;
  }

  const { lesson, scheduledDate, finalDuration, courtLocationId: validatedCourtId } = ctx;
  const amounts = calculatePaymentAmounts(lesson.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  if (totalCharge < MIN_CHARGE_USD) {
    throw new Error(
      `Lesson price is too low to book. Payment is required for all bookings (minimum charge $${MIN_CHARGE_USD} USD).`,
    );
  }

  const student = await User.findByPk(studentId);
  if (!student) throw new Error(`Student not found: ${studentId}`);
  const stripeCustomerId = await ensureStripeCustomer(student);

  const metadata = buildBookingIntentStripeMetadata({
    studentId,
    lessonId: lesson.id,
    coachId: lesson.coach_id,
    scheduledAt: scheduledDate,
    durationMinutes: finalDuration,
    courtLocationId: validatedCourtId,
    idempotencyKey,
    paymentMethod,
  });

  const paymentIntent = await stripeService.createPaymentIntent(
    totalCharge,
    'usd',
    stripeCustomerId,
    metadata,
    {
      captureMethod: 'manual',
      paymentMethodId,
      idempotencyKey: idempotencyKey ? `intent_${idempotencyKey}` : undefined,
    },
  );

  return {
    client_secret: paymentIntent.client_secret,
    payment_intent_id: paymentIntent.id,
    lesson_id: lesson.id,
    scheduled_at: scheduledDate.toISOString(),
    duration_minutes: finalDuration,
    court_location_id: validatedCourtId,
    /** Total charge to student in USD dollars (listed lesson price; e.g. 50 for a $50 lesson). */
    amount: totalCharge,
    /** Same amount in Stripe's smallest currency unit (cents for USD). */
    amount_cents: dollarsToCents(totalCharge),
    currency: 'usd',
  };
}

/**
 * Confirm booking after client-side authorization. Idempotent per payment_intent_id.
 */
export async function confirmBookingFromPaymentIntent({ studentId, paymentIntentId }) {
  const existingPayment = await Payment.findOne({
    where: { payment_intent_id: paymentIntentId },
    include: [{ model: Booking, as: 'booking' }],
  });
  if (existingPayment?.booking) {
    return {
      booking: existingPayment.booking,
      payment: existingPayment,
      idempotentReplay: true,
    };
  }

  const paymentIntent = await stripeService.getPaymentIntent(paymentIntentId);
  const parsedMeta = parseBookingIntentMetadata(paymentIntent.metadata, studentId);
  if (!parsedMeta.ok) {
    const err = new Error(parsedMeta.message);
    err.statusCode = parsedMeta.code === 'payment_intent_not_owned' ? 403 : 400;
    err.code = parsedMeta.code;
    throw err;
  }

  if (!isPaymentIntentAuthorizedForBookingConfirm(paymentIntent)) {
    const err = new Error(
      'Payment is not authorized for booking confirmation. Complete card authorization before confirming.',
    );
    err.statusCode = 400;
    err.code = 'payment_intent_not_authorized';
    throw err;
  }

  if (parsedMeta.idempotencyKey) {
    const existingBooking = await Booking.findOne({
      where: {
        idempotency_key: parsedMeta.idempotencyKey,
        primary_student_id: studentId,
      },
    });
    if (existingBooking) {
      const pay = await Payment.findOne({
        where: { booking_id: existingBooking.id },
        order: [['id', 'DESC']],
      });
      return { booking: existingBooking, payment: pay, idempotentReplay: true };
    }
  }

  const lesson = await Lesson.findByPk(parsedMeta.lessonId);
  if (!lesson || !lesson.is_active) {
    const err = new Error('Lesson not found or inactive');
    err.statusCode = 404;
    throw err;
  }

  if (parsedMeta.courtLocationId == null) {
    const err = new Error('PaymentIntent is missing court_location_id.');
    err.statusCode = 400;
    err.code = 'payment_intent_invalid_metadata';
    throw err;
  }

  // Duration always from the lesson package (ignore any stale metadata override)
  const finalDuration = lesson.duration_minutes;

  // Money snapshot from Stripe authorization — never recompute from current lesson.price.
  const authorizedCents = normalizeStripeCurrencyCents(
    paymentIntent.amount_capturable ?? paymentIntent.amount,
  );
  if (authorizedCents < 1) {
    const err = new Error(
      'Payment is not authorized for booking confirmation. Complete card authorization before confirming.',
    );
    err.statusCode = 400;
    err.code = 'payment_intent_not_authorized';
    throw err;
  }
  const amounts = calculatePaymentAmountsFromAuthorizedTotalCents(authorizedCents);

  const transaction = await sequelize.transaction();
  let booking;
  let payment;

  try {
    // Serialize concurrent confirms for this coach (empty overlap set alone cannot lock a slot).
    const coachProfile = await CoachProfile.findOne({
      where: { user_id: lesson.coach_id, deleted_at: null },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!coachProfile) {
      const err = new Error('Coach profile is not available for booking');
      err.statusCode = 400;
      throw err;
    }

    const court = await CourtLocation.findByPk(parsedMeta.courtLocationId, { transaction });
    if (!court || court.deleted_at) {
      const err = new Error('Court location not found');
      err.statusCode = 404;
      throw err;
    }
    const coachCourtLink = await CoachCourtLocation.findOne({
      where: { coach_id: lesson.coach_id, court_id: parsedMeta.courtLocationId },
      transaction,
    });
    if (!coachCourtLink) {
      const err = new Error('Selected court is not available for this coach');
      err.statusCode = 400;
      err.code = 'court_not_linked_to_coach';
      throw err;
    }

    const availabilityCheck = await checkBookingAvailability(
      lesson.id,
      parsedMeta.scheduledAt.toISOString(),
      finalDuration,
      { transaction, coachId: lesson.coach_id },
    );

    if (!availabilityCheck.available) {
      await transaction.rollback();
      try {
        await stripeService.cancelPaymentIntent(paymentIntentId);
      } catch (cancelErr) {
        logger.warn({
          component: 'booking',
          event: 'confirm_slot_unavailable_pi_cancel_failed',
          paymentIntentId,
          message: cancelErr?.message || String(cancelErr),
        });
      }
      const err = new Error(
        availabilityCheck.reason || 'This time slot is no longer available.',
      );
      err.statusCode = 409;
      err.code = SLOT_NO_LONGER_AVAILABLE_CODE;
      throw err;
    }

    booking = await Booking.create(
      {
        lesson_id: lesson.id,
        coach_id: lesson.coach_id,
        primary_student_id: studentId,
        idempotency_key: parsedMeta.idempotencyKey || `pi_${paymentIntentId}`,
        scheduled_at: parsedMeta.scheduledAt,
        duration_minutes: finalDuration,
        price: amounts.lesson_price,
        court_location_id: parsedMeta.courtLocationId,
        status: 'pending',
      },
      { transaction },
    );

    payment = await Payment.create(
      {
        booking_id: booking.id,
        coach_id: lesson.coach_id,
        student_id: studentId,
        lesson_price: amounts.lesson_price,
        platform_fee_percent: amounts.platform_fee_percent,
        platform_fee_amount: amounts.platform_fee_amount,
        total_charge_to_student: amounts.total_charge_to_student,
        coach_payout_expected: amounts.coach_payout_expected,
        escrow_status: escrowForUncapturedAuthorization(),
        payment_status: 'authorized',
        refund_status: 'none',
        payment_method: parsedMeta.paymentMethod,
        currency: 'USD',
        payment_intent_id: paymentIntentId,
        metadata: {
          capture_on_accept: true,
          authorization_succeeded_at: new Date().toISOString(),
          flow: 'authorize_then_book',
          authorized_amount_cents: authorizedCents,
          // Confirm owns coach notify; webhook must not send a second booking_request_coach.
          [COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY]: true,
          coach_booking_request_notified_at: new Date().toISOString(),
        },
      },
      { transaction },
    );

    await createAuditLog({
      user_id: studentId,
      action: 'booking_confirmed_after_authorization',
      table_name: 'bookings',
      record_id: booking.id,
      after_state: {
        payment_intent_id: paymentIntentId,
        payment_status: 'authorized',
        authorized_amount_cents: authorizedCents,
      },
    });

    await transaction.commit();
  } catch (txErr) {
    if (!transaction.finished) {
      await transaction.rollback();
    }
    if (txErr?.name === 'SequelizeUniqueConstraintError') {
      const racedPayment = await Payment.findOne({
        where: { payment_intent_id: paymentIntentId },
        include: [{ model: Booking, as: 'booking' }],
      });
      if (racedPayment?.booking) {
        return {
          booking: racedPayment.booking,
          payment: racedPayment,
          idempotentReplay: true,
        };
      }
    }
    throw txErr;
  }

  void notificationService.notifyCoachNewBookingRequest(booking.id).catch((err) => {
    logger.warn({
      component: 'booking',
      event: 'notify_coach_after_confirm_failed',
      bookingId: booking.id,
      message: err?.message || String(err),
    });
  });

  return { booking, payment, idempotentReplay: false };
}
