import { Payment, Booking, User } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { logAudit } from '../utils/audit.js';

const PLATFORM_FEE_PERCENT = 8.00;

export const getPayments = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, escrow_status, student_id, coach_id } = req.query;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = {};
    if (status) where.payment_status = status;
    if (escrow_status) where.escrow_status = escrow_status;
    if (student_id) where.student_id = student_id;
    if (coach_id) where.coach_id = coach_id;

    if (req.user.role !== 'admin') {
      if (req.user.role === 'coach') {
        where.coach_id = req.user.id;
      } else if (req.user.role === 'student') {
        where.student_id = req.user.id;
      }
    }

    const payments = await Payment.findAndCountAll({
      where,
      include: [
        { model: Booking, as: 'booking' },
        { model: User, as: 'coach', attributes: ['id', 'full_name'] },
        { model: User, as: 'student', attributes: ['id', 'full_name'] },
      ],
      limit: queryLimit,
      offset,
      order: [['created_at', 'DESC']],
    });

    const response = getPagingData(payments, page, queryLimit);
    return successResponse(res, response.items, 'Payments retrieved successfully');
  } catch (error) {
    console.error('Get payments error:', error);
    return errorResponse(res, 'Failed to retrieve payments', 500);
  }
};

export const getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findByPk(id, {
      include: [
        { model: Booking, as: 'booking' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'email'] },
        { model: User, as: 'student', attributes: ['id', 'full_name', 'email'] },
      ],
    });

    if (!payment) {
      return errorResponse(res, 'Payment not found', 404);
    }

    if (req.user.role !== 'admin' && req.user.id !== payment.coach_id && req.user.id !== payment.student_id) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    return successResponse(res, payment, 'Payment retrieved successfully');
  } catch (error) {
    console.error('Get payment error:', error);
    return errorResponse(res, 'Failed to retrieve payment', 500);
  }
};

export const createPayment = async (req, res) => {
  try {
    const { booking_id, payment_method = 'stripe', payment_intent_id, charge_id } = req.body;

    const booking = await Booking.findByPk(booking_id, {
      include: [{ model: User, as: 'coach' }],
    });

    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (req.user.id !== booking.primary_student_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const platformFeeAmount = (booking.price * PLATFORM_FEE_PERCENT) / 100;
    const totalCharge = parseFloat(booking.price) + parseFloat(platformFeeAmount);
    const coachPayoutExpected = parseFloat(booking.price) - parseFloat(platformFeeAmount);

    const payment = await Payment.create({
      booking_id,
      coach_id: booking.coach_id,
      student_id: req.user.id,
      lesson_price: booking.price,
      platform_fee_percent: PLATFORM_FEE_PERCENT,
      platform_fee_amount: platformFeeAmount,
      total_charge_to_student: totalCharge,
      coach_payout_expected: coachPayoutExpected,
      payment_method,
      payment_intent_id,
      charge_id,
      escrow_status: 'held',
      payment_status: 'pending',
    });

    await logAudit(req.user.id, 'payment_created', 'payments', payment.id, null, payment.toJSON(), req);

    return successResponse(res, payment, 'Payment created successfully', 201);
  } catch (error) {
    console.error('Create payment error:', error);
    return errorResponse(res, 'Failed to create payment', 500);
  }
};

export const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_status, escrow_status, charge_id, transfer_id, payout_id } = req.body;

    const payment = await Payment.findByPk(id);
    if (!payment) {
      return errorResponse(res, 'Payment not found', 404);
    }

    if (req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const beforeState = payment.toJSON();
    await payment.update({
      payment_status: payment_status || payment.payment_status,
      escrow_status: escrow_status || payment.escrow_status,
      charge_id: charge_id || payment.charge_id,
      transfer_id: transfer_id || payment.transfer_id,
      payout_id: payout_id || payment.payout_id,
    });

    await logAudit(req.user.id, 'payment_status_updated', 'payments', payment.id, beforeState, payment.toJSON(), req);

    return successResponse(res, payment, 'Payment status updated successfully');
  } catch (error) {
    console.error('Update payment status error:', error);
    return errorResponse(res, 'Failed to update payment status', 500);
  }
};

export const processRefund = async (req, res) => {
  try {
    const { id } = req.params;
    const { refund_amount, reason } = req.body;

    const payment = await Payment.findByPk(id);
    if (!payment) {
      return errorResponse(res, 'Payment not found', 404);
    }

    if (req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const refundAmount = refund_amount || payment.total_charge_to_student;
    if (refundAmount > payment.total_charge_to_student) {
      return errorResponse(res, 'Refund amount exceeds payment amount', 400);
    }

    const beforeState = payment.toJSON();
    await payment.update({
      payment_status: 'refunded',
      escrow_status: 'refunded',
      refunded_amount: refundAmount,
    });

    await logAudit(req.user.id, 'payment_refunded', 'payments', payment.id, beforeState, payment.toJSON(), req);

    return successResponse(res, payment, 'Refund processed successfully');
  } catch (error) {
    console.error('Process refund error:', error);
    return errorResponse(res, 'Failed to process refund', 500);
  }
};
