import {
  sequelize,
  Booking,
  Lesson,
  User,
  UserRole,
  BookingPlayer,
  Payment,
  RescheduleHistory,
  CancellationHistory,
  CourtLocation,
  CoachCourtLocation,
  Dispute,
  DisputeResolutionAction,
} from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { logAudit, createAuditLog } from '../utils/audit.js';
import { affectsReliability, sanitizeResponse } from '../services/reliabilityPenaltyService.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import * as paymentService from '../services/paymentService.js';
import * as stripeService from '../services/stripeService.js';
import * as notificationService from '../services/notificationService.js';
import { checkBookingAvailability } from '../services/bookingService.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

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

const generateBookingIdempotencyKey = (studentId) =>
  `booking_${studentId}_${Date.now()}_${crypto.randomUUID()}`;

const MAX_LIST_ALL_BOOKINGS = 10000;

const buildReplayBookingPayload = async (booking) => {
  const latestPayment = await Payment.findOne({
    where: { booking_id: booking.id },
    order: [['created_at', 'DESC']],
  });

  let paymentIntentClientSecret = null;
  if (latestPayment?.payment_intent_id) {
    try {
      const paymentIntent = await stripeService.getPaymentIntent(latestPayment.payment_intent_id);
      paymentIntentClientSecret = paymentIntent?.client_secret ?? null;
    } catch (piError) {
      logger.warn('Failed to fetch PaymentIntent during idempotent replay', {
        bookingId: booking.id,
        paymentIntentId: latestPayment.payment_intent_id,
        error: piError?.message || String(piError),
      });
    }
  }

  return {
    booking: booking.get({ plain: true }),
    payment_intent_client_secret: paymentIntentClientSecret,
    payment_intent_id: latestPayment?.payment_intent_id ?? null,
  };
};

export const getBookings = async (req, res) => {
  try {
    const { page, limit, status, coach_id, student_id } = req.validated;
    const isAdmin = (req.user.roles || []).includes('admin');
    const isAdminRoute = (req.baseUrl || '').includes('/admin');
    if (isAdmin && !isAdminRoute) {
      return errorResponse(res, 'Use /api/admin/bookings for admin booking list access', 403);
    }
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_BOOKINGS, offset: 0 };

    const where = {};
    if (status) where.status = status;

    if (!isAdmin) {
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

    if (!isPaginated) {
      return successResponse(res, bookings.rows, 'Bookings retrieved successfully');
    }

    const response = getPagingData(bookings, page, queryLimit);
    return paginatedResponse(res, response.items, response.pagination, 'Bookings retrieved successfully');
  } catch (error) {
    logger.error('Get bookings error:', error);
    return errorResponse(res, 'Failed to retrieve bookings', 500);
  }
};

export const getCoachBookings = async (req, res) => {
  try {
    const { page, limit, status } = req.validated;
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_BOOKINGS, offset: 0 };

    const where = { coach_id: req.user.id };
    if (status) where.status = status;

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

    if (!isPaginated) {
      return successResponse(res, bookings.rows, 'Coach bookings retrieved successfully');
    }

    const response = getPagingData(bookings, page, queryLimit);
    return paginatedResponse(res, response.items, response.pagination, 'Coach bookings retrieved successfully');
  } catch (error) {
    logger.error('Get coach bookings error:', error);
    return errorResponse(res, 'Failed to retrieve coach bookings', 500);
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
        {
          model: RescheduleHistory,
          as: 'rescheduleHistory',
          separate: true,
          order: [['requested_at', 'DESC']],
        },
        {
          model: CancellationHistory,
          as: 'cancellationHistory',
          separate: true,
          order: [['cancelled_at', 'DESC']],
        },
      ],
    });

    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }

    const isParticipant = req.user.id === booking.coach_id || req.user.id === booking.primary_student_id;
    const isAdmin = (req.user.roles || []).includes('admin');
    const isAdminRoute = (req.baseUrl || '').includes('/admin');
    if (isAdmin && !isAdminRoute) {
      return errorResponse(res, 'Use /api/admin/bookings/:id for admin booking access', 403);
    }
    if (!isParticipant && !isAdmin) {
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

export const getAdminBookings = async (req, res) => {
  return getBookings(req, res);
};

export const getAdminBookingById = async (req, res) => {
  return getBookingById(req, res);
};

export const createBooking = async (req, res) => {
  try {
    const {
      lesson_id,
      scheduled_at,
      duration_minutes,
      player_ids,
      court_location_id,
      payment_method = 'stripe',
      payment_method_id,
      idempotency_key,
    } = req.validated;
    const requestIdempotencyKey =
      idempotency_key ||
      req.headers['idempotency-key'] ||
      generateBookingIdempotencyKey(req.user.id);

    const existingBooking = await Booking.findOne({
      where: {
        idempotency_key: requestIdempotencyKey,
        primary_student_id: req.user.id,
      },
    });
    if (existingBooking) {
      let existingPayload = await buildReplayBookingPayload(existingBooking);
      // Hardening: recover PaymentIntent if booking exists but payment row/intent is missing.
      if (!existingPayload.payment_intent_id) {
        try {
          logger.info({
            event: 'booking_replay_payment_recovery',
            bookingId: existingBooking.id,
            studentId: req.user.id,
            idempotencyKey: requestIdempotencyKey,
          });
          const recovered = await paymentService.createPaymentForBooking(
            existingBooking,
            req.user.id,
            payment_method,
            {
              paymentMethodId: payment_method_id || null,
              idempotencyKey: requestIdempotencyKey,
            }
          );
          existingPayload = {
            ...existingPayload,
            payment_intent_client_secret: recovered.paymentIntent?.client_secret ?? null,
            payment_intent_id: recovered.paymentIntent?.id ?? null,
          };
        } catch (recoveryError) {
          logger.warn('Idempotent replay payment recovery failed', {
            bookingId: existingBooking.id,
            idempotencyKey: requestIdempotencyKey,
            error: recoveryError?.message || String(recoveryError),
          });
        }
      }
      return successResponse(res, existingPayload, 'Booking already exists for this idempotency key');
    }

    const lesson = await Lesson.findByPk(lesson_id);
    if (!lesson || !lesson.is_active) {
      return errorResponse(res, 'Lesson not found or inactive', 404);
    }

    const roles = req.user.roles || [];
    if (!roles.includes('student') || roles.includes('admin')) {
      return errorResponse(res, 'Only non-admin students can create bookings', 403);
    }

    const lessonCoachRole = await UserRole.findOne({
      where: {
        user_id: lesson.coach_id,
        role: 'coach',
      },
    });
    if (!lessonCoachRole) {
      return errorResponse(res, 'Lesson coach account is not a valid coach', 400);
    }

    // Coach and student must be different users (no self-booking)
    if (lesson.coach_id === req.user.id) {
      return errorResponse(res, 'You cannot book your own lesson. Coach and student must be different users.', 400);
    }

    const now = new Date();
    const scheduledDate = new Date(scheduled_at);
    if (scheduledDate < now) {
      return errorResponse(res, 'Cannot book in the past', 400);
    }

    // Validate court location if provided
    if (court_location_id) {
      const court = await CourtLocation.findByPk(court_location_id);
      if (!court || court.deleted_at) {
        return errorResponse(res, 'Court location not found', 404);
      }

      const coachCourtLink = await CoachCourtLocation.findOne({
        where: {
          coach_id: lesson.coach_id,
          court_id: court_location_id,
        },
      });
      if (!coachCourtLink) {
        return errorResponse(res, 'Selected court is not available for this coach', 400);
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
        idempotency_key: requestIdempotencyKey,
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
        {
          transaction,
          paymentMethodId: payment_method_id || null,
          idempotencyKey: requestIdempotencyKey,
        }
      );
      paymentIntent = result.paymentIntent;

      await transaction.commit();
    } catch (txError) {
      await transaction.rollback();
      if (txError?.name === 'SequelizeUniqueConstraintError') {
        const racedBooking = await Booking.findOne({
          where: {
            idempotency_key: requestIdempotencyKey,
            primary_student_id: req.user.id,
          },
        });
        if (racedBooking) {
          const payload = await buildReplayBookingPayload(racedBooking);
          return successResponse(res, payload, 'Booking already exists for this idempotency key');
        }
      }
      const errMsg = (txError?.message || String(txError)) + (txError?.stack ? '\n' + txError.stack : '');
      logger.error('Create booking error: ' + errMsg);
      if (!res.headersSent) {
        const isDev = process.env.NODE_ENV !== 'production';
        return errorResponse(res, 'Failed to create booking', 500, isDev ? getCreateBookingErrorDetail(txError, true) : null);
      }
      return;
    }

    await logAudit(req.user.id, 'booking_created', 'bookings', booking.id, null, booking.get({ plain: true }), req);

    void notificationService.notifyCoachNewBookingRequest(booking.id).catch((err) => {
      logger.error({
        event: 'notify_coach_new_booking_failed',
        bookingId: booking.id,
        message: err?.message || String(err),
      });
    });

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

const lessonHasEnded = (booking) => {
  const lessonEndMs = new Date(booking.scheduled_at).getTime() + (booking.duration_minutes || 0) * 60 * 1000;
  return Date.now() >= lessonEndMs;
};

const ADMIN_ATTENDANCE_MUTABLE_STATUSES = ['confirmed', 'awaiting_verification', 'student_no_show', 'coach_no_show'];

const isRefundFinalizedForAttendanceLock = (payment) => {
  if (!payment) return false;
  if (['refunded', 'partially_refunded'].includes(String(payment.payment_status || ''))) return true;
  const refundStatus = String(payment.refund_status || '').toLowerCase();
  return ['succeeded', 'complete', 'completed', 'full', 'partial'].includes(refundStatus);
};

const canModifyAttendanceStatus = (booking, payment) => {
  if (['processing', 'paid', 'forfeited'].includes(String(booking.payout_status || ''))) {
    return {
      allowed: false,
      message: 'Attendance outcome is locked because payout has already been finalized for this booking.',
      code: 'attendance_locked_payout_finalized',
    };
  }
  if (!payment) return { allowed: true };

  if (['released', 'pending_release', 'manual_payout_required'].includes(String(payment.escrow_status || ''))) {
    return {
      allowed: false,
      message: 'Attendance outcome is locked because escrow has already been released for this booking.',
      code: 'attendance_locked_escrow_released',
    };
  }
  if (isRefundFinalizedForAttendanceLock(payment)) {
    return {
      allowed: false,
      message: 'Attendance outcome is locked because refund finalization has already occurred for this booking.',
      code: 'attendance_locked_refund_finalized',
    };
  }

  return { allowed: true };
};

const getLatestBookingPayment = async (bookingId) =>
  Payment.findOne({
    where: { booking_id: bookingId },
    order: [['id', 'DESC']],
  });

const logAdminAttendanceChange = async ({ req, bookingId, fromStatus, toStatus, notes }) => {
  await logAudit(
    req.user.id,
    'admin_attendance_status_updated',
    'bookings',
    bookingId,
    null,
    {
      previous_status: fromStatus,
      new_status: toStatus,
      admin_id: req.user.id,
      note: notes || null,
      changed_at: new Date().toISOString(),
    },
    req,
  );
};

/**
 * Mark a confirmed/awaiting_verification booking as completed.
 * Coach-only endpoint. Admin override should use /api/admin/bookings/:id/complete (if introduced).
 */
export const completeBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);
    if (req.user.id !== booking.coach_id) return errorResponse(res, 'Only the coach for this booking can complete it', 403);

    if (!['confirmed', 'awaiting_verification'].includes(booking.status)) {
      return errorResponse(
        res,
        `Booking must be confirmed or awaiting_verification to complete (current: ${booking.status}).`,
        400
      );
    }
    if (!lessonHasEnded(booking)) {
      return errorResponse(
        res,
        'Cannot mark booking as completed before the lesson end time. Wait until the lesson has finished.',
        400
      );
    }

    const beforeState = booking.toJSON();
    await booking.update({ status: 'completed', payout_status: 'pending', messaging_locked: true });
    await logAudit(req.user.id, 'booking_completed', 'bookings', booking.id, beforeState, booking.toJSON(), req);

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'avatar_url'] },
      ],
    });
    return successResponse(res, updated, 'Booking marked as completed');
  } catch (error) {
    logger.error('Complete booking error:', error);
    return errorResponse(res, 'Failed to complete booking', 500);
  }
};

/**
 * Mark booking as `student_no_show` when the **primary student** did not attend.
 * Coach calls `POST /api/bookings/:id/student-no-show`; admin uses `POST /api/admin/bookings/:id/student-no-show`.
 * Allowed status gates:
 * - Coach route: `confirmed`, `awaiting_verification`
 * - Admin route: `confirmed`, `awaiting_verification`
 * (Coach no-show: admin `POST /api/admin/bookings/:id/coach-no-show` and/or dispute type `coach_no_show_claim`.)
 */
export const markBookingNoShow = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);
    const isAdmin = (req.user.roles || []).includes('admin');
    const isCoach = req.user.id === booking.coach_id;
    const isAdminRoute = (req.baseUrl || '').includes('/admin');
    // Strict separation: coach route only; admins must use /api/admin/bookings/:id/student-no-show.
    if (!isCoach && !(isAdmin && isAdminRoute)) return errorResponse(res, 'Unauthorized', 403);

    if (booking.status === 'coach_no_show') {
      return errorResponse(
        res,
        'This booking is already marked coach_no_show. Use student no-show only when the student did not attend.',
        400
      );
    }
    const activeDispute = await Dispute.findOne({
      where: {
        booking_id: booking.id,
        status: { [Op.in]: ['open', 'under_review'] },
      },
      attributes: ['id', 'status'],
    });
    if (activeDispute || booking.status === 'disputed') {
      return errorResponse(
        res,
        'This booking has an active dispute. Resolve the dispute first to set the final booking outcome.',
        409,
        null,
        { code: 'disputed_use_resolve_dispute', booking_status: booking.status },
      );
    }
    const allowedStatuses = ['confirmed', 'awaiting_verification'];
    if (!allowedStatuses.includes(booking.status)) {
      const allowedLabel = 'confirmed or awaiting_verification';
      return errorResponse(
        res,
        `Booking must be ${allowedLabel} to mark student_no_show (current: ${booking.status}).`,
        400
      );
    }
    if (!lessonHasEnded(booking)) {
      return errorResponse(
        res,
        'Cannot mark booking as student_no_show before the lesson end time.',
        400
      );
    }

    const beforeState = booking.toJSON();
    await booking.update({ status: 'student_no_show', messaging_locked: true });
    await logAudit(
      req.user.id,
      'booking_marked_student_no_show',
      'bookings',
      booking.id,
      beforeState,
      booking.toJSON(),
      req,
    );

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'avatar_url'] },
      ],
    });
    if (booking.primary_student_id != null) {
      await updateUserReliability(booking.primary_student_id, 'student').catch((err) =>
        logger.error('Failed to update student reliability after student_no_show:', err),
      );
    }
    const responseData = {
      ...updated.toJSON(),
      attendance_outcome: 'student_no_show',
      no_show_party: 'student',
    };
    return successResponse(res, responseData, 'Booking marked as student_no_show');
  } catch (error) {
    logger.error('No-show booking error:', error);
    return errorResponse(res, 'Failed to mark booking as student_no_show', 500);
  }
};

/**
 * Coach accepts a pending booking. Captures payment and sets status to confirmed.
 * MVP: only the assigned coach may accept (not admin, not student).
 */
export const acceptBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);
    if (booking.status !== 'pending') {
      return errorResponse(res, `Booking is not pending (status: ${booking.status}). Only pending bookings can be accepted.`, 400);
    }
    if (req.user.id !== booking.coach_id) {
      return errorResponse(res, 'Only the coach for this booking can accept it', 403);
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
    return successResponse(
      res,
      updated,
      'Booking accepted. If payment was pending capture, confirmation completes when Stripe sends payment_intent.succeeded.'
    );
  } catch (error) {
    logger.error('Accept booking error:', error);
    const message = error.message || 'Failed to accept booking';
    const code = message.includes('not pending') ? 400 : 500;
    return errorResponse(res, message, code);
  }
};

/**
 * Coach declines a pending booking. Cancels PaymentIntent (no charge) and sets booking to cancelled.
 * MVP: only the assigned coach may decline.
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
    if (req.user.id !== booking.coach_id) {
      return errorResponse(res, 'Only the coach for this booking can decline it', 403);
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

    if (!reason) {
      return errorResponse(res, 'Reason is required for cancellation', 400);
    }

    const bookingPreview = await Booking.findByPk(id);
    if (!bookingPreview) {
      return errorResponse(res, 'Booking not found', 404);
    }

    const isAdmin = (req.user.roles || []).includes('admin');
    const isCoach = req.user.id === bookingPreview.coach_id;
    const isStudent = req.user.id === bookingPreview.primary_student_id;
    const isAdminRoute = (req.baseUrl || '').includes('/admin');
    if (isAdmin && !isAdminRoute) {
      return errorResponse(res, 'Use /api/admin/bookings/:id/cancel for admin cancellation', 403);
    }
    if (!isAdmin && !isCoach && !isStudent) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const cancelledBy = isAdmin ? 'admin' : isCoach ? 'coach' : 'student';
    const willAffectReliability = cancelledBy === 'admin' ? false : affectsReliability(reason);

    let cancellationHistory;
    let beforeState;
    let afterBooking;
    let refundPaymentId = null;
    let voidedPaymentId = null;
    let totalChargeCents;
    let refundCents;
    let penaltyCents;
    let penaltyReason;
    let stripeRemainingCents = null;
    let paymentForAudit = null;
    let isLateCancel = false;

    /**
     * Lock booking row first (`SELECT ... FOR UPDATE`), re-check status, then Stripe refund/void, then persist.
     * Prevents two concurrent cancels from both calling Stripe before either row shows `cancelled`.
     */
    await sequelize.transaction(async (t) => {
      const booking = await Booking.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!booking) {
        const err = new Error('Booking not found');
        err.statusCode = 404;
        throw err;
      }

      const PRE_LESSON_STATUSES = ['pending', 'confirmed'];
      if (!PRE_LESSON_STATUSES.includes(booking.status)) {
        if (booking.status === 'awaiting_verification') {
          const err = new Error(
            'Booking is awaiting verification. Use dispute resolution instead of cancellation.',
          );
          err.statusCode = 400;
          err.code = 'awaiting_verification_use_dispute';
          err.booking_status = booking.status;
          throw err;
        }
        if (booking.status === 'disputed') {
          const err = new Error(
            'Booking is already disputed. Resolve via dispute workflow instead of cancellation.',
          );
          err.statusCode = 400;
          err.code = 'disputed_use_dispute_flow';
          err.booking_status = booking.status;
          throw err;
        }
        if (booking.status === 'cancelled') {
          const err = new Error('This booking has already been cancelled.');
          err.statusCode = 400;
          err.code = 'booking_already_cancelled';
          err.booking_status = booking.status;
          throw err;
        }
        if (booking.status === 'completed') {
          const err = new Error('This booking is already completed and cannot be cancelled.');
          err.statusCode = 400;
          err.code = 'booking_already_completed';
          err.booking_status = booking.status;
          throw err;
        }
        const err = new Error(
          'Only pending or confirmed bookings can be cancelled. Use dispute flow for post-lesson issues.',
        );
        err.statusCode = 400;
        err.code = 'cancel_pre_lesson_only';
        err.booking_status = booking.status;
        throw err;
      }

      beforeState = booking.toJSON();

      const now = new Date();
      const hoursUntilBooking = (new Date(booking.scheduled_at) - now) / (1000 * 60 * 60);
      isLateCancel = hoursUntilBooking >= 0 && hoursUntilBooking < 24;

      const payment = await Payment.findOne({
        where: { booking_id: booking.id },
        order: [['id', 'DESC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      paymentForAudit = payment;

      totalChargeCents = paymentService.parseTotalChargeCentsFromBooking(payment, booking);

      const split = paymentService.computeCancellationSplitCents({
        totalChargeCents,
        isLateCancel,
        cancelledBy,
      });
      refundCents = split.refundCents;
      penaltyCents = split.penaltyCents;
      penaltyReason = split.penaltyReason;

      if (refundCents > 0 && payment?.charge_id) {
        try {
          const ch = await stripeService.retrieveCharge(payment.charge_id);
          const chargeAmountCents = Math.round(ch.amount || 0);
          const refundedSoFar = Math.round(ch.amount_refunded || 0);
          stripeRemainingCents = chargeAmountCents - refundedSoFar;

          const capped = paymentService.applyStripeRefundCap({
            policyRefundCents: refundCents,
            totalChargeCents,
            remainingCents: stripeRemainingCents,
          });
          refundCents = capped.refundCents;
          penaltyCents = capped.penaltyCents;
          if (capped.capped) {
            logger.warn({
              component: 'stripe',
              event: 'refund_capped_by_stripe_remaining',
              bookingId: booking.id,
              paymentId: payment.id,
              stripeRemainingCents,
            });
          }
        } catch (err) {
          logger.error({
            component: 'stripe',
            event: 'cancel_stripe_remaining_fetch_failed',
            paymentId: payment.id,
            message: err.message,
          });
          const e = new Error(
            'Could not verify charge with Stripe. Booking was not cancelled. Try again or contact support.',
          );
          e.statusCode = 502;
          throw e;
        }
      }

      const invariant =
        totalChargeCents < 1 ||
        Math.round(refundCents) + Math.round(penaltyCents) === Math.round(totalChargeCents);
      if (!invariant) {
        logger.error({
          component: 'stripe',
          event: 'cancellation_refund_invariant_broken',
          bookingId: booking.id,
          totalChargeCents,
          refundCents,
          penaltyCents,
        });
        const e = new Error('Refund calculation error. Please contact support.');
        e.statusCode = 500;
        throw e;
      }

      logger.info({
        component: 'stripe',
        event: 'cancellation_refund_calc',
        bookingId: booking.id,
        paymentId: payment?.id,
        totalChargeCents,
        isLateCancel,
        cancelledBy,
        refundCents,
        penaltyCents,
        stripeRemainingCents,
        penaltyReason,
      });

      const refund_amount = paymentService.centsToDecimalString(refundCents);
      const penalty_amount = paymentService.centsToDecimalString(penaltyCents);
      const penalty_reason = penaltyReason;

      if (refundCents > 0) {
        if (
          payment?.charge_id &&
          (payment.payment_status === 'captured' ||
            payment.payment_status === 'partially_refunded' ||
            payment.payment_status === 'pending_capture')
        ) {
          try {
            await paymentService.processRefund(payment.id, {
              refundCents,
              reason: 'requested_by_customer',
              idempotencyKey: `cancel-booking-${booking.id}-payment-${payment.id}`,
              transaction: t,
            });
            refundPaymentId = payment.id;
          } catch (refundErr) {
            logger.error('Stripe refund failed during cancellation; booking not cancelled:', refundErr);
            const e = new Error(
              refundErr.message || 'Refund failed. Booking was not cancelled. Try again or contact support.',
            );
            e.statusCode = 502;
            throw e;
          }
        }
      }
      if (!payment?.charge_id && payment?.payment_intent_id && payment.payment_status === 'pending') {
        try {
          await stripeService.cancelPaymentIntent(payment.payment_intent_id);
          await payment.update({ payment_status: 'pending_void' }, { transaction: t });
          voidedPaymentId = payment.id;
        } catch (voidErr) {
          logger.error('Stripe PaymentIntent cancel failed during cancellation; booking not cancelled:', voidErr);
          const e = new Error(
            'Could not cancel payment authorization. Booking was not cancelled. Try again or contact support.',
          );
          e.statusCode = 502;
          throw e;
        }
      }

      cancellationHistory = await CancellationHistory.create(
        {
          booking_id: booking.id,
          cancelled_by: cancelledBy,
          reason,
          reason_notes: reason_notes || null,
          affects_reliability: willAffectReliability,
          refund_amount,
          penalty_amount,
          penalty_reason,
        },
        { transaction: t },
      );

      if (refundPaymentId) {
        await cancellationHistory.update({ refund_payment_id: refundPaymentId }, { transaction: t });
      }

      await booking.update(
        {
          status: 'cancelled',
          cancelled_by: cancelledBy,
          cancelled_at: new Date(),
          messaging_locked: true,
        },
        { transaction: t },
      );
    });

    afterBooking = await Booking.findByPk(id);
    await logAudit(req.user.id, 'booking_cancelled', 'bookings', id, beforeState, afterBooking.toJSON(), req);
    await logAudit(req.user.id, 'cancellation_recorded', 'cancellation_history', cancellationHistory.id, null, cancellationHistory.toJSON(), req);

    await createAuditLog({
      user_id: req.user.id,
      action: 'cancellation_financials',
      table_name: 'bookings',
      record_id: id,
      after_state: {
        cancellation_history_id: cancellationHistory.id,
        payment_id: paymentForAudit?.id ?? null,
        payment_voided_id: voidedPaymentId,
        total_charge_cents: totalChargeCents,
        refund_cents: refundCents,
        retained_penalty_cents: penaltyCents,
        is_late_cancel: isLateCancel,
        cancelled_by: cancelledBy,
        penalty_reason: penaltyReason,
        stripe_remaining_cents_before_refund: stripeRemainingCents,
      },
      ip_address: req?.ip || req?.connection?.remoteAddress,
      user_agent: req?.get?.('user-agent'),
    });

    if (willAffectReliability && cancelledBy !== 'admin') {
      const userIdToUpdate = cancelledBy === 'coach' ? afterBooking.coach_id : afterBooking.primary_student_id;
      if (userIdToUpdate) {
        const userToUpdate = await User.findByPk(userIdToUpdate, {
          include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
        });
        const updateRoles = userToUpdate?.userRoles?.map((r) => r.role) ?? [];
        if (userToUpdate && !updateRoles.includes('admin')) {
          const reliabilityRole = cancelledBy === 'coach' ? 'coach' : 'student';
          await updateUserReliability(userIdToUpdate, reliabilityRole).catch((err) => {
            logger.error('Failed to update reliability after cancellation:', err);
          });
        }
      }
    }

    const sanitizedCancellation = sanitizeResponse(cancellationHistory);

    return successResponse(res, {
      booking: afterBooking.toJSON(),
      cancellation: sanitizedCancellation,
    }, 'Booking cancelled successfully');
  } catch (error) {
    if (error.statusCode === 404) {
      return errorResponse(res, error.message, 404);
    }
    if (error.statusCode === 400) {
      const extra =
        error.code && typeof error.code === 'string'
          ? { code: error.code, ...(error.booking_status && { booking_status: error.booking_status }) }
          : null;
      return errorResponse(res, error.message, 400, null, extra);
    }
    if (error.statusCode === 502) {
      return errorResponse(res, error.message, 502);
    }
    if (error.statusCode === 500) {
      return errorResponse(res, error.message, 500);
    }
    logger.error('Cancel booking error:', error);
    return errorResponse(res, 'Failed to cancel booking', 500);
  }
};

/**
 * Admin pre-lesson cancel — thin wrapper around `cancelBooking` (pending/confirmed only; same rules as student/coach cancel).
 */
export const adminPreLessonCancelBooking = async (req, res) => {
  return cancelBooking(req, res);
};

/**
 * Admin: set booking to `coach_no_show` (coach did not attend).
 * Attendance-only endpoint: dispute outcomes are decided via `PUT /api/disputes/:id/resolve`.
 */
export const adminMarkCoachNoShow = async (req, res) => {
  try {
    const { id } = req.params;
    const notes = String(req.validated?.notes || '').trim();

    const booking = await Booking.findByPk(id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);

    if (booking.status === 'coach_no_show') {
      return errorResponse(
        res,
        'This booking is already marked coach_no_show.',
        400,
        null,
        { code: 'booking_already_coach_no_show', booking_status: booking.status },
      );
    }
    if (!ADMIN_ATTENDANCE_MUTABLE_STATUSES.includes(booking.status)) {
      return errorResponse(
        res,
        `Cannot mark coach_no_show from status ${booking.status}. Allowed: ${ADMIN_ATTENDANCE_MUTABLE_STATUSES.join(', ')}.`,
        400,
        null,
        { booking_status: booking.status },
      );
    }
    const activeDispute = await Dispute.findOne({
      where: {
        booking_id: booking.id,
        status: { [Op.in]: ['open', 'under_review'] },
      },
      attributes: ['id', 'status'],
    });
    if (activeDispute || booking.status === 'disputed') {
      return errorResponse(
        res,
        'This booking has an active dispute. Resolve the dispute first to set final status and money outcome.',
        409,
        null,
        { code: 'disputed_use_resolve_dispute', booking_status: booking.status },
      );
    }
    if (!lessonHasEnded(booking)) {
      return errorResponse(res, 'Cannot mark coach_no_show before the lesson end time.', 400);
    }

    const payment = await getLatestBookingPayment(booking.id);
    const attendanceLock = canModifyAttendanceStatus(booking, payment);
    if (!attendanceLock.allowed) {
      return errorResponse(res, attendanceLock.message, 409, null, { code: attendanceLock.code, booking_status: booking.status });
    }

    const beforeState = booking.toJSON();
    const fromStatus = booking.status;
    await booking.update({ status: 'coach_no_show', messaging_locked: true });

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'avatar_url'] },
      ],
    });

    await logAudit(req.user.id, 'booking_marked_coach_no_show', 'bookings', booking.id, beforeState, updated.toJSON(), req);
    await logAdminAttendanceChange({
      req,
      bookingId: booking.id,
      fromStatus,
      toStatus: 'coach_no_show',
      notes,
    });
    if (notes) {
      await logAudit(
        req.user.id,
        'admin_coach_no_show_notes',
        'bookings',
        booking.id,
        null,
        { notes },
        req,
      );
    }

    if (booking.coach_id) {
      const coachUser = await User.findByPk(booking.coach_id, {
        include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
      });
      const roles = coachUser?.userRoles?.map((r) => r.role) ?? [];
      if (coachUser && !roles.includes('admin')) {
        await updateUserReliability(booking.coach_id, 'coach').catch((err) =>
          logger.error('Failed to update reliability after coach_no_show:', err),
        );
      }
    }

    // Status-driven money path: coach_no_show should refund the student when refundable payment exists.
    const autoRefund = {
      status: 'skipped',
      reason: 'no_refundable_payment',
      payment_id: null,
      refund_cents: 0,
      stripe_refund_id: null,
    };
    const hasOpenDispute = await Dispute.count({
      where: {
        booking_id: booking.id,
        status: { [Op.in]: ['open', 'under_review'] },
      },
    });
    if (hasOpenDispute > 0) {
      autoRefund.reason = 'open_dispute_present';
    } else {
      const refundState = await paymentService.getLatestBookingRefundState(booking.id);
      const payment = refundState.payment;
      if (!payment) {
        autoRefund.reason = 'payment_missing';
      } else if (!payment.charge_id) {
        autoRefund.payment_id = payment.id;
        autoRefund.reason = 'charge_missing';
      } else {
        autoRefund.payment_id = payment.id;
        const remainingCents = Math.max(0, refundState.chargeAmountCents - refundState.refundedSoFarCents);
        if (payment.refund_status === 'pending') {
          autoRefund.reason = 'refund_pending';
        } else if (remainingCents < 1) {
          autoRefund.reason = 'already_fully_refunded';
        } else if (!['captured', 'partially_refunded'].includes(payment.payment_status)) {
          autoRefund.reason = `payment_status_not_refundable:${payment.payment_status}`;
        } else {
          const result = await paymentService.processRefund(payment.id, {
            refundCents: remainingCents,
            reason: 'requested_by_customer',
            idempotencyKey: `admin-coach-no-show-${booking.id}-payment-${payment.id}-full-${remainingCents}`,
          });
          autoRefund.status = 'initiated';
          autoRefund.reason = null;
          autoRefund.refund_cents = remainingCents;
          autoRefund.stripe_refund_id = result?.refund?.id || null;
        }
      }
    }

    const responseData = {
      ...updated.toJSON(),
      attendance_outcome: 'coach_no_show',
      no_show_party: 'coach',
      auto_refund: autoRefund,
    };
    return successResponse(res, responseData, 'Booking marked as coach_no_show');
  } catch (error) {
    if (error.statusCode === 404) {
      return errorResponse(res, error.message, 404);
    }
    if (error.statusCode === 400) {
      const extra =
        error.code && typeof error.code === 'string'
          ? { code: error.code, ...(error.booking_status && { booking_status: error.booking_status }) }
          : null;
      return errorResponse(res, error.message, 400, null, extra);
    }
    if (error.statusCode === 409) {
      return errorResponse(res, error.message, 409);
    }
    if (error.statusCode === 500) {
      return errorResponse(res, error.message, 500);
    }
    if (error.message?.includes('No refundable balance remaining on Stripe charge')) {
      return errorResponse(res, error.message, 400);
    }
    if (error.message?.includes('Refund (') && error.message?.includes('exceeds remaining Stripe balance')) {
      return errorResponse(res, error.message, 400);
    }
    if (error.message?.includes('Stripe')) {
      return errorResponse(res, error.message, 502);
    }
    logger.error('Admin mark coach no-show error:', error);
    return errorResponse(res, 'Failed to mark coach_no_show', 500);
  }
};

/**
 * Admin override: mark **student** no-show.
 */
export const adminMarkBookingNoShow = async (req, res) => {
  try {
    const { id } = req.params;
    const notes = String(req.validated?.notes || '').trim();

    const booking = await Booking.findByPk(id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);

    if (booking.status === 'student_no_show') {
      return errorResponse(
        res,
        'This booking is already marked student_no_show.',
        400,
        null,
        { code: 'booking_already_student_no_show', booking_status: booking.status },
      );
    }
    if (!ADMIN_ATTENDANCE_MUTABLE_STATUSES.includes(booking.status)) {
      return errorResponse(
        res,
        `Cannot mark student_no_show from status ${booking.status}. Allowed: ${ADMIN_ATTENDANCE_MUTABLE_STATUSES.join(', ')}.`,
        400,
        null,
        { booking_status: booking.status },
      );
    }

    const activeDispute = await Dispute.findOne({
      where: {
        booking_id: booking.id,
        status: { [Op.in]: ['open', 'under_review'] },
      },
      attributes: ['id', 'status'],
    });
    if (activeDispute || booking.status === 'disputed') {
      return errorResponse(
        res,
        'This booking has an active dispute. Resolve the dispute first to set final status and money outcome.',
        409,
        null,
        { code: 'disputed_use_resolve_dispute', booking_status: booking.status },
      );
    }
    if (!lessonHasEnded(booking)) {
      return errorResponse(
        res,
        'Cannot mark booking as student_no_show before the lesson end time.',
        400
      );
    }

    const payment = await getLatestBookingPayment(booking.id);
    const attendanceLock = canModifyAttendanceStatus(booking, payment);
    if (!attendanceLock.allowed) {
      return errorResponse(res, attendanceLock.message, 409, null, { code: attendanceLock.code, booking_status: booking.status });
    }

    const beforeState = booking.toJSON();
    const fromStatus = booking.status;
    await booking.update({ status: 'student_no_show', messaging_locked: true });
    await logAudit(
      req.user.id,
      'booking_marked_student_no_show',
      'bookings',
      booking.id,
      beforeState,
      booking.toJSON(),
      req,
    );
    await logAdminAttendanceChange({
      req,
      bookingId: booking.id,
      fromStatus,
      toStatus: 'student_no_show',
      notes,
    });
    if (notes) {
      await logAudit(
        req.user.id,
        'admin_student_no_show_notes',
        'bookings',
        booking.id,
        null,
        { notes },
        req,
      );
    }

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name', 'avatar_url'] },
      ],
    });
    if (booking.primary_student_id != null) {
      await updateUserReliability(booking.primary_student_id, 'student').catch((err) =>
        logger.error('Failed to update student reliability after admin student_no_show:', err),
      );
    }
    const responseData = {
      ...updated.toJSON(),
      attendance_outcome: 'student_no_show',
      no_show_party: 'student',
    };
    return successResponse(res, responseData, 'Booking marked as student_no_show');
  } catch (error) {
    logger.error('Admin mark student no-show error:', error);
    return errorResponse(res, 'Failed to mark booking as student_no_show', 500);
  }
};

/**
 * Admin override: issue refund for a booking's latest payment.
 * If refund_amount is omitted, refunds remaining Stripe balance.
 */
export const adminRefundBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { refund_amount, reason, reason_notes } = req.validated || {};

    const booking = await Booking.findByPk(id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);

    const refundState = await paymentService.getLatestBookingRefundState(booking.id);
    if (refundState.hasAnyRefund) {
      logger.warn({
        component: 'payments',
        event: 'refund_already_started_blocked_admin_refund',
        bookingId: booking.id,
        paymentId: refundState.payment?.id ?? null,
        refundedSoFarCents: refundState.refundedSoFarCents,
        hasPendingRefund: refundState.hasPendingRefund,
      });
      return errorResponse(
        res,
        'A refund already exists for this booking. To keep one financial resolution per booking incident, additional refunds are blocked.',
        409,
        null,
        { code: 'refund_path_already_used' },
      );
    }

    // Guardrail: if dispute resolution already issued a refund, block manual refund path.
    const disputeRefundResolution = await Dispute.findOne({
      where: { booking_id: booking.id, status: 'resolved' },
      include: [
        {
          model: DisputeResolutionAction,
          as: 'resolutionAction',
          attributes: ['id', 'code', 'requires_payout_adjustment'],
          where: { requires_payout_adjustment: true },
          required: true,
        },
      ],
      order: [['resolved_at', 'DESC']],
    });
    if (disputeRefundResolution) {
      logger.warn({
        component: 'payments',
        event: 'mixed_refund_path_blocked_admin_refund',
        bookingId: booking.id,
        disputeId: disputeRefundResolution.id,
        resolutionAction: disputeRefundResolution.resolutionAction?.code || null,
      });
      return errorResponse(
        res,
        'This booking already has a dispute resolution with refund. To avoid duplicate refund paths, do not issue a manual booking refund.',
        409,
        null,
        { code: 'refund_path_already_used' },
      );
    }

    const openDispute = await Dispute.findOne({
      where: {
        booking_id: booking.id,
        status: { [Op.in]: ['open', 'under_review'] },
      },
      attributes: ['id', 'status'],
      order: [['opened_at', 'DESC']],
    });
    if (openDispute) {
      logger.warn({
        component: 'payments',
        event: 'manual_refund_blocked_while_dispute_open',
        bookingId: booking.id,
        disputeId: openDispute.id,
        disputeStatus: openDispute.status,
      });
      return errorResponse(
        res,
        'An active dispute exists for this booking. Resolve the dispute to apply any refund decision.',
        409,
        null,
        { code: 'refund_requires_dispute_resolution' },
      );
    }

    const payment = await Payment.findOne({
      where: { booking_id: booking.id },
      order: [['id', 'DESC']],
    });
    if (!payment) return errorResponse(res, 'Payment not found for this booking', 404);
    if (!payment.charge_id) {
      return errorResponse(res, 'Payment has no Stripe charge to refund', 400);
    }

    let refundCents;
    if (refund_amount != null) {
      refundCents = paymentService.dollarsToCents(refund_amount);
      if (refundCents < 1) return errorResponse(res, 'refund_amount must be at least 0.01', 400);
    } else {
      const charge = await stripeService.retrieveCharge(payment.charge_id);
      const chargeAmount = Math.round(charge.amount || 0);
      const alreadyRefunded = Math.round(charge.amount_refunded || 0);
      refundCents = chargeAmount - alreadyRefunded;
      if (refundCents < 1) {
        return errorResponse(res, 'No refundable balance remaining on Stripe charge', 400);
      }
    }

    const initiated = await paymentService.processRefund(payment.id, {
      refundCents,
      reason: reason || 'requested_by_customer',
      idempotencyKey: `admin-booking-refund-${booking.id}-${payment.id}-${refundCents}`,
    });

    await logAudit(
      req.user.id,
      'admin_booking_refund_initiated',
      'bookings',
      booking.id,
      null,
      {
        payment_id: payment.id,
        refund_cents: refundCents,
        reason: reason || 'requested_by_customer',
        reason_notes: reason_notes || null,
        refund_status: initiated?.payment?.refund_status || 'pending',
      },
      req
    );

    return successResponse(
      res,
      {
        booking_id: booking.id,
        payment_id: payment.id,
        refund_amount: paymentService.centsToDecimalString(refundCents),
        refund_status: initiated?.payment?.refund_status || 'pending',
        stripe_refund_id: initiated?.refund?.id || null,
        reason: reason || 'requested_by_customer',
      },
      'Booking refund initiated by admin'
    );
  } catch (error) {
    logger.error('Admin refund booking error:', error);
    return errorResponse(res, error.message || 'Failed to refund booking', 500);
  }
};
