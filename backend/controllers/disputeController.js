import { Dispute, Booking, DisputeType, DisputeResolutionAction, User, Payment } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import * as paymentService from '../services/paymentService.js';

const MAX_LIST_ALL_DISPUTES = 10000;

/** Public dispute JSON: resolver is only `resolved_by_admin` (id + full_name); DB `admin_id` / `admin` are not exposed. */
function formatDisputeResponse(dispute) {
  if (!dispute) return dispute;
  const json = typeof dispute.toJSON === 'function' ? dispute.toJSON() : dispute;
  const { admin, admin_id, ...rest } = json;
  return {
    ...rest,
    resolved_by_admin: admin ?? null,
  };
}

export const getDisputes = async (req, res) => {
  try {
    const { page, limit, status, booking_id } = req.validated;

    const where = {};
    if (status) where.status = status;
    if (booking_id) where.booking_id = booking_id;

    if (!(req.user.roles || []).includes('admin')) {
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

    if (page == null && limit == null) {
      const disputes = await Dispute.findAll({
        where,
        include: [
          { model: Booking, as: 'booking' },
          { model: DisputeType, as: 'disputeType' },
          { model: DisputeResolutionAction, as: 'resolutionAction' },
          { model: User, as: 'admin', attributes: ['id', 'full_name'] },
        ],
        limit: MAX_LIST_ALL_DISPUTES,
        order: [['opened_at', 'DESC']],
      });
      return successResponse(res, disputes.map(formatDisputeResponse), 'Disputes retrieved successfully');
    }

    const { limit: queryLimit, offset } = getPagination(page, limit);

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
    return paginatedResponse(
      res,
      response.items.map(formatDisputeResponse),
      response.pagination,
      'Disputes retrieved successfully',
    );
  } catch (error) {
    logger.error('Get disputes error:', error);
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

    if (!(req.user.roles || []).includes('admin')) {
      const booking = await Booking.findByPk(dispute.booking_id);
      if (req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id) {
        return errorResponse(res, 'Unauthorized', 403);
      }
    }

    return successResponse(res, formatDisputeResponse(dispute), 'Dispute retrieved successfully');
  } catch (error) {
    logger.error('Get dispute error:', error);
    return errorResponse(res, 'Failed to retrieve dispute', 500);
  }
};

export const createDispute = async (req, res) => {
  try {
    const { booking_id, dispute_type_id, notes } = req.validated;

    const booking = await Booking.findByPk(booking_id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    const uid = Number(req.user.id);
    const coachId = Number(booking.coach_id);
    const studentId =
      booking.primary_student_id != null ? Number(booking.primary_student_id) : null;
    const isAdmin = (req.user.roles || []).includes('admin');

    if (uid !== coachId && uid !== studentId && !isAdmin) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const disputeType = await DisputeType.findByPk(dispute_type_id);
    if (!disputeType) {
      return errorResponse(
        res,
        'Invalid dispute_type_id: that dispute type does not exist. Ensure migrations have run (including seed for dispute_types) or use an id that exists in the dispute_types table.',
        400,
      );
    }

    const existingDispute = await Dispute.findOne({
      where: { booking_id, status: { [Op.in]: ['open', 'under_review'] } },
    });

    if (existingDispute) {
      return errorResponse(res, 'Active dispute already exists for this booking', 409);
    }

    const openedBy = isAdmin ? 'admin' : uid === coachId ? 'coach' : 'student';

    const dispute = await Dispute.create({
      booking_id,
      dispute_type_id,
      notes: notes != null && String(notes).trim() !== '' ? String(notes).trim() : null,
      opened_by: openedBy,
      status: 'open',
    });

    await logAudit(req.user.id, 'dispute_created', 'disputes', dispute.id, null, dispute.toJSON(), req);

    return successResponse(res, formatDisputeResponse(dispute), 'Dispute created successfully', 201);
  } catch (error) {
    logger.error('Create dispute error:', error);
    const mysqlFkChildRow =
      error.name === 'SequelizeForeignKeyConstraintError' ||
      (error.name === 'SequelizeDatabaseError' && error.parent?.errno === 1452);
    if (mysqlFkChildRow) {
      return errorResponse(
        res,
        'Invalid booking_id or dispute_type_id (foreign key constraint)',
        400,
      );
    }
    const message =
      process.env.NODE_ENV === 'development' && error?.message
        ? error.message
        : 'Failed to create dispute';
    return errorResponse(res, message, 500);
  }
};

export const resolveDispute = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_action_id, resolution_notes, refund_amount } = req.validated;

    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Only admins can resolve disputes', 403);
    }

    const dispute = await Dispute.findByPk(id);
    if (!dispute) {
      return errorResponse(res, 'Dispute not found', 404);
    }

    if (dispute.status !== 'open' && dispute.status !== 'under_review') {
      const current = dispute.status;
      const message =
        current === 'resolved'
          ? 'Dispute is already resolved'
          : current === 'rejected'
            ? 'Dispute was rejected and cannot be resolved'
            : 'Dispute cannot be resolved in current status';
      return errorResponse(res, message, 400, null, { current_status: current });
    }

    const resolutionAction = await DisputeResolutionAction.findByPk(resolution_action_id);
    if (!resolutionAction) {
      return errorResponse(
        res,
        'Invalid resolution_action_id: row does not exist in dispute_resolution_actions (seed reference data or use a valid id)',
        400,
      );
    }
    if (resolutionAction.code === 'partial_refund' && refund_amount == null) {
      return errorResponse(
        res,
        'refund_amount is required when resolving with partial_refund',
        400,
        null,
        { code: 'refund_amount_required' },
      );
    }

    /** Money back to student (Stripe) before persisting resolution when action requires it. */
    let refundSummary = null;
    if (resolutionAction?.requires_payout_adjustment) {
      const refundState = await paymentService.getLatestBookingRefundState(dispute.booking_id);
      if (refundState.hasAnyRefund) {
        logger.warn({
          component: 'payments',
          event: 'mixed_refund_path_blocked_dispute_resolution',
          disputeId: dispute.id,
          bookingId: dispute.booking_id,
          paymentId: refundState.payment?.id ?? null,
          refundedSoFarCents: refundState.refundedSoFarCents,
          hasPendingRefund: refundState.hasPendingRefund,
        });
        return errorResponse(
          res,
          'A refund already exists for this booking. To avoid double refund paths, resolve this dispute with no_action or issue only the remaining refund through one path.',
          409,
          null,
          { code: 'refund_path_already_used' },
        );
      }

      try {
        const initiated = await paymentService.initiateBookingRefundForDisputeResolution({
          bookingId: dispute.booking_id,
          disputeId: dispute.id,
          action: resolutionAction,
          refundAmountDollars: refund_amount ?? null,
        });
        if (initiated) {
          refundSummary = {
            payment_id: initiated.payment.id,
            refund_amount: paymentService.centsToDecimalString(initiated.refundCents),
            refund_status: initiated.payment.refund_status || 'pending',
            stripe_refund_id: initiated.refund?.id ?? null,
          };
          await logAudit(
            req.user.id,
            'dispute_resolution_refund_initiated',
            'bookings',
            dispute.booking_id,
            null,
            {
              dispute_id: dispute.id,
              resolution_action_id: resolutionAction.id,
              resolution_action_code: resolutionAction.code,
              payment_id: initiated.payment.id,
              refund_cents: initiated.refundCents,
            },
            req,
          );
        }
      } catch (refundErr) {
        logger.error('Dispute resolution refund failed:', refundErr);
        const msg = refundErr.message || 'Refund failed';
        const clientError =
          /required|not found|no Stripe charge|No refundable|must be at least|exceeds remaining balance/i.test(
            msg,
          );
        return errorResponse(res, msg, clientError ? 400 : 502);
      }
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

    // Reliability recompute runs only for reliability-eligible dispute types.
    // Extra safety gate on top of reliabilityService filtering.
    const disputeType = await DisputeType.findByPk(dispute.dispute_type_id, {
      attributes: ['code', 'affects_reliability_score'],
    });
    if (
      Boolean(disputeType?.affects_reliability_score) &&
      ['coach_no_show', 'late_arrival', 'misconduct', 'lesson_not_completed'].includes(disputeType.code)
    ) {
      const booking = await Booking.findByPk(dispute.booking_id, {
        attributes: ['id', 'coach_id', 'primary_student_id'],
      });
      if (booking) {
        if (dispute.opened_by === 'student' && booking.coach_id != null) {
          await updateUserReliability(booking.coach_id, 'coach').catch((err) =>
            logger.error('Failed to update coach reliability after dispute resolved:', err),
          );
        } else if (dispute.opened_by === 'coach' && booking.primary_student_id != null) {
          await updateUserReliability(booking.primary_student_id, 'student').catch((err) =>
            logger.error('Failed to update student reliability after dispute resolved:', err),
          );
        }
      }
    }

    await dispute.reload({
      include: [{ model: User, as: 'admin', attributes: ['id', 'full_name'] }],
    });

    const payload = {
      dispute: formatDisputeResponse(dispute),
      ...(refundSummary && { refund: refundSummary }),
    };

    return successResponse(res, payload, 'Dispute resolved successfully');
  } catch (error) {
    logger.error('Resolve dispute error:', error);
    // MySQL often surfaces child-row FK failures as SequelizeDatabaseError (errno 1452), not ForeignKeyConstraintError.
    const mysqlFkChildRow =
      error.name === 'SequelizeForeignKeyConstraintError' ||
      (error.name === 'SequelizeDatabaseError' && error.parent?.errno === 1452);
    if (mysqlFkChildRow) {
      return errorResponse(
        res,
        'Invalid resolution_action_id or related reference (foreign key constraint)',
        400,
      );
    }
    const message =
      process.env.NODE_ENV === 'development' && error?.message
        ? error.message
        : 'Failed to resolve dispute';
    return errorResponse(res, message, 500);
  }
};
