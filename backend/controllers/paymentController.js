import { Payment, Booking, User } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logger } from '../config/logger.js';

const MAX_LIST_ALL_PAYMENTS = 10000;

export const getPayments = async (req, res) => {
  try {
    const { page, limit, status, escrow_status, student_id, coach_id } = req.validated;
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_PAYMENTS, offset: 0 };

    const where = {};
    if (status) where.payment_status = status;
    if (escrow_status) where.escrow_status = escrow_status;
    if (student_id) where.student_id = student_id;
    if (coach_id) where.coach_id = coach_id;

    if (!(req.user.roles || []).includes('admin')) {
      if ((req.user.roles || []).includes('coach')) {
        where.coach_id = req.user.id;
      } else if ((req.user.roles || []).includes('student')) {
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

    if (!isPaginated) {
      return successResponse(res, payments.rows, 'Payments retrieved successfully');
    }

    const response = getPagingData(payments, page, queryLimit);
    return paginatedResponse(res, response.items, response.pagination, 'Payments retrieved successfully');
  } catch (error) {
    logger.error('Get payments error:', error);
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

    if (!(req.user.roles || []).includes('admin') && req.user.id !== payment.coach_id && req.user.id !== payment.student_id) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    return successResponse(res, payment, 'Payment retrieved successfully');
  } catch (error) {
    logger.error('Get payment error:', error);
    return errorResponse(res, 'Failed to retrieve payment', 500);
  }
};
