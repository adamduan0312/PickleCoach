import { RescheduleHistory, Booking, Payment, User, UserRole } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { affectsReliability, sanitizeResponse } from '../services/reliabilityPenaltyService.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import * as paymentService from '../services/paymentService.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';

export const requestReschedule = async (req, res) => {
  try {
    // booking_id comes from URL parameter (POST /api/bookings/:id/reschedule)
    const booking_id = req.params.id;
    const { new_scheduled_at, reason, reason_notes, paid_reschedule: paidRescheduleRequested = false } = req.validated;

    // Reason is required and validated by schema
    if (!reason) {
      return errorResponse(res, 'Reason is required for reschedule', 400);
    }

    const booking = await Booking.findByPk(booking_id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    if (['completed', 'cancelled'].includes(booking.status)) {
      return errorResponse(res, 'Cannot reschedule completed or cancelled booking', 400);
    }

    const newScheduledDate = new Date(new_scheduled_at);
    if (newScheduledDate < new Date()) {
      return errorResponse(res, 'Cannot reschedule to the past', 400);
    }

    const requestedBy = (req.user.roles || []).includes('admin') ? 'admin' :
                       req.user.id === booking.coach_id ? 'coach' : 'student';

    // Admin actions NEVER affect reliability
    // Only marketplace participant actions (student/coach) can affect reliability
    const willAffectReliability = requestedBy === 'admin' ? false : affectsReliability(reason);

    // Enforce business rules server-side (never trust `paid_reschedule` from the client blindly):
    // - Non-penalized reasons are ALWAYS free (no payment).
    // - Penalized reasons are free until `reschedule_count >= reschedule_limit`.
    // - Paid reschedules are only allowed when:
    //   (a) reason is penalized (willAffectReliability === true)
    //   (b) free penalized slot is used up (limit reached)
    //   (c) client explicitly requested paid_reschedule === true
    let paidRescheduleEffective = false;
    if (willAffectReliability) {
      const limitReached = booking.reschedule_count >= booking.reschedule_limit;
      if (limitReached) {
        // If the free slot is used up, allow paid only if the client requested it.
        paidRescheduleEffective = !!paidRescheduleRequested;
        if (!paidRescheduleEffective) {
          return errorResponse(res, 'Free reschedule limit reached. Please purchase a paid reschedule.', 400);
        }
      } else {
        // Free penalized slots remain; treat as free even if the client asked for paid.
        paidRescheduleEffective = false;
      }
    } else {
      // Non-penalized reasons are always free (ignore any client paid_reschedule request).
      paidRescheduleEffective = false;
    }

    // For paid reschedules, set approval_status to 'pending' until payment is confirmed
    // For free reschedules, auto-approve immediately
    const approvalStatus = paidRescheduleEffective ? 'pending' : 'auto_approved';

    const rescheduleHistory = await RescheduleHistory.create({
      booking_id,
      requested_by: requestedBy,
      old_scheduled_at: booking.scheduled_at,
      new_scheduled_at: newScheduledDate,
      reason,
      reason_notes: reason_notes || null,
      affects_reliability: willAffectReliability, // Always false for admin
      paid_reschedule: paidRescheduleEffective,
      approval_status: approvalStatus,
    });

    let paymentIntent = null;

    // If paid reschedule, create PaymentIntent and DO NOT apply reschedule yet
    if (paidRescheduleEffective) {
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
      // Free reschedule - apply immediately. Only penalized reasons consume the free reschedule.
      const newRescheduleCount = willAffectReliability ? booking.reschedule_count + 1 : booking.reschedule_count;
      await booking.update({
        scheduled_at: newScheduledDate,
        reschedule_count: newRescheduleCount,
      });
    }

    await logAudit(req.user.id, 'reschedule_requested', 'reschedule_history', rescheduleHistory.id, null, rescheduleHistory.toJSON(), req);

    // Update reliability score immediately for free reschedules with penalized reasons
    // (Non-penalized reasons like weather/emergency don't affect reliability, so no update needed)
    // Paid reschedules will update reliability after payment is confirmed (when the reschedule is actually applied)
    // Note: Reliability impact is determined by the reason (via affectsReliability()), not by whether it's free or paid
    if (!paidRescheduleEffective && willAffectReliability && requestedBy !== 'admin') {
      const userIdToUpdate = requestedBy === 'coach' ? booking.coach_id : booking.primary_student_id;
      if (userIdToUpdate) {
        // Double-check: ensure we're not updating an admin user
        const userToUpdate = await User.findByPk(userIdToUpdate, {
          include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
        });
        const updateRoles = userToUpdate?.userRoles?.map((r) => r.role) ?? [];
        if (userToUpdate && !updateRoles.includes('admin')) {
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

    if (!(req.user.roles || []).includes('admin')) {
      const userBookings = await Booking.findAll({
        where: {
          [Op.or]: [
            { coach_id: req.user.id },
            { primary_student_id: req.user.id },
          ],
        },
        attributes: ['id'],
      });
      const bookingIds = userBookings.map(b => b.id);
      if (booking_id) {
        if (!bookingIds.includes(parseInt(booking_id, 10))) {
          return successResponse(res, [], 'Reschedule history retrieved successfully');
        }
      } else {
        where.booking_id = bookingIds.length ? bookingIds : [-1];
      }
    }

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