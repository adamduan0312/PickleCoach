import { Booking, Lesson, User, BookingPlayer, Payment, RescheduleHistory, CancellationHistory, CourtLocation } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { logAudit } from '../utils/audit.js';
import { affectsReliability, sanitizeResponse } from '../services/reliabilityPenaltyService.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import * as paymentService from '../services/paymentService.js';
import { checkBookingAvailability } from '../services/bookingService.js';

export const getBookings = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, coach_id, student_id } = req.query;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = {};
    if (status) where.status = status;
    if (coach_id) where.coach_id = coach_id;
    if (student_id) where.primary_student_id = student_id;

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
    console.error('Get bookings error:', error);
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

    if (req.user.role !== 'admin' && req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id) {
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
    console.error('Get booking error:', error);
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

    if (req.user.role !== 'student' && req.user.role !== 'admin') {
      return errorResponse(res, 'Only students can create bookings', 403);
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

    // Check availability before creating booking (instant booking validation)
    // This checks: 1) Coach availability (coach-maintained schedule)
    //              2) No overlapping bookings (double-booking prevention)
    const finalDuration = duration_minutes || lesson.duration_minutes;
    const availabilityCheck = await checkBookingAvailability(lesson_id, scheduled_at, finalDuration);
    if (!availabilityCheck.available) {
      return errorResponse(res, availabilityCheck.reason || 'Time slot is not available', 400);
    }

    // Calculate reschedule deadline (default: 24 hours before scheduled time)
    const rescheduleDeadline = new Date(scheduledDate.getTime() - 24 * 60 * 60 * 1000);

    const booking = await Booking.create({
      lesson_id,
      coach_id: lesson.coach_id,
      primary_student_id: req.user.id,
      scheduled_at: scheduledDate,
      duration_minutes: duration_minutes || lesson.duration_minutes,
      price: lesson.price,
      court_location_id: court_location_id || null,
      status: 'pending',
      reschedule_deadline: rescheduleDeadline,
    });

    if (player_ids && Array.isArray(player_ids)) {
      const players = player_ids.map(player_id => ({
        booking_id: booking.id,
        player_id,
      }));
      await BookingPlayer.bulkCreate(players);
    }

    // Create payment and PaymentIntent
    const { payment, paymentIntent } = await paymentService.createPaymentForBooking(
      booking,
      req.user.id,
      payment_method
    );

    await logAudit(req.user.id, 'booking_created', 'bookings', booking.id, null, booking.toJSON(), req);

    return successResponse(res, {
      booking,
      payment_intent_client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
    }, 'Booking created successfully', 201);
  } catch (error) {
    console.error('Create booking error:', error);
    return errorResponse(res, 'Failed to create booking', 500);
  }
};

export const updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const booking = await Booking.findByPk(id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (req.user.role !== 'admin' && req.user.id !== booking.coach_id) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const beforeState = booking.toJSON();
    await booking.update({ status });

    await logAudit(req.user.id, 'booking_status_updated', 'bookings', booking.id, beforeState, booking.toJSON(), req);

    return successResponse(res, booking, 'Booking status updated successfully');
  } catch (error) {
    console.error('Update booking status error:', error);
    return errorResponse(res, 'Failed to update booking status', 500);
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
    const cancelledBy = req.user.role === 'admin' ? 'admin' : 
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
        const userToUpdate = await User.findByPk(userIdToUpdate);
        if (userToUpdate && userToUpdate.role !== 'admin') {
          await updateUserReliability(userIdToUpdate).catch(err => {
            console.error('Failed to update reliability after cancellation:', err);
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
        console.error('Error processing refund during cancellation:', refundError);
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
    console.error('Cancel booking error:', error);
    return errorResponse(res, 'Failed to cancel booking', 500);
  }
};
