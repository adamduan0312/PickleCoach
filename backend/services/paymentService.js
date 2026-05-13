import {
  Payment,
  PaymentAction,
  Booking,
  Payout,
  User,
  UserRole,
  CoachProfile,
  CancellationHistory,
  sequelize,
} from '../models/index.js';
import { Op } from 'sequelize';
import * as stripeService from './stripeService.js';
import { logger } from '../config/logger.js';
import { createAuditLog } from '../utils/audit.js';

const PLATFORM_FEE_PERCENT = 8.00;
const COACH_COMMISSION_PERCENT = 92.00; // Coach receives 92% of lesson price
const PAID_RESCHEDULE_FEE = parseFloat(process.env.PAID_RESCHEDULE_FEE || '3.00'); // Default $3

/**
 * Integer cents from decimal dollars string/number.
 * Uses Math.round(n * 100) so float edge cases (e.g. 12.34 * 100) land on whole cents before Stripe.
 */
export const dollarsToCents = (value) => {
  const n = Number.parseFloat(String(value ?? '0'), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

/** DECIMAL(12,2) / API-safe string from integer cents (avoids float artifacts). */
export const centsToDecimalString = (cents) => {
  const c = Math.max(0, Math.round(cents));
  const whole = Math.floor(c / 100);
  const frac = c % 100;
  return `${whole}.${String(frac).padStart(2, '0')}`;
};

/**
 * Policy total for cancellations: always `payment.total_charge_to_student` when a payment row exists;
 * otherwise `booking.price` (never charged / no payment row).
 */
export const parseTotalChargeCentsFromBooking = (payment, booking) => {
  if (payment) {
    const fromPayment = dollarsToCents(payment.total_charge_to_student);
    if (fromPayment > 0) return fromPayment;
  }
  if (booking) {
    return dollarsToCents(booking.price);
  }
  return 0;
};

/**
 * Split cancellation into refund vs penalty in whole cents; invariant refundCents + penaltyCents === totalChargeCents.
 */
export const computeCancellationSplitCents = ({ totalChargeCents, isLateCancel, cancelledBy }) => {
  const t = Math.round(totalChargeCents);
  if (t < 1) {
    return { refundCents: 0, penaltyCents: 0, penaltyReason: null };
  }

  if (isLateCancel && cancelledBy === 'student') {
    const refundCents = Math.floor(t / 2);
    const penaltyCents = t - refundCents;
    return { refundCents, penaltyCents, penaltyReason: 'Late cancellation' };
  }

  if (cancelledBy === 'coach') {
    return { refundCents: t, penaltyCents: 0, penaltyReason: 'Coach cancellation' };
  }

  return { refundCents: t, penaltyCents: 0, penaltyReason: null };
};

/**
 * Cap policy refund by Stripe remaining balance; keeps refundCents + penaltyCents === totalChargeCents.
 */
export const applyStripeRefundCap = ({ policyRefundCents, totalChargeCents, remainingCents }) => {
  const t = Math.round(totalChargeCents);
  const r = Math.max(0, Math.round(remainingCents));
  const policy = Math.min(Math.max(0, Math.round(policyRefundCents)), t);
  const refundCents = Math.min(policy, r);
  const penaltyCents = t - refundCents;
  return { refundCents, penaltyCents, capped: refundCents < policy };
};

/**
 * Calculate payment amounts based on lesson price
 * Platform fee = 8%, Coach receives 92% (platform absorbs Stripe fees in MVP)
 */
export const calculatePaymentAmounts = (lessonPrice) => {
  const platformFeeAmount = (lessonPrice * PLATFORM_FEE_PERCENT) / 100;
  const totalCharge = parseFloat(lessonPrice) + parseFloat(platformFeeAmount);
  // Coach receives 92% of lesson price (platform absorbs Stripe fees)
  const coachPayoutExpected = (lessonPrice * COACH_COMMISSION_PERCENT) / 100;

  return {
    lesson_price: lessonPrice,
    platform_fee_percent: PLATFORM_FEE_PERCENT,
    platform_fee_amount: platformFeeAmount,
    total_charge_to_student: totalCharge,
    coach_payout_expected: coachPayoutExpected,
  };
};

// Stripe minimum charge (USD): $0.50. All bookings require payment; lessons below this are rejected.
const MIN_CHARGE_USD = 0.5;

/** Minimum lesson price (USD) so that total charge to student (price + platform fee) meets MIN_CHARGE_USD. Use for lesson create/update validation. */
export const MIN_LESSON_PRICE_USD = MIN_CHARGE_USD / (1 + PLATFORM_FEE_PERCENT / 100);

/**
 * Create payment and PaymentIntent for a booking.
 * Every booking requires a valid Stripe payment; free lessons are not supported.
 * @param {Object} options.transaction - Optional Sequelize transaction (if provided, booking is rolled back on Stripe failure)
 */
export const createPaymentForBooking = async (booking, studentId, paymentMethod = 'stripe', options = {}) => {
  const { transaction = null } = options;
  const paymentMethodId = options.paymentMethodId || null;
  const idempotencyKey =
    options.idempotencyKey || `booking_${studentId}_${booking.id}`;
  const amounts = calculatePaymentAmounts(booking.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;

  if (totalCharge < MIN_CHARGE_USD) {
    throw new Error(
      `Lesson price is too low to book. Payment is required for all bookings (minimum charge $${MIN_CHARGE_USD} USD).`
    );
  }

  const createOptions = transaction ? { transaction } : {};

  const student = await User.findByPk(studentId, createOptions);
  if (!student) {
    throw new Error(`Student not found: ${studentId}`);
  }
  let stripeCustomerId = student.stripe_customer_id || null;
  if (!stripeCustomerId) {
    const customer = await stripeService.createCustomer({
      email: student.email,
      name: student.full_name,
      metadata: { user_id: String(student.id) },
    });
    stripeCustomerId = customer.id;
    await student.update({ stripe_customer_id: stripeCustomerId }, createOptions);
  }

  // Coach-must-confirm: use manual capture so we only charge when coach accepts
  const captureOnAccept = true;
  const paymentFindOptions = {
    where: {
      booking_id: booking.id,
      student_id: studentId,
      payment_method: paymentMethod,
      payment_status: { [Op.in]: ['pending', 'pending_capture', 'captured', 'partially_refunded'] },
    },
    order: [['id', 'DESC']],
  };
  if (transaction) {
    paymentFindOptions.transaction = transaction;
    paymentFindOptions.lock = transaction.LOCK.UPDATE;
  }

  const existingPayment = await Payment.findOne(paymentFindOptions);
  if (existingPayment?.payment_intent_id) {
    const existingPaymentIntent = await stripeService.getPaymentIntent(existingPayment.payment_intent_id);
    return {
      payment: existingPayment,
      paymentIntent: {
        id: existingPaymentIntent.id,
        client_secret: existingPaymentIntent.client_secret,
        amount: existingPaymentIntent.amount,
        currency: existingPaymentIntent.currency,
        status: existingPaymentIntent.status,
      },
    };
  }

  // Create payment record (always pending until coach accepts and we capture)
  const payment = existingPayment || await Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: studentId,
    lesson_price: amounts.lesson_price,
    platform_fee_percent: amounts.platform_fee_percent,
    platform_fee_amount: amounts.platform_fee_amount,
    total_charge_to_student: amounts.total_charge_to_student,
    coach_payout_expected: amounts.coach_payout_expected,
    escrow_status: 'held',
    payment_status: 'pending',
    refund_status: 'none',
    payment_method: paymentMethod,
    currency: 'USD',
    metadata: {
      booking_id: booking.id,
      lesson_id: booking.lesson_id,
      capture_on_accept: captureOnAccept,
    },
  }, createOptions);

  const paymentIntent = await stripeService.createPaymentIntent(
    totalCharge,
    'usd',
    stripeCustomerId,
    {
      booking_id: booking.id.toString(),
      payment_id: payment.id.toString(),
      coach_id: booking.coach_id.toString(),
      student_id: studentId.toString(),
    },
    {
      captureMethod: captureOnAccept ? 'manual' : 'automatic',
      paymentMethodId,
      idempotencyKey,
    }
  );

  await payment.update(
    { payment_intent_id: paymentIntent.id },
    transaction ? { transaction } : {}
  );

  await createAuditLog({
    user_id: studentId,
    action: 'payment_created',
    table_name: 'payments',
    record_id: payment.id,
    after_state: { payment_intent_id: paymentIntent.id, amount: amounts.total_charge_to_student },
  });

  return {
    payment,
    paymentIntent: {
      id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
    },
  };
};

/**
 * Handle successful payment capture (from webhook)
 */
export const handlePaymentCapture = async (paymentIntentId, chargeId) => {
  const { RescheduleHistory, Booking, User } = await import('../models/index.js');
  const { updateUserReliability } = await import('./reliabilityService.js');
  const { logAudit } = await import('../utils/audit.js');

  const payment = await Payment.findOne({
    where: { payment_intent_id: paymentIntentId },
    include: [{ model: Booking, as: 'booking' }],
  });

  if (!payment) {
    throw new Error(`Payment not found for PaymentIntent ${paymentIntentId}`);
  }

  // Coach-must-confirm: student has authorized; we don't capture until coach accepts
  const captureOnAccept = payment.metadata?.capture_on_accept === true;
  if (captureOnAccept) {
    /** Coach accept triggers capture API; webhook payment_intent.succeeded finalizes captured + booking. */
    await payment.update({
      charge_id: chargeId,
      payment_status: 'captured',
      escrow_status: 'held',
    });
    if (payment.booking && payment.booking.status === 'pending') {
      await payment.booking.update({
        messaging_locked: false,
        status: 'confirmed',
      });
    }
    await createAuditLog({
      user_id: payment.student_id,
      action: 'payment_captured',
      table_name: 'payments',
      record_id: payment.id,
      after_state: { charge_id: chargeId, payment_status: 'captured', source: 'stripe_webhook' },
    });
    return payment;
  }

  // Standard capture (paid reschedule or automatic capture)
  await payment.update({
    payment_status: 'captured',
    charge_id: chargeId,
    escrow_status: 'held',
  });

  // Check if this is a paid reschedule payment
  const isPaidReschedule = payment.metadata?.type === 'paid_reschedule';
  
  if (isPaidReschedule && payment.metadata?.reschedule_history_id) {
    // Apply the paid reschedule after payment succeeds
    const rescheduleHistoryId = parseInt(payment.metadata.reschedule_history_id);
    const rescheduleHistory = await RescheduleHistory.findByPk(rescheduleHistoryId, {
      include: [{ model: Booking, as: 'booking' }],
    });

    if (rescheduleHistory && rescheduleHistory.booking) {
      const booking = rescheduleHistory.booking;

      // SAFEGUARD: Only apply if reschedule is still pending (prevents double-application)
      if (rescheduleHistory.approval_status !== 'pending') {
        logger.warn(`Reschedule ${rescheduleHistory.id} already processed (status: ${rescheduleHistory.approval_status}), skipping application`);
        return payment;
      }

      // Apply the reschedule
      // IMPORTANT: Only update scheduled_at and extra_paid_reschedules
      // DO NOT modify booking.status (e.g., confirmed/completed) to prevent state regressions
      await booking.update({
        scheduled_at: rescheduleHistory.new_scheduled_at,
        extra_paid_reschedules: (booking.extra_paid_reschedules || 0) + 1,
        // Explicitly preserve booking.status - reschedules do NOT change booking status
      });

      // Update reschedule history to approved
      await rescheduleHistory.update({
        approval_status: 'approved',
        approved_at: new Date(),
      });

      // Update reliability if needed
      // SAFEGUARD: Only update reliability once (since we check approval_status above, this ensures single execution)
      if (rescheduleHistory.affects_reliability && rescheduleHistory.requested_by !== 'admin') {
        const userIdToUpdate = rescheduleHistory.requested_by === 'coach' 
          ? booking.coach_id 
          : booking.primary_student_id;
        
        if (userIdToUpdate) {
          const userToUpdate = await User.findByPk(userIdToUpdate, {
            include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
          });
          const updateRoles = userToUpdate?.userRoles?.map((r) => r.role) ?? [];
          if (userToUpdate && !updateRoles.includes('admin')) {
            const reliabilityRole = rescheduleHistory.requested_by === 'coach' ? 'coach' : 'student';
            await updateUserReliability(userIdToUpdate, reliabilityRole).catch((err) => {
              logger.error('Failed to update reliability after paid reschedule:', err);
            });
          }
        }
      }

      await logAudit(
        payment.student_id,
        'paid_reschedule_applied',
        'bookings',
        booking.id,
        { scheduled_at: rescheduleHistory.old_scheduled_at },
        { scheduled_at: rescheduleHistory.new_scheduled_at },
        null
      );

      logger.info(`Paid reschedule applied for booking ${booking.id} after payment ${payment.id} succeeded`);
    }
  } else {
    // Regular booking payment - unlock messaging
    if (payment.booking) {
      await payment.booking.update({
        messaging_locked: false,
        status: 'confirmed',
      });
    }
  }

  await createAuditLog({
    user_id: payment.student_id,
    action: 'payment_captured',
    table_name: 'payments',
    record_id: payment.id,
    after_state: { charge_id: chargeId, status: 'captured' },
  });

  return payment;
};

/**
 * Capture payment and confirm booking when coach accepts (coach-must-confirm flow).
 * Call this from the accept-booking endpoint.
 * @param {number} paymentId - Payment ID for the booking
 * @returns {Promise<{ payment: Object, booking: Object }>}
 */
export const capturePaymentOnCoachAccept = async (paymentId) => {
  const payment = await Payment.findByPk(paymentId, {
    include: [{ model: Booking, as: 'booking' }],
  });
  if (!payment) throw new Error('Payment not found');
  if (!payment.booking) throw new Error('Booking not found');
  if (payment.booking.status !== 'pending') {
    throw new Error(`Booking is not pending (status: ${payment.booking.status})`);
  }

  if (payment.payment_intent_id && payment.payment_status === 'pending') {
    const paymentIntent = await stripeService.capturePaymentIntent(payment.payment_intent_id);
    const chargeId =
      paymentIntent.latest_charge ||
      paymentIntent.charges?.data?.[0]?.id ||
      payment.charge_id;
    const chargeIdStr = typeof chargeId === 'string' ? chargeId : chargeId?.id;
    await payment.update({
      payment_status: 'pending_capture',
      charge_id: chargeIdStr || payment.charge_id,
      escrow_status: 'held',
    });
    await createAuditLog({
      user_id: payment.coach_id,
      action: 'payment_capture_initiated',
      table_name: 'payments',
      record_id: payment.id,
      after_state: {
        charge_id: chargeIdStr,
        payment_status: 'pending_capture',
        note: 'awaiting payment_intent.succeeded webhook',
      },
    });
    logger.info({
      component: 'stripe',
      event: 'capture_initiated_coach_accept',
      paymentId: payment.id,
      bookingId: payment.booking.id,
      paymentIntentId: payment.payment_intent_id,
    });
  }

  /** Booking becomes confirmed only after Stripe reports capture success (webhook). */
  logger.info(
    `Coach accepted booking ${payment.booking.id}, payment ${payment.id}; capture pending webhook if applicable`
  );
  await payment.reload({ include: [{ model: Booking, as: 'booking' }] });
  return { payment, booking: payment.booking };
};

/**
 * Cancel PaymentIntent and booking when coach declines (coach-must-confirm flow).
 * Call this from the decline-booking endpoint.
 * @param {number} paymentId - Payment ID for the booking
 */
export const cancelPaymentOnCoachDecline = async (paymentId) => {
  const payment = await Payment.findByPk(paymentId, {
    include: [{ model: Booking, as: 'booking' }],
  });
  if (!payment) throw new Error('Payment not found');
  if (!payment.booking) throw new Error('Booking not found');
  if (payment.booking.status !== 'pending') {
    throw new Error(`Booking is not pending (status: ${payment.booking.status})`);
  }
  if (payment.payment_intent_id && payment.payment_status === 'pending') {
    await stripeService.cancelPaymentIntent(payment.payment_intent_id);
    await payment.update({ payment_status: 'pending_void' });
    await createAuditLog({
      user_id: payment.coach_id,
      action: 'payment_void_initiated',
      table_name: 'payments',
      record_id: payment.id,
      after_state: { payment_status: 'pending_void', note: 'awaiting payment_intent.canceled webhook' },
    });
    logger.info({
      component: 'stripe',
      event: 'payment_intent_cancel_initiated',
      paymentId: payment.id,
      paymentIntentId: payment.payment_intent_id,
    });
  }
  await payment.booking.update({
    status: 'cancelled',
    cancelled_by: 'coach',
    cancelled_at: new Date(),
  });
  await createAuditLog({
    user_id: payment.coach_id,
    action: 'booking_declined_by_coach',
    table_name: 'bookings',
    record_id: payment.booking.id,
    after_state: { status: 'cancelled', cancelled_by: 'coach' },
  });
  logger.info(`Coach declined booking ${payment.booking.id}, payment intent cancelled`);
};

/**
 * Auto-expire a stale pending booking (no coach accept/decline): cancel uncaptured PaymentIntent, cancel booking, free the slot.
 * Idempotent if booking is no longer pending.
 * @returns {{ expired: boolean, reason?: string }}
 */
export const expirePendingBookingNoCoachResponse = async (bookingId) => {
  const transaction = await sequelize.transaction();
  try {
    const booking = await Booking.findByPk(bookingId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!booking || booking.status !== 'pending') {
      await transaction.commit();
      return { expired: false, reason: 'not_pending' };
    }

    const payment = await Payment.findOne({
      where: { booking_id: booking.id },
      order: [['id', 'DESC']],
      transaction,
    });

    if (payment?.payment_intent_id && payment.payment_status === 'pending') {
      try {
        await stripeService.cancelPaymentIntent(payment.payment_intent_id);
        await payment.update({ payment_status: 'pending_void' }, { transaction });
        await createAuditLog({
          user_id: null,
          action: 'payment_void_initiated',
          table_name: 'payments',
          record_id: payment.id,
          after_state: {
            payment_status: 'pending_void',
            note: 'pending booking expired — awaiting payment_intent.canceled webhook',
          },
        });
      } catch (stripeErr) {
        logger.warn({
          component: 'stripe',
          event: 'expire_pending_pi_cancel_failed',
          bookingId: booking.id,
          message: stripeErr?.message || String(stripeErr),
        });
        await payment.update({ payment_status: 'pending_void' }, { transaction }).catch(() => {});
      }
    }

    await booking.update(
      {
        status: 'cancelled',
        cancelled_by: 'system',
        cancelled_at: new Date(),
        messaging_locked: true,
      },
      { transaction }
    );

    await CancellationHistory.create(
      {
        booking_id: booking.id,
        cancelled_by: 'system',
        reason: 'other',
        reason_notes: 'Pending booking expired (no coach response within time limit)',
        affects_reliability: false,
        refund_amount: 0,
        penalty_amount: 0,
      },
      { transaction }
    );

    await createAuditLog({
      user_id: null,
      action: 'booking_expired_pending',
      table_name: 'bookings',
      record_id: booking.id,
      after_state: { status: 'cancelled', cancelled_by: 'system' },
    });

    await transaction.commit();
    logger.info({
      component: 'booking',
      event: 'pending_booking_expired',
      bookingId: booking.id,
    });
    return { expired: true };
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
};

/**
 * Release escrow and create payout (called by worker).
 * Invariant: only invoked from payoutWorker for bookings in completed / awaiting_verification / student_no_show;
 * releaseEscrow also rejects if booking status is otherwise (no payout on cancel / no-show).
 */
export const releaseEscrow = async (paymentId, coachStripeAccountId = null) => {
  const payment = await Payment.findByPk(paymentId, {
    include: [
      { model: Booking, as: 'booking' },
      { model: User, as: 'coach', attributes: ['id', 'full_name', 'email'], include: [{ model: CoachProfile, as: 'coachProfile' }] },
    ],
  });

  if (!payment) {
    throw new Error('Payment not found');
  }

  if (payment.escrow_status !== 'held') {
    throw new Error('Payment is not in held status');
  }

  // Check if booking is completed and no disputes
  if (!['completed', 'awaiting_verification', 'student_no_show'].includes(payment.booking.status)) {
    throw new Error('Booking must be completed, awaiting_verification, or student_no_show before payout');
  }

  const totalChargeCents = dollarsToCents(payment.total_charge_to_student);
  const refundedCents = dollarsToCents(payment.refunded_amount);
  const netRetainedCents = Math.max(0, totalChargeCents - refundedCents);
  const originalCoachPayoutCents = dollarsToCents(payment.coach_payout_expected);
  const coachShare = totalChargeCents > 0 ? originalCoachPayoutCents / totalChargeCents : 0;
  const payoutCents = Math.round(netRetainedCents * coachShare);
  const payoutAmountDollars = centsToDecimalString(payoutCents);

  // Create payout record
  const payout = await Payout.create({
    coach_id: payment.coach_id,
    payment_id: paymentId,
    amount: payoutAmountDollars,
    currency: 'USD',
    status: 'pending',
  });

  if (payoutCents < 1) {
    await payout.update({ status: 'paid', processed_at: new Date() });
    await payment.update({ escrow_status: 'released' });
    await createAuditLog({
      user_id: payment.coach_id,
      action: 'payout_zero_after_refund',
      table_name: 'payouts',
      record_id: payout.id,
      after_state: {
        payout_status: 'paid',
        payout_amount: payout.amount,
        booking_id: payment.booking_id,
        payment_escrow_status: 'released',
        note: 'Net retained amount is zero after refunds; no transfer initiated',
      },
    });
    return { payment: await Payment.findByPk(payment.id), payout };
  }

  // If coach has Stripe Connect account, transfer funds
  if (coachStripeAccountId) {
    try {
      const transfer = await stripeService.transferToConnectedAccount(
        coachStripeAccountId,
        payoutAmountDollars,
        'usd',
        {
          payment_id: payment.id.toString(),
          payout_id: payout.id.toString(),
          booking_id: payment.booking_id.toString(),
        }
      );

      await payout.update({
        status: 'pending',
        external_payout_id: transfer.id,
      });

      await payment.update({
        escrow_status: 'pending_release',
        transfer_id: transfer.id,
      });

      logger.info({
        component: 'stripe',
        event: 'transfer_initiated',
        paymentId: payment.id,
        payoutId: payout.id,
        transferId: transfer.id,
        note: 'Escrow released when transfer.* webhook confirms',
      });
    } catch (error) {
      logger.error('Error transferring to coach account:', error);
      await payout.update({
        status: 'failed',
      });
      throw error;
    }
  } else {
    await payout.update({ status: 'pending' });
    await payment.update({ escrow_status: 'manual_payout_required' });
    logger.warn({
      component: 'stripe',
      event: 'manual_payout_required',
      severity: 'warn',
      payoutId: payout.id,
      coachId: payment.coach_id,
      paymentId: payment.id,
      message: 'Coach has no Stripe Connect account; escrow requires manual payout',
    });
  }

  const bookingStatusForAudit = payment.booking?.status;
  await payment.reload();
  await createAuditLog({
    user_id: payment.coach_id,
    action: 'payout_created',
    table_name: 'payouts',
    record_id: payout.id,
    after_state: {
      payout_status: payout.status,
      payout_amount: payout.amount,
      currency: payout.currency,
      booking_id: payment.booking_id,
      booking_status: bookingStatusForAudit,
      payment_escrow_status: payment.escrow_status,
      coach_payout_expected: payment.coach_payout_expected,
      payout_basis: {
        total_charge_to_student: payment.total_charge_to_student,
        refunded_amount: payment.refunded_amount,
        net_retained_amount: centsToDecimalString(netRetainedCents),
        coach_share_ratio: coachShare,
      },
      transfer_id: payment.transfer_id ?? null,
      stripe_connect_used: Boolean(coachStripeAccountId),
    },
  });

  return { payment, payout };
};

/**
 * Finalize escrow + payout from Stripe transfer webhook (transfer.created / transfer.paid).
 */
export const finalizeTransferFromStripe = async (transfer) => {
  const paymentIdRaw = transfer.metadata?.payment_id;
  const payoutIdRaw = transfer.metadata?.payout_id;
  const paymentId = paymentIdRaw != null ? parseInt(String(paymentIdRaw), 10) : null;
  const payoutId = payoutIdRaw != null ? parseInt(String(payoutIdRaw), 10) : null;

  let payout =
    Number.isFinite(payoutId) && payoutId > 0
      ? await Payout.findByPk(payoutId)
      : null;
  if (!payout && transfer.id) {
    payout = await Payout.findOne({ where: { external_payout_id: transfer.id } });
  }

  let payment =
    Number.isFinite(paymentId) && paymentId > 0 ? await Payment.findByPk(paymentId) : null;
  if (!payment && payout?.payment_id) {
    payment = await Payment.findByPk(payout.payment_id);
  }

  if (!payment) {
    throw new Error(`Payment not found for transfer ${transfer.id}; retry when payout metadata exists`);
  }

  if (payment.transfer_id && payment.transfer_id !== transfer.id) {
    logger.warn({
      component: 'stripe',
      event: 'transfer_metadata_mismatch',
      paymentId: payment.id,
      localTransferId: payment.transfer_id,
      stripeTransferId: transfer.id,
    });
    return { skipped: true };
  }

  if (!payment.transfer_id) {
    await payment.update({ transfer_id: transfer.id });
  }

  if (payment.escrow_status === 'released') {
    if (payout && payout.status !== 'paid') {
      await payout.update({
        status: 'paid',
        external_payout_id: transfer.id,
        processed_at: payout.processed_at || new Date(),
      });
    }
    return { idempotent: true, payment };
  }

  if (payment.escrow_status !== 'pending_release') {
    logger.warn({
      component: 'stripe',
      event: 'transfer_webhook_unexpected_escrow',
      paymentId: payment.id,
      escrow_status: payment.escrow_status,
      transferId: transfer.id,
    });
  }

  await payment.update({ escrow_status: 'released' });

  if (payout) {
    await payout.update({
      status: 'paid',
      external_payout_id: transfer.id,
      processed_at: new Date(),
    });
  }

  if (payout) {
    await createAuditLog({
      user_id: payment.coach_id,
      action: 'payout_finalized_from_stripe',
      table_name: 'payouts',
      record_id: payout.id,
      after_state: {
        transfer_id: transfer.id,
        escrow_status: 'released',
        payout_status: 'paid',
        booking_id: payment.booking_id,
        payment_id: payment.id,
        source: 'stripe_webhook',
      },
    });
  }

  logger.info({
    component: 'stripe',
    event: 'transfer_finalized',
    paymentId: payment.id,
    transferId: transfer.id,
    payoutId: payout?.id,
  });

  return { payment, payout };
};

/**
 * Mirror refund-related payment fields from a Stripe Charge (amount / amount_refunded in cents).
 * Single place so API-initiated refunds and webhooks stay consistent.
 */
export const applyRefundStateFromStripeCharge = async (payment, charge, { stripeRefundId = null, transaction } = {}) => {
  const chargeAmountCents = charge.amount ?? 0;
  const refundedCents = charge.amount_refunded ?? 0;
  const refundedDollars = centsToDecimalString(refundedCents);
  const totalChargeCents = dollarsToCents(payment.total_charge_to_student);
  const originalPlatformFeeCents = dollarsToCents(payment.platform_fee_amount);
  const originalCoachPayoutCents = dollarsToCents(payment.coach_payout_expected);
  const coachShare = totalChargeCents > 0 ? originalCoachPayoutCents / totalChargeCents : 0;
  const netRetainedCents = Math.max(0, chargeAmountCents - refundedCents);
  // Keep cent-level accounting exact: assign any rounding remainder to platform.
  let adjustedCoachPayoutCents = Math.round(netRetainedCents * coachShare);
  adjustedCoachPayoutCents = Math.min(netRetainedCents, Math.max(0, adjustedCoachPayoutCents));
  const adjustedPlatformFeeCents = netRetainedCents - adjustedCoachPayoutCents;

  let payment_status;
  let escrow_status;
  if (chargeAmountCents > 0 && refundedCents >= chargeAmountCents) {
    payment_status = 'refunded';
    escrow_status = 'refunded';
  } else if (refundedCents > 0) {
    payment_status = 'partially_refunded';
    escrow_status = 'held';
  } else {
    return payment;
  }

  const updates = {
    refunded_amount: refundedDollars,
    platform_fee_amount: centsToDecimalString(adjustedPlatformFeeCents),
    coach_payout_expected: centsToDecimalString(adjustedCoachPayoutCents),
    payment_status,
    escrow_status,
    refund_status: 'succeeded',
  };
  if (stripeRefundId) {
    updates.stripe_refund_id = stripeRefundId;
  }
  await payment.update(updates, { transaction });
  return payment.reload({ transaction });
};

/**
 * Process refund via Stripe; DB state is finalized from charge.refunded webhook.
 * @param {number} paymentId
 * @param {Object} [opts]
 * @param {number} opts.refundCents — integer cents to refund (must be ≤ Stripe remaining balance)
 * @param {string} [opts.reason]
 * @param {string} [opts.idempotencyKey] — Stripe idempotency key (prevents duplicate money movement)
 * @param {object} [opts.transaction] — If set, use this transaction for `SELECT ... FOR UPDATE` on the payment (e.g. booking cancel holds booking lock first, then refund in same txn).
 * @param {boolean} [opts.paymentActionExecution] — When true, allow calling Stripe while local `refund_status` is `pending` (idempotent replays from `payment_actions` workers/reconcilers).
 * @param {object} [opts.refundMetadata] — Optional Stripe refund metadata (`payment_action_id`, `booking_id`, …).
 */
export const processRefund = async (paymentId, opts = {}) => {
  const {
    refundCents: refundCentsIn,
    reason = 'requested_by_customer',
    idempotencyKey = null,
    transaction = null,
    refundMetadata = null,
  } = opts;

  const refundCents = Math.round(Number(refundCentsIn));
  if (!Number.isFinite(refundCents) || refundCents < 1) {
    throw new Error('refundCents must be a positive integer (cents)');
  }

  const lockPaymentRow = async (t) => {
    const p = await Payment.findByPk(paymentId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!p) {
      throw new Error('Payment not found');
    }
    if (p.refund_status === 'pending' && !opts.paymentActionExecution) {
      logger.warn({
        component: 'stripe',
        event: 'refund_skipped_duplicate_pending',
        paymentId: p.id,
        stripeRefundId: p.stripe_refund_id,
      });
      return { skip: true, payment: p };
    }
    if (!p.charge_id) {
      throw new Error('Payment has no charge ID');
    }
    return { skip: false, payment: p };
  };

  const lockResult = transaction
    ? await lockPaymentRow(transaction)
    : await sequelize.transaction((t) => lockPaymentRow(t));

  if (lockResult.skip) {
    return { payment: lockResult.payment, refund: { id: lockResult.payment.stripe_refund_id } };
  }

  const p = lockResult.payment;

  const chargeBefore = await stripeService.retrieveCharge(p.charge_id);
  const chargeAmountCents = Math.round(chargeBefore.amount || 0);
  const refundedSoFar = Math.round(chargeBefore.amount_refunded || 0);
  const remainingCents = chargeAmountCents - refundedSoFar;

  logger.info({
    component: 'stripe',
    event: 'refund_precheck',
    paymentId: p.id,
    chargeId: p.charge_id,
    chargeAmountCents,
    refundedSoFarCents: refundedSoFar,
    remainingCents,
    requestedRefundCents: refundCents,
  });

  if (remainingCents < 1) {
    throw new Error('No refundable balance remaining on Stripe charge');
  }
  if (refundCents > remainingCents) {
    throw new Error(
      `Refund (${refundCents}¢) exceeds remaining Stripe balance (${remainingCents}¢)`
    );
  }

  const partial = refundCents < remainingCents;
  const key =
    idempotencyKey ||
    `refund-payment-${p.id}-${refundCents}-${chargeBefore.id}`;

  const refund = await stripeService.createRefund(p.charge_id, {
    amountCents: partial ? refundCents : null,
    reason,
    idempotencyKey: key,
    metadata: refundMetadata || undefined,
  });

  /** Final refund rows come from charge.refunded webhook; avoid racing webhook with succeeded state. */
  await Payment.update(
    {
      refund_status: 'pending',
      stripe_refund_id: refund.id,
    },
    {
      where: { id: p.id },
      transaction,
    }
  );

  const updatedPayment = await Payment.findByPk(p.id, { transaction });

  await createAuditLog({
    user_id: updatedPayment.student_id,
    action: 'refund_initiated',
    table_name: 'payments',
    record_id: updatedPayment.id,
    after_state: {
      stripe_refund_id: refund.id,
      refund_status: 'pending',
      refund_cents: refundCents,
      charge_amount_cents: chargeAmountCents,
      refunded_so_far_before_cents: refundedSoFar,
      remaining_on_charge_after_refund_cents: remainingCents - refundCents,
      partial_refund: partial,
      note: 'awaiting charge.refunded webhook or reconciliation',
    },
  });

  logger.info({
    component: 'stripe',
    event: 'refund_initiated_api',
    paymentId: p.id,
    chargeId: p.charge_id,
    stripeRefundId: refund.id,
    refundCents,
    remainingCentsBefore: remainingCents,
    partial,
    idempotencyKey: key,
    metadata: refundMetadata || undefined,
  });

  return { payment: updatedPayment, refund };
};

/** Max Stripe execution failures per `payment_actions` row before status `failed`. */
export const PAYMENT_ACTION_MAX_FAILURE_ATTEMPTS = 8;

/** Rows that snap `refund_cents` from Stripe charge remaining balance inside the worker. */
const HYDRATE_FULL_REMAINING_ACTION_TYPES = new Set(['dispute_refund_full']);

/** Refunds executed with cents fixed when the row was enqueued (booking flows + dispute partial). */
const FIXED_CENTS_PAYMENT_ACTION_TYPES = new Set([
  'dispute_refund_partial',
  'booking_cancel_refund',
  'booking_coach_no_show_refund',
  'booking_admin_refund',
]);

function stripeRefundIdempotencyKeyForPaymentAction(pa) {
  return `refund_${pa.booking_id}_${pa.id}`;
}

/**
 * Persist a stable Stripe refund idempotency key per row (`refund_<bookingId>_<paymentActionId>`) when absent.
 * Mirrors between `stripe_idempotency_key` and `idempotency_key` without overwriting Stripe keys from older rows.
 */
async function ensureStripeIdempotencyPersistedForPaymentAction(pa) {
  const desired = stripeRefundIdempotencyKeyForPaymentAction(pa);
  const hasStripe = !!(pa.stripe_idempotency_key && String(pa.stripe_idempotency_key).trim());
  const hasLegacy = !!(pa.idempotency_key && String(pa.idempotency_key).trim());

  if (!hasStripe && !hasLegacy) {
    await PaymentAction.update(
      { stripe_idempotency_key: desired, idempotency_key: desired },
      { where: { id: pa.id, stripe_idempotency_key: null, idempotency_key: null } },
    );
    return;
  }
  if (hasStripe && !hasLegacy) {
    await PaymentAction.update(
      { idempotency_key: pa.stripe_idempotency_key },
      { where: { id: pa.id } },
    );
    return;
  }
  if (!hasStripe && hasLegacy) {
    await PaymentAction.update(
      { stripe_idempotency_key: pa.idempotency_key },
      { where: { id: pa.id } },
    );
  }
}

/**
 * Build row attributes only (insert in same DB txn as dispute resolution).
 * Stripe is **not** called here — `dispute_refund_full` snaps **refund_cents** from the Stripe charge in the worker; Stripe idempotency keys are assigned there.
 */
export const buildDisputeRefundPaymentActionAttrs = async ({
  bookingId,
  disputeId,
  resolutionAction,
  refundAmountDollars,
}) => {
  if (!resolutionAction?.requires_payout_adjustment) return null;

  const payment = await Payment.findOne({
    where: { booking_id: bookingId },
    order: [['id', 'DESC']],
  });
  if (!payment) throw new Error('Payment not found for this booking');
  if (!payment.charge_id) throw new Error('Payment has no Stripe charge to refund');

  if (resolutionAction.code === 'approved_refund') {
    return {
      booking_id: bookingId,
      payment_id: payment.id,
      dispute_id: disputeId,
      action_type: 'dispute_refund_full',
      status: 'pending',
      refund_cents: null,
      idempotency_key: null,
      stripe_idempotency_key: null,
      attempts: 0,
    };
  }

  if (resolutionAction.code === 'partial_refund') {
    if (refundAmountDollars == null) throw new Error('refund_amount is required when resolving with partial_refund');
    const refundCents = dollarsToCents(refundAmountDollars);
    if (refundCents < 1) throw new Error('refund_amount must be at least 0.01');
    return {
      booking_id: bookingId,
      payment_id: payment.id,
      dispute_id: disputeId,
      action_type: 'dispute_refund_partial',
      status: 'pending',
      refund_cents: refundCents,
      idempotency_key: null,
      stripe_idempotency_key: null,
      attempts: 0,
    };
  }

  throw new Error(
    `Resolution action "${resolutionAction.code}" cannot enqueue automatic refund`,
  );
};

/**
 * Deferred full refunds: Stripe charge snapshot + deterministic idempotency key (runs in worker).
 */
async function hydrateFullRemainingRefundPaymentAction(pa) {
  if (!HYDRATE_FULL_REMAINING_ACTION_TYPES.has(pa.action_type) || pa.refund_cents != null)
    return pa.reload();

  const payment = await Payment.findByPk(pa.payment_id);
  if (!payment?.charge_id) {
    throw new Error('Payment has no Stripe charge');
  }

  const charge = await stripeService.retrieveCharge(payment.charge_id);
  const chargeAmount = Math.round(charge.amount || 0);
  const alreadyRefunded = Math.round(charge.amount_refunded || 0);
  const refundCents = chargeAmount - alreadyRefunded;
  if (refundCents < 1) {
    throw new Error('No refundable balance remaining on Stripe charge');
  }

  await PaymentAction.update(
    { refund_cents: refundCents },
    {
      where: {
        id: pa.id,
        refund_cents: null,
        action_type: { [Op.in]: [...HYDRATE_FULL_REMAINING_ACTION_TYPES] },
      },
    },
  );
  return pa.reload();
}

/**
 * Execute pending `payment_actions` rows (dispute + booking admin/cancel/coach-auto paths).
 */
export const processPendingRefundPaymentActions = async ({ batchLimit = 14 } = {}) => {
  const rows = await PaymentAction.findAll({
    where: {
      status: 'pending',
      attempts: { [Op.lt]: PAYMENT_ACTION_MAX_FAILURE_ATTEMPTS },
    },
    order: [['id', 'ASC']],
    limit: batchLimit,
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const snapshot of rows) {
    const paymentActionId = snapshot.id;
    try {
      let row = await PaymentAction.findByPk(paymentActionId);
      if (!row) continue;
      row = await hydrateFullRemainingRefundPaymentAction(row);
      await ensureStripeIdempotencyPersistedForPaymentAction(row);
      row = await PaymentAction.findByPk(paymentActionId);
      const stripeIk = row.stripe_idempotency_key || row.idempotency_key;
      if (row.refund_cents == null || !stripeIk) {
        logger.warn({
          component: 'payments',
          event: 'payment_action_not_ready_skip',
          paymentActionId: row.id,
          action_type: row.action_type,
        });
        continue;
      }

      const result = await processRefund(row.payment_id, {
        refundCents: row.refund_cents,
        idempotencyKey: stripeIk,
        reason: 'requested_by_customer',
        paymentActionExecution: true,
        refundMetadata: {
          payment_action_id: String(row.id),
          booking_id: String(row.booking_id),
        },
      });

      processed += 1;
      succeeded += 1;

      const refundId =
        (typeof result?.refund?.id === 'string' && result.refund.id) ||
        result?.payment?.stripe_refund_id ||
        null;

      await row.reload();
      await row.update({
        status: 'succeeded',
        stripe_refund_id: refundId,
        error_message: null,
      });

      logger.info({
        component: 'payments',
        event: 'payment_action_refund_completed',
        paymentActionId: row.id,
        paymentId: row.payment_id,
        bookingId: row.booking_id,
        disputeId: row.dispute_id,
        stripeRefundId: refundId,
      });
    } catch (err) {
      processed += 1;
      failed += 1;
      const cur = await PaymentAction.findByPk(paymentActionId);
      if (!cur) continue;
      const msg = err?.message || String(err);
      const nextAttempts = (cur.attempts || 0) + 1;
      const terminal = nextAttempts >= PAYMENT_ACTION_MAX_FAILURE_ATTEMPTS;
      await cur.update({
        status: terminal ? 'failed' : 'pending',
        attempts: nextAttempts,
        error_message: msg.slice(0, 900),
      });
      logger.error({
        component: 'payments',
        event: terminal ? 'payment_action_refund_failed_terminal' : 'payment_action_refund_retry',
        paymentActionId: cur.id,
        paymentId: cur.payment_id,
        bookingId: cur.booking_id,
        disputeId: cur.dispute_id,
        attempts: nextAttempts,
        message: msg,
      });
    }
  }

  if (processed > 0) {
    logger.info({
      component: 'payments',
      event: 'payment_actions_batch_finished',
      examined: rows.length,
      processed,
      succeeded,
      failed,
    });
  }

  return { examined: rows.length, processed, succeeded, failed };
};

/**
 * Stripe → DB truth alignment for deferred refunds (`payment_actions`).
 * Heals Stripe-succeeded-but-DB-stuck rows via refund metadata lookup and idempotent `refunds.create` replay.
 */
export const reconcileRefundPaymentActionsWithStripe = async ({
  batchLimit = 40,
  autoHeal = true,
} = {}) => {
  const rows = await PaymentAction.findAll({
    where: {
      [Op.or]: [{ status: 'pending' }, { status: 'failed' }, { status: 'succeeded' }],
    },
    order: [['id', 'ASC']],
    limit: batchLimit,
  });

  let scanned = 0;
  let healedMeta = 0;
  let healedReplay = 0;
  let mismatches = 0;

  for (const snapshot of rows) {
    scanned += 1;
    let pa = await PaymentAction.findByPk(snapshot.id);
    if (!pa) continue;

    const payment = await Payment.findByPk(pa.payment_id);
    if (!payment?.charge_id) {
      logger.warn({
        component: 'payments',
        event: 'payment_action_reconcile_missing_charge',
        paymentActionId: pa.id,
        paymentId: pa.payment_id,
      });
      continue;
    }

    if (pa.status === 'succeeded' && pa.stripe_refund_id) {
      try {
        await stripeService.retrieveRefund(pa.stripe_refund_id);
      } catch (err) {
        mismatches += 1;
        logger.error({
          component: 'payments',
          event: 'payment_action_db_succeeded_stripe_missing',
          paymentActionId: pa.id,
          stripeRefundId: pa.stripe_refund_id,
          message: err?.message || String(err),
        });
      }
      continue;
    }

    if (pa.status === 'succeeded' && !pa.stripe_refund_id) {
      mismatches += 1;
      logger.warn({
        component: 'payments',
        event: 'payment_action_succeeded_missing_refund_fk',
        paymentActionId: pa.id,
      });
      let list = [];
      try {
        list = await stripeService.listRefundsForCharge(payment.charge_id);
      } catch (err) {
        logger.error({
          component: 'payments',
          event: 'payment_action_reconcile_list_failed',
          paymentActionId: pa.id,
          message: err?.message || String(err),
        });
        continue;
      }
      const matches = list.filter((r) => r.metadata?.payment_action_id === String(pa.id));
      if (matches.length > 1) {
        mismatches += 1;
        logger.error({
          component: 'payments',
          event: 'payment_action_reconcile_multiple_refunds_ambiguous',
          paymentActionId: pa.id,
          count: matches.length,
        });
        continue;
      }
      if (matches.length === 1 && autoHeal) {
        await pa.update({ stripe_refund_id: matches[0].id });
        healedMeta += 1;
        logger.info({
          component: 'payments',
          event: 'payment_action_reconcile_backfilled_refund_id',
          paymentActionId: pa.id,
          stripeRefundId: matches[0].id,
        });
      }
      continue;
    }

    if (
      (pa.status === 'pending' || pa.status === 'failed') &&
      (pa.refund_cents == null || pa.refund_cents < 1)
    ) {
      continue;
    }

    if (!(pa.status === 'pending' || pa.status === 'failed')) continue;

    await ensureStripeIdempotencyPersistedForPaymentAction(pa);
    pa = await PaymentAction.findByPk(pa.id);
    const stripeIk = pa.stripe_idempotency_key || pa.idempotency_key;
    if (!stripeIk) continue;

    let list = [];
    try {
      list = await stripeService.listRefundsForCharge(payment.charge_id);
    } catch (err) {
      logger.error({
        component: 'payments',
        event: 'payment_action_reconcile_list_failed',
        paymentActionId: pa.id,
        message: err?.message || String(err),
      });
      continue;
    }

    const byMeta = list.filter((r) => r.metadata?.payment_action_id === String(pa.id));
    if (byMeta.length > 1) {
      mismatches += 1;
      logger.error({
        component: 'payments',
        event: 'payment_action_reconcile_multiple_refunds_ambiguous',
        paymentActionId: pa.id,
        count: byMeta.length,
      });
      continue;
    }

    if (byMeta.length === 1 && autoHeal) {
      await pa.update({
        status: 'succeeded',
        stripe_refund_id: byMeta[0].id,
        error_message: null,
      });
      healedMeta += 1;
      logger.info({
        component: 'payments',
        event: 'payment_action_reconcile_healed_stripe_ahead_of_db',
        paymentActionId: pa.id,
        stripeRefundId: byMeta[0].id,
      });
      continue;
    }

    if (byMeta.length === 0 && autoHeal) {
      try {
        const partial = FIXED_CENTS_PAYMENT_ACTION_TYPES.has(pa.action_type);
        const ref = await stripeService.createRefund(payment.charge_id, {
          amountCents: partial ? pa.refund_cents : null,
          reason: 'requested_by_customer',
          idempotencyKey: stripeIk,
          metadata: {
            payment_action_id: String(pa.id),
            booking_id: String(pa.booking_id),
          },
        });
        await pa.update({
          status: 'succeeded',
          stripe_refund_id: ref.id,
          error_message: null,
        });
        healedReplay += 1;
        logger.info({
          component: 'payments',
          event: 'payment_action_reconcile_idempotent_refund_replay',
          paymentActionId: pa.id,
          stripeRefundId: ref.id,
        });
      } catch (replayErr) {
        logger.warn({
          component: 'payments',
          event: 'payment_action_reconcile_idempotent_replay_failed',
          paymentActionId: pa.id,
          message: replayErr?.message || String(replayErr),
        });
      }
    }
  }

  return { scanned, healedMeta, healedReplay, mismatches };
};

/**
 * SAFETY NET: Pending rows stuck for a while are visible in logs — manual follow-up via Stripe dashboards / admins.
 */
export const logStalePendingPaymentActions = async ({ staleMs = 60 * 60 * 1000 } = {}) => {
  const threshold = new Date(Date.now() - staleMs);
  const staleCount = await PaymentAction.count({
    where: {
      status: 'pending',
      attempts: { [Op.lt]: PAYMENT_ACTION_MAX_FAILURE_ATTEMPTS },
      created_at: { [Op.lt]: threshold },
    },
  });

  if (staleCount > 0) {
    logger.warn({
      component: 'payments',
      event: 'stale_payment_actions_pending_review',
      count: staleCount,
      staleMs,
    });
  }
  return staleCount;
};

/**
 * Snapshot latest booking-payment refund state for guardrail checks.
 * Used by controllers to prevent mixed refund paths (manual + dispute).
 */
export const getLatestBookingRefundState = async (bookingId) => {
  const queuedPipeline = await PaymentAction.count({
    where: {
      booking_id: bookingId,
      status: 'pending',
      attempts: { [Op.lt]: PAYMENT_ACTION_MAX_FAILURE_ATTEMPTS },
    },
  });

  const payment = await Payment.findOne({
    where: { booking_id: bookingId },
    order: [['id', 'DESC']],
  });
  if (!payment) {
    return {
      payment: null,
      chargeAmountCents: 0,
      refundedSoFarCents: 0,
      hasAnyRefund: queuedPipeline > 0,
      hasPendingRefund: queuedPipeline > 0,
      hasQueuedPaymentActionRefund: queuedPipeline > 0,
    };
  }
  if (!payment.charge_id) {
    const hasPendingRefund = payment.refund_status === 'pending';
    return {
      payment,
      chargeAmountCents: 0,
      refundedSoFarCents: 0,
      hasAnyRefund: hasPendingRefund || queuedPipeline > 0,
      hasPendingRefund: hasPendingRefund || queuedPipeline > 0,
      hasQueuedPaymentActionRefund: queuedPipeline > 0,
    };
  }

  const charge = await stripeService.retrieveCharge(payment.charge_id);
  const chargeAmountCents = Math.round(charge.amount || 0);
  const refundedSoFarCents = Math.round(charge.amount_refunded || 0);
  const hasPendingRefund = payment.refund_status === 'pending';

  return {
    payment,
    chargeAmountCents,
    refundedSoFarCents,
    hasAnyRefund: refundedSoFarCents > 0 || hasPendingRefund || queuedPipeline > 0,
    hasPendingRefund: hasPendingRefund || queuedPipeline > 0,
    hasQueuedPaymentActionRefund: queuedPipeline > 0,
  };
};

/**
 * Compare local payment refund fields to Stripe Charge; optional auto-heal from Charge.
 * Use after webhooks and in reconciliation jobs.
 */
/** @alias for audit/docs — same as assertStripePaymentConsistency */
export const assertStripeConsistency = async (localPayment, options) =>
  assertStripePaymentConsistency(localPayment, options);

export const assertStripePaymentConsistency = async (payment, { autoHeal = false, context = '' } = {}) => {
  const pay = typeof payment === 'number' ? await Payment.findByPk(payment) : payment;
  if (!pay) {
    return { ok: false, error: 'payment_missing' };
  }

  let pi = null;
  if (pay.payment_intent_id) {
    try {
      pi = await stripeService.getPaymentIntent(pay.payment_intent_id);
    } catch (err) {
      logger.error({
        component: 'stripe',
        event: 'consistency_pi_fetch_failed',
        paymentId: pay.id,
        paymentIntentId: pay.payment_intent_id,
        context,
        message: err.message,
      });
    }
  }

  if (!pay.charge_id) {
    if (pi?.status === 'succeeded' && pay.payment_status === 'pending_capture' && autoHeal) {
      const latest =
        typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
      if (latest) {
        await pay.update({ charge_id: latest, payment_status: 'captured' });
        logger.warn({
          component: 'stripe',
          event: 'pending_capture_healed_from_pi',
          paymentId: pay.id,
          context,
        });
      }
    }
    return { ok: true, skipped: true, reason: 'no_charge_id' };
  }

  let charge;
  try {
    charge = await stripeService.retrieveCharge(pay.charge_id);
  } catch (err) {
    logger.error({
      component: 'stripe',
      event: 'consistency_fetch_failed',
      paymentId: pay.id,
      chargeId: pay.charge_id,
      context,
      message: err.message,
    });
    return { ok: false, error: err.message };
  }

  const stripeRefundedCents = charge.amount_refunded ?? 0;
  const localCents = Math.round(Number.parseFloat(String(pay.refunded_amount || 0), 10) * 100);
  const refundMismatch = Math.abs(stripeRefundedCents - localCents) > 1;

  const chargeAmountCents = charge.amount ?? 0;
  const expectedTotalCents = Math.round(
    Number.parseFloat(String(pay.total_charge_to_student || 0), 10) * 100
  );
  const amountMismatch =
    expectedTotalCents > 0 &&
    Math.abs(chargeAmountCents - expectedTotalCents) > 1 &&
    !['refunded', 'partially_refunded'].includes(pay.payment_status);

  let expectedRefundPaymentStatus;
  if (chargeAmountCents > 0 && stripeRefundedCents >= chargeAmountCents) {
    expectedRefundPaymentStatus = 'refunded';
  } else if (stripeRefundedCents > 0) {
    expectedRefundPaymentStatus = 'partially_refunded';
  } else {
    expectedRefundPaymentStatus = null;
  }

  const refundStatusMismatch =
    expectedRefundPaymentStatus != null &&
    pay.payment_status !== expectedRefundPaymentStatus &&
    (pay.refund_status === 'succeeded' || stripeRefundedCents > 0);

  let piMismatch = false;
  if (pi) {
    if (pi.status === 'succeeded' && pay.payment_status === 'pending_capture') {
      piMismatch = false;
    } else if (pi.status === 'succeeded' && pay.payment_status === 'pending' && !pay.metadata?.capture_on_accept) {
      piMismatch = true;
    } else if (pi.status === 'canceled' && !['failed', 'pending_void'].includes(pay.payment_status)) {
      piMismatch = true;
    }
  }

  if (refundMismatch || amountMismatch || refundStatusMismatch || piMismatch) {
    logger.error({
      component: 'stripe',
      event: 'payment_state_mismatch',
      severity: 'critical',
      paymentId: pay.id,
      chargeId: pay.charge_id,
      context,
      piMismatch,
      local: {
        refunded_amount: pay.refunded_amount,
        payment_status: pay.payment_status,
        refund_status: pay.refund_status,
        total_charge_to_student: pay.total_charge_to_student,
      },
      stripe: {
        amount_refunded_cents: stripeRefundedCents,
        amount_cents: chargeAmountCents,
        expected_refund_payment_status: expectedRefundPaymentStatus,
        payment_intent_status: pi?.status,
      },
    });

    if (autoHeal) {
      const reloaded = await Payment.findByPk(pay.id, {
        include: [{ model: Booking, as: 'booking' }],
      });
      if (stripeRefundedCents > 0 || expectedRefundPaymentStatus) {
        await applyRefundStateFromStripeCharge(reloaded, charge, {});
      }
      if (pi?.status === 'succeeded' && reloaded.payment_status === 'pending_capture') {
        await reloaded.update({ payment_status: 'captured' });
        if (reloaded.booking?.status === 'pending') {
          await reloaded.booking.update({ status: 'confirmed', messaging_locked: false });
        }
      }
      logger.warn({
        component: 'stripe',
        event: 'payment_state_auto_healed',
        paymentId: pay.id,
        context,
      });
      return { ok: true, healed: true };
    }
    return { ok: false, mismatch: true };
  }

  if (pay.refund_status === 'pending' && stripeRefundedCents > 0 && autoHeal) {
    const reloaded = await Payment.findByPk(pay.id);
    await applyRefundStateFromStripeCharge(reloaded, charge, {});
    logger.info({
      component: 'stripe',
      event: 'pending_refund_finalized_from_stripe',
      paymentId: pay.id,
      context,
    });
    return { ok: true, healed: true };
  }

  return { ok: true };
};

/**
 * Create payment and PaymentIntent for a paid reschedule
 * @param {Booking} booking - The booking being rescheduled
 * @param {number} studentId - Student user ID
 * @param {number} rescheduleHistoryId - Reschedule history record ID
 * @returns {Promise<Object>} Payment and PaymentIntent
 */
export const createPaymentForPaidReschedule = async (booking, studentId, rescheduleHistoryId) => {
  // Create payment record for reschedule fee
  const payment = await Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: studentId,
    lesson_price: 0, // Reschedule fee is separate from lesson price
    platform_fee_percent: 0,
    platform_fee_amount: 0,
    total_charge_to_student: PAID_RESCHEDULE_FEE,
    coach_payout_expected: 0, // Reschedule fee goes to platform, not coach
    escrow_status: 'held',
    payment_status: 'pending',
    refund_status: 'none',
    payment_method: 'stripe',
    currency: 'USD',
    metadata: {
      booking_id: booking.id,
      reschedule_history_id: rescheduleHistoryId,
      type: 'paid_reschedule',
    },
  });

  // Create Stripe PaymentIntent
  const paymentIntent = await stripeService.createPaymentIntent(
    PAID_RESCHEDULE_FEE,
    'usd',
    null,
    {
      booking_id: booking.id.toString(),
      payment_id: payment.id.toString(),
      reschedule_history_id: rescheduleHistoryId.toString(),
      type: 'paid_reschedule',
    }
  );

  // Update payment with PaymentIntent ID
  await payment.update({
    payment_intent_id: paymentIntent.id,
  });

  await createAuditLog({
    user_id: studentId,
    action: 'paid_reschedule_payment_created',
    table_name: 'payments',
    record_id: payment.id,
    after_state: { payment_intent_id: paymentIntent.id, amount: PAID_RESCHEDULE_FEE },
  });

  return {
    payment,
    paymentIntent: {
      id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
    },
  };
};
