import { RescheduleHistory, Booking, Payment, User } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { affectsReliability, sanitizeResponse } from '../services/reliabilityPenaltyService.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import { Op } from 'sequelize';

export const requestReschedule = async (req, res) => {
  try {
    const { booking_id, new_scheduled_at, reason, reason_notes, paid_reschedule = false } = req.body;

    // Reason is required and validated by schema
    if (!reason) {
      return errorResponse(res, 'Reason is required for reschedule', 400);
    }

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

    if (!paid_reschedule && booking.reschedule_count >= booking.reschedule_limit) {
      return errorResponse(res, 'Free reschedule limit reached. Please purchase a paid reschedule.', 400);
    }

    const requestedBy = req.user.role === 'admin' ? 'admin' :
                       req.user.id === booking.coach_id ? 'coach' : 'student';

    // Admin actions NEVER affect reliability
    // Only marketplace participant actions (student/coach) can affect reliability
    const willAffectReliability = requestedBy === 'admin' ? false : affectsReliability(reason);

    const rescheduleHistory = await RescheduleHistory.create({
      booking_id,
      requested_by: requestedBy,
      old_scheduled_at: booking.scheduled_at,
      new_scheduled_at: newScheduledDate,
      reason,
      reason_notes: reason_notes || null,
      affects_reliability: willAffectReliability, // Always false for admin
      paid_reschedule,
      approval_status: 'auto_approved', // Auto-approve for now, can be changed to 'pending' if approval workflow needed
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

    // Update reliability ONLY for marketplace participants (coach/student), never for admin
    if (willAffectReliability && requestedBy !== 'admin') {
      const userIdToUpdate = requestedBy === 'coach' ? booking.coach_id : booking.primary_student_id;
      if (userIdToUpdate) {
        // Double-check: ensure we're not updating an admin user
        const userToUpdate = await User.findByPk(userIdToUpdate);
        if (userToUpdate && userToUpdate.role !== 'admin') {
          await updateUserReliability(userIdToUpdate).catch(err => {
            console.error('Failed to update reliability after reschedule:', err);
          });
        }
      }
    }

    // Sanitize response - remove affects_reliability from frontend
    const sanitizedResponse = sanitizeResponse(rescheduleHistory);

    return successResponse(res, sanitizedResponse, 'Reschedule requested successfully', 201);
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

    // Sanitize response - remove affects_reliability from frontend
    const sanitizedResponse = sanitizeResponse(rescheduleHistory);

    return successResponse(res, sanitizedResponse, 'Reschedule approved successfully');
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

    // Sanitize all responses - remove affects_reliability from frontend
    const sanitizedHistory = history.map(record => sanitizeResponse(record));

    return successResponse(res, sanitizedHistory, 'Reschedule history retrieved successfully');
  } catch (error) {
    console.error('Get reschedule history error:', error);
    return errorResponse(res, 'Failed to retrieve reschedule history', 500);
  }
};
