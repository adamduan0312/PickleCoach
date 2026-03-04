import { Payment, Booking, Payout, User, CoachProfile } from '../models/index.js';
import { Op } from 'sequelize';
import * as stripeService from './stripeService.js';
import { logger } from '../config/logger.js';
import { createAuditLog } from '../utils/audit.js';

const PLATFORM_FEE_PERCENT = 8.00;
const COACH_COMMISSION_PERCENT = 92.00; // Coach receives 92% of lesson price
const PAID_RESCHEDULE_FEE = parseFloat(process.env.PAID_RESCHEDULE_FEE || '3.00'); // Default $3

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

// Stripe minimum charge (USD): $0.50. Below this we treat as free and skip PaymentIntent.
const STRIPE_MIN_AMOUNT_USD = 0.5;

/**
 * Create payment and PaymentIntent for a booking
 * @param {Object} options.transaction - Optional Sequelize transaction (if provided, booking is rolled back on Stripe failure)
 */
export const createPaymentForBooking = async (booking, studentId, paymentMethod = 'stripe', options = {}) => {
  const { transaction = null } = options;
  const amounts = calculatePaymentAmounts(booking.price);
  const totalCharge = Number(amounts.total_charge_to_student) || 0;
  const isFreeLesson = totalCharge < STRIPE_MIN_AMOUNT_USD;

  const createOptions = transaction ? { transaction } : {};

  // Create payment record
  const payment = await Payment.create({
    booking_id: booking.id,
    coach_id: booking.coach_id,
    student_id: studentId,
    lesson_price: amounts.lesson_price,
    platform_fee_percent: amounts.platform_fee_percent,
    platform_fee_amount: amounts.platform_fee_amount,
    total_charge_to_student: amounts.total_charge_to_student,
    coach_payout_expected: amounts.coach_payout_expected,
    escrow_status: 'held',
    payment_status: isFreeLesson ? 'captured' : 'pending',
    payment_method: paymentMethod,
    currency: 'USD',
    metadata: {
      booking_id: booking.id,
      lesson_id: booking.lesson_id,
    },
  }, createOptions);

  let paymentIntent;
  if (isFreeLesson) {
    paymentIntent = { id: null, client_secret: null, amount: 0, currency: 'usd', status: 'succeeded' };
    await createAuditLog({
      user_id: studentId,
      action: 'payment_created',
      table_name: 'payments',
      record_id: payment.id,
      after_state: { amount: 0, free_lesson: true },
    });
  } else {
    paymentIntent = await stripeService.createPaymentIntent(
      totalCharge,
      'usd',
      null,
      {
        booking_id: booking.id.toString(),
        payment_id: payment.id.toString(),
        coach_id: booking.coach_id.toString(),
        student_id: studentId.toString(),
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
  }

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
    throw new Error('Payment not found');
  }

  // Update payment status
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
          const userToUpdate = await User.findByPk(userIdToUpdate);
          if (userToUpdate && userToUpdate.role !== 'admin') {
            await updateUserReliability(userIdToUpdate).catch(err => {
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
 * Release escrow and create payout (called by worker)
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
  if (payment.booking.status !== 'completed' && payment.booking.status !== 'awaiting_verification') {
    throw new Error('Booking must be completed before payout');
  }

  // Create payout record
  const payout = await Payout.create({
    coach_id: payment.coach_id,
    payment_id: paymentId,
    amount: payment.coach_payout_expected,
    currency: 'USD',
    status: 'pending',
  });

  // If coach has Stripe Connect account, transfer funds
  if (coachStripeAccountId) {
    try {
      const transfer = await stripeService.transferToConnectedAccount(
        coachStripeAccountId,
        payment.coach_payout_expected,
        'usd',
        {
          payment_id: payment.id.toString(),
          payout_id: payout.id.toString(),
          booking_id: payment.booking_id.toString(),
        }
      );

      await payout.update({
        status: 'paid',
        external_payout_id: transfer.id,
        processed_at: new Date(),
      });

      await payment.update({ escrow_status: 'released' });
    } catch (error) {
      logger.error('Error transferring to coach account:', error);
      await payout.update({
        status: 'failed',
      });
      throw error;
    }
  } else {
    // No Stripe Connect account, mark as pending manual processing
    await payout.update({ status: 'pending' });
  }

  await createAuditLog({
    user_id: payment.coach_id,
    action: 'payout_created',
    table_name: 'payouts',
    record_id: payout.id,
    after_state: { amount: payout.amount, status: payout.status },
  });

  return { payment, payout };
};

/**
 * Process refund (with Stripe)
 */
export const processRefund = async (paymentId, refundAmount = null, reason = 'requested_by_customer') => {
  const payment = await Payment.findByPk(paymentId);
  if (!payment) {
    throw new Error('Payment not found');
  }

  if (!payment.charge_id) {
    throw new Error('Payment has no charge ID');
  }

  const amount = refundAmount || payment.total_charge_to_student;
  if (amount > payment.total_charge_to_student) {
    throw new Error('Refund amount exceeds payment amount');
  }

  // Create refund via Stripe
  const refund = await stripeService.createRefund(payment.charge_id, amount, reason);

  // Update payment
  await payment.update({
    payment_status: 'refunded',
    escrow_status: 'refunded',
    refunded_amount: amount,
  });

  await createAuditLog({
    user_id: payment.student_id,
    action: 'refund_processed',
    table_name: 'payments',
    record_id: payment.id,
    after_state: { refunded_amount: amount, status: 'refunded' },
  });

  return { payment, refund };
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
