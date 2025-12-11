import { Payment, Booking, Payout, User, CoachProfile } from '../models/index.js';
import { Op } from 'sequelize';
import * as stripeService from './stripeService.js';
import { logger } from '../config/logger.js';
import { createAuditLog } from '../utils/audit.js';

const PLATFORM_FEE_PERCENT = 8.00;
const COACH_COMMISSION_PERCENT = 92.00; // Coach receives 92% of lesson price

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

/**
 * Create payment and PaymentIntent for a booking
 */
export const createPaymentForBooking = async (booking, studentId, paymentMethod = 'stripe') => {
  const amounts = calculatePaymentAmounts(booking.price);

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
    payment_status: 'pending',
    payment_method: paymentMethod,
    currency: 'USD',
    metadata: {
      booking_id: booking.id,
      lesson_id: booking.lesson_id,
    },
  });

  // Create Stripe PaymentIntent
  const paymentIntent = await stripeService.createPaymentIntent(
    amounts.total_charge_to_student,
    'usd',
    null,
    {
      booking_id: booking.id.toString(),
      payment_id: payment.id.toString(),
      coach_id: booking.coach_id.toString(),
      student_id: studentId.toString(),
    }
  );

  // Update payment with PaymentIntent ID
  await payment.update({
    payment_intent_id: paymentIntent.id,
  });

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

  // Unlock messaging for the booking
  if (payment.booking) {
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
      { model: User, as: 'coach', include: [{ model: CoachProfile, as: 'coachProfile' }] },
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
