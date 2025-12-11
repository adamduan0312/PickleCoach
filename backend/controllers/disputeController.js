import { Dispute, Booking, DisputeType, DisputeResolutionAction, User, Payment } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { Op } from 'sequelize';

export const getDisputes = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, booking_id } = req.query;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = {};
    if (status) where.status = status;
    if (booking_id) where.booking_id = booking_id;

    if (req.user.role !== 'admin') {
      // Users can only see disputes related to their bookings
      const userBookings = await Booking.findAll({
        where: {
          [Op.or]: [
            { coach_id: req.user.id },
            { primary_student_id: req.user.id },
          ],
        },
        attributes: ['id'],
      });
      where.booking_id = userBookings.map(b => b.id);
    }

    const disputes = await Dispute.findAndCountAll({
      where,
      include: [
        { model: Booking, as: 'booking' },
        { model: DisputeType, as: 'disputeType' },
        { model: DisputeResolutionAction, as: 'resolutionAction' },
        { model: User, as: 'admin', attributes: ['id', 'full_name'] },
      ],
      limit: queryLimit,
      offset,
      order: [['opened_at', 'DESC']],
    });

    const response = getPagingData(disputes, page, queryLimit);
    return successResponse(res, response.items, 'Disputes retrieved successfully');
  } catch (error) {
    console.error('Get disputes error:', error);
    return errorResponse(res, 'Failed to retrieve disputes', 500);
  }
};

export const getDisputeById = async (req, res) => {
  try {
    const { id } = req.params;
    const dispute = await Dispute.findByPk(id, {
      include: [
        { model: Booking, as: 'booking' },
        { model: DisputeType, as: 'disputeType' },
        { model: DisputeResolutionAction, as: 'resolutionAction' },
        { model: User, as: 'admin', attributes: ['id', 'full_name'] },
        { model: Payment, as: 'payment' },
      ],
    });

    if (!dispute) {
      return errorResponse(res, 'Dispute not found', 404);
    }

    if (req.user.role !== 'admin') {
      const booking = await Booking.findByPk(dispute.booking_id);
      if (req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id) {
        return errorResponse(res, 'Unauthorized', 403);
      }
    }

    return successResponse(res, dispute, 'Dispute retrieved successfully');
  } catch (error) {
    console.error('Get dispute error:', error);
    return errorResponse(res, 'Failed to retrieve dispute', 500);
  }
};

export const createDispute = async (req, res) => {
  try {
    const { booking_id, dispute_type_id, notes } = req.body;

    const booking = await Booking.findByPk(booking_id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const existingDispute = await Dispute.findOne({
      where: { booking_id, status: { [Op.in]: ['open', 'under_review'] } },
    });

    if (existingDispute) {
      return errorResponse(res, 'Active dispute already exists for this booking', 409);
    }

    const openedBy = req.user.role === 'admin' ? 'admin' :
                     req.user.id === booking.coach_id ? 'coach' : 'student';

    const dispute = await Dispute.create({
      booking_id,
      dispute_type_id,
      opened_by: openedBy,
      status: 'open',
    });

    await logAudit(req.user.id, 'dispute_created', 'disputes', dispute.id, null, dispute.toJSON(), req);

    return successResponse(res, dispute, 'Dispute created successfully', 201);
  } catch (error) {
    console.error('Create dispute error:', error);
    return errorResponse(res, 'Failed to create dispute', 500);
  }
};

export const resolveDispute = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_action_id, resolution_notes } = req.body;

    if (req.user.role !== 'admin') {
      return errorResponse(res, 'Only admins can resolve disputes', 403);
    }

    const dispute = await Dispute.findByPk(id);
    if (!dispute) {
      return errorResponse(res, 'Dispute not found', 404);
    }

    if (dispute.status !== 'open' && dispute.status !== 'under_review') {
      return errorResponse(res, 'Dispute cannot be resolved in current status', 400);
    }

    const beforeState = dispute.toJSON();
    await dispute.update({
      status: 'resolved',
      resolution_action_id,
      resolution_notes,
      admin_id: req.user.id,
      resolved_at: new Date(),
    });

    await logAudit(req.user.id, 'dispute_resolved', 'disputes', dispute.id, beforeState, dispute.toJSON(), req);

    return successResponse(res, dispute, 'Dispute resolved successfully');
  } catch (error) {
    console.error('Resolve dispute error:', error);
    return errorResponse(res, 'Failed to resolve dispute', 500);
  }
};
