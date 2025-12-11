import { Booking, Lesson, User, BookingPlayer, Payment, RescheduleHistory, CourtLocation } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { logAudit } from '../utils/audit.js';
import * as paymentService from '../services/paymentService.js';

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
      ],
    });

    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (req.user.role !== 'admin' && req.user.id !== booking.coach_id && req.user.id !== booking.primary_student_id) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    return successResponse(res, booking, 'Booking retrieved successfully');
  } catch (error) {
    console.error('Get booking error:', error);
    return errorResponse(res, 'Failed to retrieve booking', 500);
  }
};

export const createBooking = async (req, res) => {
  try {
    const { lesson_id, scheduled_at, duration_minutes, player_ids, court_location_id, payment_method = 'stripe' } = req.body;

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
    const { reason } = req.body;

    const booking = await Booking.findByPk(id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    if (['completed', 'cancelled'].includes(booking.status)) {
      return errorResponse(res, 'Booking cannot be cancelled', 400);
    }

    const cancelledBy = req.user.role === 'admin' ? 'admin' : 
                       req.user.id === booking.coach_id ? 'coach' : 'student';

    const beforeState = booking.toJSON();
    await booking.update({
      status: 'cancelled',
      cancelled_by: cancelledBy,
      cancelled_at: new Date(),
    });

    await logAudit(req.user.id, 'booking_cancelled', 'bookings', booking.id, beforeState, booking.toJSON(), req);

    return successResponse(res, booking, 'Booking cancelled successfully');
  } catch (error) {
    console.error('Cancel booking error:', error);
    return errorResponse(res, 'Failed to cancel booking', 500);
  }
};
