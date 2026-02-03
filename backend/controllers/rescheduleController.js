import { RescheduleHistory, Booking, Payment, User } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { affectsReliability, sanitizeResponse } from '../services/reliabilityPenaltyService.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import * as paymentService from '../services/paymentService.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';

export const requestReschedule = async (req, res) => {
  try {
    // booking_id can come from URL parameter (POST /api/bookings/:id/reschedule) or body
    const booking_id = req.params.id || req.validated.booking_id;
    const { new_scheduled_at, reason, reason_notes, paid_reschedule = false } = req.validated;

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

    // For paid reschedules, set approval_status to 'pending' until payment is confirmed
    // For free reschedules, auto-approve immediately
    const approvalStatus = paid_reschedule ? 'pending' : 'auto_approved';

    const rescheduleHistory = await RescheduleHistory.create({
      booking_id,
      requested_by: requestedBy,
      old_scheduled_at: booking.scheduled_at,
      new_scheduled_at: newScheduledDate,
      reason,
      reason_notes: reason_notes || null,
      affects_reliability: willAffectReliability, // Always false for admin
      paid_reschedule,
      approval_status: approvalStatus,
    });

    let paymentIntent = null;

    // If paid reschedule, create PaymentIntent and DO NOT apply reschedule yet
    if (paid_reschedule) {
      try {
        const { payment, paymentIntent: intent } = await paymentService.createPaymentForPaidReschedule(
          booking,
          booking.primary_student_id,
          rescheduleHistory.id
        );

        // Link payment to reschedule history
        await rescheduleHistory.update({ transaction_id: payment.id });
        paymentIntent = intent;
        
        // DO NOT update booking yet - wait for payment confirmation
        // DO NOT increment extra_paid_reschedules yet - wait for payment confirmation
        // The reschedule will be applied in the webhook handler after payment succeeds
      } catch (error) {
        logger.error('Error creating paid reschedule payment:', error);
        // If payment creation fails, reject the reschedule request
        await rescheduleHistory.update({ 
          paid_reschedule: false,
          approval_status: 'rejected',
        });
        return errorResponse(res, 'Failed to create payment for reschedule. Please try again.', 500);
      }
    } else {
      // Free reschedule - apply immediately
      booking.reschedule_count += 1;
      await booking.update({
        scheduled_at: newScheduledDate,
        reschedule_count: booking.reschedule_count,
      });
    }

    await logAudit(req.user.id, 'reschedule_requested', 'reschedule_history', rescheduleHistory.id, null, rescheduleHistory.toJSON(), req);

    // Update reliability score immediately for free reschedules with penalized reasons
    // (Non-penalized reasons like weather/emergency don't affect reliability, so no update needed)
    // Paid reschedules will update reliability after payment is confirmed (when the reschedule is actually applied)
    // Note: Reliability impact is determined by the reason (via affectsReliability()), not by whether it's free or paid
    if (!paid_reschedule && willAffectReliability && requestedBy !== 'admin') {
      const userIdToUpdate = requestedBy === 'coach' ? booking.coach_id : booking.primary_student_id;
      if (userIdToUpdate) {
        // Double-check: ensure we're not updating an admin user
        const userToUpdate = await User.findByPk(userIdToUpdate);
        if (userToUpdate && userToUpdate.role !== 'admin') {
          await updateUserReliability(userIdToUpdate).catch(err => {
            logger.error('Failed to update reliability after reschedule:', err);
          });
        }
      }
    }

    // Sanitize response - remove affects_reliability from frontend
    const sanitizedResponse = sanitizeResponse(rescheduleHistory);

    // Include payment intent if paid reschedule
    const response = { ...sanitizedResponse };
    if (paymentIntent) {
      response.payment_intent = paymentIntent;
    }

    return successResponse(res, response, 'Reschedule requested successfully', 201);
  } catch (error) {
    logger.error('Request reschedule error:', error);
    return errorResponse(res, 'Failed to request reschedule', 500);
  }
};

export const getRescheduleHistory = async (req, res) => {
  try {
    const { booking_id } = req.validated;
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
    logger.error('Get reschedule history error:', error);
    return errorResponse(res, 'Failed to retrieve reschedule history', 500);
  }
};