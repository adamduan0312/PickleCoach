import { RescheduleHistory, Booking, Payment } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { Op } from 'sequelize';

export const requestReschedule = async (req, res) => {
  try {
    const { booking_id, new_scheduled_at, reason, paid_reschedule = false } = req.body;

    const booking = await Booking.findByPk(booking_id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    if (['completed', 'cancelled'].includes(booking.status)) {
      return errorResponse(res, 'Cannot reschedule completed or cancelled booking', 400);
    }

    const newScheduledDate = new Date(new_scheduled_at);
    if (newScheduledDate < new Date()) {
      return errorResponse(res, 'Cannot reschedule to the past', 400);
    }

    const totalReschedules = booking.reschedule_count + booking.extra_paid_reschedules;
    const maxReschedules = booking.reschedule_limit + booking.extra_paid_reschedules;

    if (!paid_reschedule && booking.reschedule_count >= booking.reschedule_limit) {
      return errorResponse(res, 'Free reschedule limit reached. Please purchase a paid reschedule.', 400);
    }

    const requestedBy = req.user.role === 'admin' ? 'admin' :
                       req.user.id === booking.coach_id ? 'coach' : 'student';

    const rescheduleHistory = await RescheduleHistory.create({
      booking_id,
      requested_by: requestedBy,
      old_scheduled_at: booking.scheduled_at,
      new_scheduled_at: newScheduledDate,
      reason,
      paid_reschedule,
      approval_status: 'pending',
    });

    if (paid_reschedule) {
      booking.extra_paid_reschedules += 1;
    } else {
      booking.reschedule_count += 1;
    }

    await booking.update({
      scheduled_at: newScheduledDate,
      reschedule_count: booking.reschedule_count,
      extra_paid_reschedules: booking.extra_paid_reschedules,
    });

    await logAudit(req.user.id, 'reschedule_requested', 'reschedule_history', rescheduleHistory.id, null, rescheduleHistory.toJSON(), req);

    return successResponse(res, rescheduleHistory, 'Reschedule requested successfully', 201);
  } catch (error) {
    console.error('Request reschedule error:', error);
    return errorResponse(res, 'Failed to request reschedule', 500);
  }
};

export const approveReschedule = async (req, res) => {
  try {
    const { id } = req.params;
    const rescheduleHistory = await RescheduleHistory.findByPk(id, {
      include: [{ model: Booking, as: 'booking' }],
    });

    if (!rescheduleHistory) {
      return errorResponse(res, 'Reschedule request not found', 404);
    }

    if (rescheduleHistory.approval_status !== 'pending') {
      return errorResponse(res, 'Reschedule already processed', 400);
    }

    if (req.user.role !== 'admin' && 
        req.user.id !== rescheduleHistory.booking.coach_id && 
        req.user.id !== rescheduleHistory.booking.primary_student_id) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    await rescheduleHistory.update({
      approval_status: 'approved',
      approved_by: req.user.id,
      approved_at: new Date(),
    });

    await rescheduleHistory.booking.update({
      scheduled_at: rescheduleHistory.new_scheduled_at,
    });

    await logAudit(req.user.id, 'reschedule_approved', 'reschedule_history', rescheduleHistory.id, null, rescheduleHistory.toJSON(), req);

    return successResponse(res, rescheduleHistory, 'Reschedule approved successfully');
  } catch (error) {
    console.error('Approve reschedule error:', error);
    return errorResponse(res, 'Failed to approve reschedule', 500);
  }
};

export const getRescheduleHistory = async (req, res) => {
  try {
    const { booking_id } = req.query;
    const where = {};
    if (booking_id) where.booking_id = booking_id;

    const history = await RescheduleHistory.findAll({
      where,
      include: [
        { model: Booking, as: 'booking' },
        { model: Payment, as: 'transaction' },
      ],
      order: [['requested_at', 'DESC']],
    });

    return successResponse(res, history, 'Reschedule history retrieved successfully');
  } catch (error) {
    console.error('Get reschedule history error:', error);
    return errorResponse(res, 'Failed to retrieve reschedule history', 500);
  }
};
