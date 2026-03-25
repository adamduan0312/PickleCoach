import { sequelize, Booking, Lesson, User, UserRole, BookingPlayer, Payment, RescheduleHistory, CancellationHistory, CourtLocation } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { logAudit } from '../utils/audit.js';
import { affectsReliability, sanitizeResponse } from '../services/reliabilityPenaltyService.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import * as paymentService from '../services/paymentService.js';
import { checkBookingAvailability } from '../services/bookingService.js';
import { logger } from '../config/logger.js';

/** In dev, return clear error detail; if Stripe API key error, clarify it's server-side STRIPE_SECRET_KEY. */
function getCreateBookingErrorDetail(error, isDev) {
  if (!isDev) return null;
  const raw = error?.message || String(error);
  const isStripeKeyError = /api key|Authorization header|STRIPE|Bearer YOUR_SECRET_KEY/i.test(raw);
  if (isStripeKeyError) {
    return {
      detail: raw,
      hint: 'This is Stripe\'s error. The "Authorization header" refers to the request this server makes to Stripe, not your request to this API. Set STRIPE_SECRET_KEY in .env.development (or your env file) so the server can authenticate to Stripe. Do not put the Stripe key in your own Authorization header.',
    };
  }
  return { detail: raw };
}

export const getBookings = async (req, res) => {
  try {
    const { page, limit, status, coach_id, student_id } = req.validated;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = {};
    if (status) where.status = status;

    if (!(req.user.roles || []).includes('admin')) {
      where[Op.or] = [{ coach_id: req.user.id }, { primary_student_id: req.user.id }];
    } else {
      if (coach_id) where.coach_id = coach_id;
      if (student_id) where.primary_student_id = student_id;
    }

    const bookings = await Booking.findAndCountAll({
      where,
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: CourtLocation, as: 'courtLocation' },
      ],
      limit: queryLimit,
      offset,
      order: [['scheduled_at', 'DESC']],
    });

    const response = getPagingData(bookings, page, queryLimit);
    return successResponse(res, response.items, 'Bookings retrieved successfully');
  } catch (error) {
    logger.error('Get bookings error:', error);
    return errorResponse(res, 'Failed to retrieve bookings', 500);
  }
};

export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: CourtLocation, as: 'courtLocation' },
        { model: BookingPlayer, as: 'players', include: [{ model: User, as: 'player', attributes: ['id', 'full_name'] }] },
        { model: Payment, as: 'payments' },
        { model: RescheduleHistory, as: 'rescheduleHistory', order: [['requested_at', 'DESC']] },
        { model: CancellationHistory, as: 'cancellationHistory', order: [['cancelled_at', 'DESC']] },
      ],
    });

    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    const isParticipant = req.user.id === booking.coach_id || req.user.id === booking.primary_student_id;
    if (!isParticipant && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    // Sanitize reschedule history - remove affects_reliability from frontend
    const bookingJson = booking.toJSON();
    if (bookingJson.rescheduleHistory && Array.isArray(bookingJson.rescheduleHistory)) {
      bookingJson.rescheduleHistory = bookingJson.rescheduleHistory.map(record => sanitizeResponse(record));
    }
    if (bookingJson.cancellationHistory && Array.isArray(bookingJson.cancellationHistory)) {
      bookingJson.cancellationHistory = bookingJson.cancellationHistory.map(record => sanitizeResponse(record));
    }

    return successResponse(res, bookingJson, 'Booking retrieved successfully');
  } catch (error) {
    logger.error('Get booking error:', error);
    return errorResponse(res, 'Failed to retrieve booking', 500);
  }
};

export const createBooking = async (req, res) => {
  try {
    const { lesson_id, scheduled_at, duration_minutes, player_ids, court_location_id, payment_method = 'stripe' } = req.validated;

    const lesson = await Lesson.findByPk(lesson_id);
    if (!lesson || !lesson.is_active) {
      return errorResponse(res, 'Lesson not found or inactive', 404);
    }

    const roles = req.user.roles || [];
    if (!roles.includes('student') && !roles.includes('admin')) {
      return errorResponse(res, 'Only students can create bookings', 403);
    }

    // Coach and student must be different users (no self-booking)
    if (lesson.coach_id === req.user.id) {
      return errorResponse(res, 'You cannot book your own lesson. Coach and student must be different users.', 400);
    }

    const scheduledDate = new Date(scheduled_at);
    if (scheduledDate < new Date()) {
      return errorResponse(res, 'Cannot book in the past', 400);
    }

    // Validate court location if provided
    if (court_location_id) {
      const court = await CourtLocation.findByPk(court_location_id);
      if (!court || court.deleted_at) {
        return errorResponse(res, 'Court location not found', 404);
      }
    }

    // Check availability before creating booking. Prevents double-booking so the coach never has to fix it.
    // 1) Coach availability (coach-maintained schedule)
    // 2) Existing bookings for this lesson in this time range (pending, confirmed, awaiting_verification)
    // If another student already has that slot, we reject with 400 and a clear message—no second booking is created.
    const finalDuration = duration_minutes || lesson.duration_minutes;
    const availabilityCheck = await checkBookingAvailability(lesson_id, scheduled_at, finalDuration);
    if (!availabilityCheck.available) {
      return errorResponse(res, availabilityCheck.reason || 'This time slot is no longer available.', 400);
    }

    // Calculate reschedule deadline (default: 24 hours before scheduled time)
    const rescheduleDeadline = new Date(scheduledDate.getTime() - 24 * 60 * 60 * 1000);

    const transaction = await sequelize.transaction();
    let booking;
    let paymentIntent;
    try {
      booking = await Booking.create({
        lesson_id,
        coach_id: lesson.coach_id,
        primary_student_id: req.user.id,
        scheduled_at: scheduledDate,
        duration_minutes: duration_minutes || lesson.duration_minutes,
        price: lesson.price,
        court_location_id: court_location_id || null,
        status: 'pending',
        reschedule_deadline: rescheduleDeadline,
      }, { transaction });

      if (player_ids && Array.isArray(player_ids)) {
        const players = player_ids.map(player_id => ({
          booking_id: booking.id,
          player_id,
        }));
        await BookingPlayer.bulkCreate(players, { transaction });
      }

      // Create payment and PaymentIntent (payment creation uses same transaction; if Stripe fails we roll back)
      const result = await paymentService.createPaymentForBooking(
        booking,
        req.user.id,
        payment_method,
        { transaction }
      );
      paymentIntent = result.paymentIntent;

      await transaction.commit();
    } catch (txError) {
      await transaction.rollback();
      const errMsg = (txError?.message || String(txError)) + (txError?.stack ? '\n' + txError.stack : '');
      logger.error('Create booking error: ' + errMsg);
      if (!res.headersSent) {
        const isDev = process.env.NODE_ENV !== 'production';
        return errorResponse(res, 'Failed to create booking', 500, isDev ? getCreateBookingErrorDetail(txError, true) : null);
      }
      return;
    }

    await logAudit(req.user.id, 'booking_created', 'bookings', booking.id, null, booking.get({ plain: true }), req);

    // Use plain object so res.json() never fails on Sequelize model serialization
    const bookingData = booking.get({ plain: true });
    const payload = {
      booking: bookingData,
      payment_intent_client_secret: paymentIntent?.client_secret ?? null,
      payment_intent_id: paymentIntent?.id ?? null,
    };
    try {
      return successResponse(res, payload, 'Booking created successfully', 201);
    } catch (responseError) {
      const errMsg = (responseError?.message || String(responseError)) + (responseError?.stack ? '\n' + responseError.stack : '');
      logger.error('Create booking response send error: ' + errMsg);
      if (!res.headersSent) {
        const isDev = process.env.NODE_ENV !== 'production';
        return errorResponse(res, 'Failed to create booking', 500, isDev ? getCreateBookingErrorDetail(responseError, true) : null);
      }
    }
  } catch (error) {
    const errMsg = (error?.message || String(error)) + (error?.stack ? '\n' + error.stack : '');
    logger.error('Create booking error: ' + errMsg);
    if (!res.headersSent) {
      const isDev = process.env.NODE_ENV !== 'production';
      return errorResponse(res, 'Failed to create booking', 500, isDev ? getCreateBookingErrorDetail(error, true) : null);
    }
  }
};

// Valid status transitions for Update Booking Status (coach/admin). pending → confirmed/cancelled only via accept/decline endpoints.
const BOOKING_STATUS_TRANSITIONS = {
  pending: [], // Use POST /bookings/:id/accept or POST /bookings/:id/decline
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
  awaiting_verification: ['completed', 'cancelled'],
  disputed: [],
};

export const updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.validated;

    const booking = await Booking.findByPk(id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (!(req.user.roles || []).includes('admin') && req.user.id !== booking.coach_id) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const currentStatus = booking.status;
    const allowed = BOOKING_STATUS_TRANSITIONS[currentStatus];
    if (allowed == null || !allowed.includes(status)) {
      return errorResponse(
        res,
        `Invalid transition: cannot change status from '${currentStatus}' to '${status}'. Allowed: ${allowed?.length ? allowed.join(', ') : 'none'}.`,
        400
      );
    }

    // Coach can only mark completed after the lesson end time has passed (prevents marking done before lesson)
    if (status === 'completed') {
      const lessonEndMs = new Date(booking.scheduled_at).getTime() + (booking.duration_minutes || 0) * 60 * 1000;
      if (Date.now() < lessonEndMs) {
        return errorResponse(
          res,
          'Cannot mark booking as completed before the lesson end time. Wait until the lesson has finished.',
          400
        );
      }
    }

    const beforeState = booking.toJSON();
    const updatePayload = { status };
    if (status === 'completed') {
      updatePayload.payout_status = 'pending';
    }
    await booking.update(updatePayload);

    await logAudit(req.user.id, 'booking_status_updated', 'bookings', booking.id, beforeState, booking.toJSON(), req);

    return successResponse(res, booking, 'Booking status updated successfully');
  } catch (error) {
    logger.error('Update booking status error:', error);
    return errorResponse(res, 'Failed to update booking status', 500);
  }
};

/**
 * Coach (or admin) accepts a pending booking. Captures payment and sets status to confirmed.
 * Enterprise flow: coach must confirm before the booking is final.
 */
export const acceptBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);
    if (booking.status !== 'pending') {
      return errorResponse(res, `Booking is not pending (status: ${booking.status}). Only pending bookings can be accepted.`, 400);
    }
    if (!(req.user.roles || []).includes('admin') && req.user.id !== booking.coach_id) {
      return errorResponse(res, 'Only the coach or an admin can accept this booking', 403);
    }

    const payment = await Payment.findOne({ where: { booking_id: booking.id }, order: [['id', 'DESC']] });
    if (payment) {
      await paymentService.capturePaymentOnCoachAccept(payment.id);
    } else {
      await booking.update({ status: 'confirmed', messaging_locked: false });
      await logAudit(req.user.id, 'booking_confirmed_by_coach', 'bookings', booking.id, null, { status: 'confirmed' }, req);
    }

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'avatar_url'] },
      ],
    });
    return successResponse(res, updated, 'Booking accepted and confirmed');
  } catch (error) {
    logger.error('Accept booking error:', error);
    const message = error.message || 'Failed to accept booking';
    const code = message.includes('not pending') ? 400 : 500;
    return errorResponse(res, message, code);
  }
};

/**
 * Coach (or admin) declines a pending booking. Cancels PaymentIntent (no charge) and sets booking to cancelled.
 * Optional message_to_student is shown to the student (e.g. "Something came up—please book another slot").
 * Optional decline_reason_code for analytics (e.g. availability_wrong, sick, other).
 */
export const declineBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { message_to_student, decline_reason_code } = req.validated || {};
    const booking = await Booking.findByPk(id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);
    if (booking.status !== 'pending') {
      return errorResponse(res, `Booking is not pending (status: ${booking.status}). Only pending bookings can be declined.`, 400);
    }
    if (!(req.user.roles || []).includes('admin') && req.user.id !== booking.coach_id) {
      return errorResponse(res, 'Only the coach or an admin can decline this booking', 403);
    }

    const payment = await Payment.findOne({ where: { booking_id: booking.id }, order: [['id', 'DESC']] });
    if (payment) {
      await paymentService.cancelPaymentOnCoachDecline(payment.id);
    } else {
      await booking.update({
        status: 'cancelled',
        cancelled_by: 'coach',
        cancelled_at: new Date(),
      });
      await logAudit(req.user.id, 'booking_declined_by_coach', 'bookings', booking.id, null, { status: 'cancelled' }, req);
    }

    const now = new Date();
    const noteToStore = (message_to_student && message_to_student.trim()) ? message_to_student.trim() : null;
    const codeToStore = (decline_reason_code && decline_reason_code.trim()) ? decline_reason_code.trim() : null;
    await booking.update({
      declined_at: now,
      decline_message_to_student: noteToStore,
      decline_reason_code: codeToStore,
    });

    await CancellationHistory.create({
      booking_id: booking.id,
      cancelled_by: 'coach',
      reason: 'other',
      reason_notes: (noteToStore || 'Coach declined').substring(0, 255),
      affects_reliability: false,
      refund_amount: 0,
      penalty_amount: 0,
    });

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'avatar_url'] },
      ],
    });
    return successResponse(res, {
      booking: updated,
      message_to_student: noteToStore,
      system_note: 'You weren\'t charged. You can pick another time.',
    }, 'Booking declined');
  } catch (error) {
    logger.error('Decline booking error:', error);
    const message = error.message || 'Failed to decline booking';
    const code = message.includes('not pending') ? 400 : 500;
    return errorResponse(res, message, code);
  }
};

export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reason_notes } = req.validated;

    // Reason is required and validated by schema
    if (!reason) {
      return errorResponse(res, 'Reason is required for cancellation', 400);
    }

    const booking = await Booking.findByPk(id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (['completed', 'cancelled'].includes(booking.status)) {
      return errorResponse(res, 'Booking cannot be cancelled', 400);
    }

    // Determine who is cancelling
    const cancelledBy = (req.user.roles || []).includes('admin') ? 'admin' :
                       req.user.id === booking.coach_id ? 'coach' : 'student';

    // Admin cancellations NEVER affect reliability
    // Only marketplace participant actions (student/coach) can affect reliability
    const willAffectReliability = cancelledBy === 'admin' ? false : affectsReliability(reason);

    // Calculate if cancellation is late (within 24 hours BEFORE scheduled time, not after)
    const hoursUntilBooking = (new Date(booking.scheduled_at) - new Date()) / (1000 * 60 * 60);
    const isLateCancel = hoursUntilBooking >= 0 && hoursUntilBooking < 24;

    // Calculate refund and penalty amounts (basic implementation - can be enhanced)
    let refund_amount = 0;
    let penalty_amount = 0;
    let penalty_reason = null;

    // If late cancellation by student, may apply penalty
    if (isLateCancel && cancelledBy === 'student') {
      // For now, refund 50% for late cancellations, but this can be configured per business rules
      refund_amount = booking.price * 0.5;
      penalty_amount = booking.price * 0.5;
      penalty_reason = 'Late cancellation';
    } else if (cancelledBy === 'coach') {
      // Coach cancellations typically get full refund to student
      refund_amount = booking.price;
      penalty_reason = 'Coach cancellation';
    } else {
      // Early student cancellation gets full refund
      refund_amount = booking.price;
    }

    // Create cancellation history record
    const cancellationHistory = await CancellationHistory.create({
      booking_id: booking.id,
      cancelled_by: cancelledBy,
      reason,
      reason_notes: reason_notes || null,
      affects_reliability: willAffectReliability, // Always false for admin
      refund_amount,
      penalty_amount,
      penalty_reason,
    });

    const beforeState = booking.toJSON();
    await booking.update({
      status: 'cancelled',
      cancelled_by: cancelledBy,
      cancelled_at: new Date(),
      // Lock messaging after cancellation
      messaging_locked: true,
    });

    await logAudit(req.user.id, 'booking_cancelled', 'bookings', booking.id, beforeState, booking.toJSON(), req);
    await logAudit(req.user.id, 'cancellation_recorded', 'cancellation_history', cancellationHistory.id, null, cancellationHistory.toJSON(), req);

    // Update reliability ONLY for marketplace participants (coach/student), never for admin
    if (willAffectReliability && cancelledBy !== 'admin') {
      const userIdToUpdate = cancelledBy === 'coach' ? booking.coach_id : booking.primary_student_id;
      if (userIdToUpdate) {
        // Double-check: ensure we're not updating an admin user
        const userToUpdate = await User.findByPk(userIdToUpdate, {
          include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
        });
        const updateRoles = userToUpdate?.userRoles?.map((r) => r.role) ?? [];
        if (userToUpdate && !updateRoles.includes('admin')) {
          await updateUserReliability(userIdToUpdate).catch(err => {
            logger.error('Failed to update reliability after cancellation:', err);
          });
        }
      }
    }

    // Process refund if applicable
    if (refund_amount > 0) {
      try {
        // Find the payment for this booking
        const payment = await Payment.findOne({
          where: { booking_id: booking.id },
        });

        if (payment && payment.charge_id && payment.payment_status === 'captured') {
          // Process refund through payment service
          await paymentService.processRefund(
            payment.id,
            refund_amount,
            cancelledBy === 'coach' ? 'coach_cancellation' : 'student_cancellation'
          );
          
          // Update cancellation history with refund payment ID
          await cancellationHistory.update({
            refund_payment_id: payment.id,
          });
        }
      } catch (refundError) {
        // Log error but don't fail the cancellation
        logger.error('Error processing refund during cancellation:', refundError);
        // The cancellation is still recorded, refund can be processed manually later
      }
    }

    // Sanitize response - remove affects_reliability from frontend
    const sanitizedCancellation = sanitizeResponse(cancellationHistory);

    return successResponse(res, {
      booking: booking.toJSON(),
      cancellation: sanitizedCancellation,
    }, 'Booking cancelled successfully');
  } catch (error) {
    logger.error('Cancel booking error:', error);
    return errorResponse(res, 'Failed to cancel booking', 500);
  }
};
