import {
  sequelize,
  Booking,
  Lesson,
  User,
  UserRole,
  UserReliability,
  Payment,
  CancellationHistory,
  CourtLocation,
  CoachCourtLocation,
  Dispute,
  DisputeResolutionAction,
  PaymentAction,
} from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { logAudit, createAuditLog } from '../utils/audit.js';
import { affectsReliability } from '../services/reliabilityPenaltyService.js';
import { buildCancellationApiPayload } from '../utils/cancellationResponse.js';
import * as bookingIntentService from '../services/bookingIntentService.js';
import { updateUserReliability } from '../services/reliabilityService.js';
import * as paymentService from '../services/paymentService.js';
import * as stripeService from '../services/stripeService.js';
import * as notificationService from '../services/notificationService.js';
import { checkBookingAvailability } from '../services/bookingService.js';
import { logger } from '../config/logger.js';
import {
  ADMIN_MARK_NO_SHOW_SOURCE_STATUSES,
  checkAttendanceFinalized,
} from '../utils/bookingAttendanceStatus.js';
import { applyBookingStatusTransition, BookingTransitionVia } from '../services/bookingStateMachine.js';
import { ACTIVE_DISPUTE_STATUSES } from '../services/disputeStateMachine.js';
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';
import { attachConversationSummaries, attachConversationSummaryToBookingJson } from '../utils/bookingConversationSummary.js';
import {
  serializeBookingDetailPayload,
  serializeBookingListItem,
  serializeBookingResponse,
  serializeBookingSummary,
} from '../utils/bookingDto.js';
import { serializePaymentSummary } from '../utils/paymentDto.js';
import {
  shouldQueueLateCancelCoachPayout,
  cancellationFinancialsForHistory,
} from '../utils/lateCancelPayout.js';
import {
  assertPreLessonCancelAllowed,
  assertBookingStatusAllowsPreLessonCancel,
} from '../utils/bookingCancelEligibility.js';
import {
  buildAdminBookingsWhere,
  buildCoachInboxBookingsWhere,
  buildStudentBookingsWhere,
} from '../utils/bookingListQuery.js';

/** Nested student party for booking responses — optional student reliability score for coaches. */
function primaryStudentInclude() {
  return {
    model: User,
    as: 'primaryStudent',
    attributes: ['id', 'full_name', 'avatar_url'],
    include: [
      {
        model: UserReliability,
        as: 'reliabilities',
        required: false,
        where: { role: 'student' },
        attributes: ['user_id', 'role', 'reliability_score'],
      },
    ],
  };
}

/** Privileged court-address viewers: booking coach or admin. */
function coachViewerSerializeOptions(viewerUserId, booking, roles = []) {
  const isCoach = Number(viewerUserId) === Number(booking?.coach_id);
  const isAdmin = Array.isArray(roles) && roles.includes('admin');
  return {
    includeStudentReliability: isCoach,
    viewerIsPrivileged: isCoach || isAdmin,
  };
}

/** Student booking viewers: follow booking status unless privileged. */
function bookingCourtAddressOptions(viewerUserId, roles, booking) {
  return coachViewerSerializeOptions(viewerUserId, booking, roles);
}

function bookingListIncludes() {
  return [
    { model: Lesson, as: 'lesson' },
    { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
    primaryStudentInclude(),
    { model: CourtLocation, as: 'courtLocation' },
  ];
}

function respondIfBookingStateMachineError(res, error) {
  if (error?.statusCode === 400 && error?.code) {
    return errorResponse(res, error.message, 400, null, { code: error.code });
  }
  return null;
}

const MAX_LIST_ALL_BOOKINGS = 10000;

/**
 * Shared list responder for coach / student / admin booking lists.
 * @param {'per_row_coach' | true | false} studentReliabilityMode
 */
async function respondWithBookingList(req, res, {
  where,
  successMessage,
  failureMessage,
  logLabel,
  studentReliabilityMode,
}) {
  try {
    const { page, limit } = req.validated;
    const roles = req.user.roles || [];
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_BOOKINGS, offset: 0 };

    const bookings = await Booking.findAndCountAll({
      where,
      include: bookingListIncludes(),
      limit: queryLimit,
      offset,
      order: [['scheduled_at', 'DESC']],
    });

    const serializeOpts = (row) => {
      if (studentReliabilityMode === true) {
        return { includeStudentReliability: true, viewerIsPrivileged: true };
      }
      if (studentReliabilityMode === false) {
        return {
          includeStudentReliability: false,
          ...bookingCourtAddressOptions(req.user.id, roles, row),
        };
      }
      // per_row_coach (admin list): admins always privileged for court address
      const base = coachViewerSerializeOptions(req.user.id, row, req.user.roles || []);
      if (roles.includes('admin')) {
        return { ...base, viewerIsPrivileged: true };
      }
      return base;
    };

    if (!isPaginated) {
      const data = await attachConversationSummaries(bookings.rows, req.user.id, roles);
      return successResponse(
        res,
        data.map((row) => serializeBookingListItem(row, serializeOpts(row))),
        successMessage,
      );
    }

    const response = getPagingData(bookings, page, queryLimit);
    response.items = await attachConversationSummaries(response.items, req.user.id, roles);
    return paginatedResponse(
      res,
      response.items.map((row) => serializeBookingListItem(row, serializeOpts(row))),
      response.pagination,
      successMessage,
    );
  } catch (error) {
    logger.error(`${logLabel}:`, error);
    return errorResponse(res, failureMessage, 500);
  }
}

/** Coach dashboard: bookings where I am the coach. */
export const getCoachBookings = async (req, res) => {
  const { status } = req.validated;
  return respondWithBookingList(req, res, {
    where: buildCoachInboxBookingsWhere({ userId: req.user.id, status }),
    successMessage: 'Coach bookings retrieved successfully',
    failureMessage: 'Failed to retrieve coach bookings',
    logLabel: 'Get coach bookings error',
    studentReliabilityMode: true,
  });
};

/** Student dashboard: bookings where I am the primary student. */
export const getStudentBookings = async (req, res) => {
  const { status } = req.validated;
  return respondWithBookingList(req, res, {
    where: buildStudentBookingsWhere({ userId: req.user.id, status }),
    successMessage: 'Student bookings retrieved successfully',
    failureMessage: 'Failed to retrieve student bookings',
    logLabel: 'Get student bookings error',
    studentReliabilityMode: false,
  });
};

export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        primaryStudentInclude(),
        { model: CourtLocation, as: 'courtLocation' },
        { model: Payment, as: 'payments' },
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
    if (isParticipant) {
      // allow — includes admin+student / admin+coach on participant routes
    } else if (isAdmin && isAdminRoute) {
      // allow — uninvolved admin on admin route
    } else if (isAdmin && !isAdminRoute) {
      return errorResponse(res, 'Use /api/admin/bookings/:id for admin booking access', 403);
    } else {
      return errorResponse(res, 'Unauthorized', 403);
    }

    // Cancellation history is trimmed in serializeBookingDetailPayload
    const bookingJson = booking.toJSON();

    const isAdminViewer = isAdmin && isAdminRoute;

    const payload = await attachConversationSummaryToBookingJson(
      bookingJson,
      req.user.id,
      req.user.roles || [],
    );

    return successResponse(
      res,
      serializeBookingDetailPayload(payload, {
        serializePayment: (payment) => serializePaymentSummary(payment, { isAdmin: isAdminViewer }),
        includeStudentReliability: Number(req.user.id) === Number(booking.coach_id),
        viewerIsPrivileged:
          Number(req.user.id) === Number(booking.coach_id) || isAdminViewer,
      }),
      'Booking retrieved successfully',
    );
  } catch (error) {
    logger.error('Get booking error:', error);
    return errorResponse(res, 'Failed to retrieve booking', 500);
  }
};

export const getAdminBookings = async (req, res) => {
  const { status, coach_id, student_id } = req.validated;
  return respondWithBookingList(req, res, {
    where: buildAdminBookingsWhere({ status, coach_id, student_id }),
    successMessage: 'Bookings retrieved successfully',
    failureMessage: 'Failed to retrieve bookings',
    logLabel: 'Get admin bookings error',
    studentReliabilityMode: 'per_row_coach',
  });
};

export const getAdminBookingById = async (req, res) => {
  return getBookingById(req, res);
};

export const createBooking = async (req, res) => {
  return errorResponse(
    res,
    'POST /api/bookings is deprecated. Use POST /api/booking-intents to authorize payment, then POST /api/bookings/confirm.',
    410,
    null,
    { code: 'booking_create_deprecated_use_intent_flow' },
  );
};

export const confirmBooking = async (req, res) => {
  try {
    const { payment_intent_id } = req.validated;
    const result = await bookingIntentService.confirmBookingFromPaymentIntent({
      studentId: req.user.id,
      paymentIntentId: payment_intent_id,
    });

    const bookingData = serializeBookingSummary(result.booking);
    const paymentData = result.payment
      ? serializePaymentSummary(result.payment, { isAdmin: false })
      : result.payment;

    const message = result.idempotentReplay
      ? 'Booking already confirmed for this payment'
      : 'Booking created successfully';

    return successResponse(
      res,
      { booking: bookingData, payment: paymentData },
      message,
      result.idempotentReplay ? 200 : 201,
    );
  } catch (error) {
    if (error.statusCode && error.code) {
      return errorResponse(res, error.message, error.statusCode, null, { code: error.code });
    }
    if (error.statusCode) {
      return errorResponse(res, error.message, error.statusCode);
    }
    logger.error('Confirm booking error:', error);
    const isDev = process.env.NODE_ENV !== 'production';
    return errorResponse(
      res,
      'Failed to confirm booking',
      500,
      isDev ? { detail: error?.message || String(error) } : null,
    );
  }
};

const lessonHasEnded = (booking) => {
  const lessonEndMs = new Date(booking.scheduled_at).getTime() + (booking.duration_minutes || 0) * 60 * 1000;
  return Date.now() >= lessonEndMs;
};

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

    const finalizedCheck = checkAttendanceFinalized(booking);
    if (!finalizedCheck.ok) {
      return errorResponse(res, finalizedCheck.message, 409, null, { code: finalizedCheck.code });
    }

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
    await applyBookingStatusTransition(booking, {
      toStatus: 'completed',
      via: BookingTransitionVia.MARK_COMPLETED,
      patch: { payout_status: 'pending' },
    });
    await logAudit(req.user.id, 'booking_completed', 'bookings', booking.id, beforeState, booking.toJSON(), req);

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        primaryStudentInclude(),
      ],
    });
    return successResponse(
      res,
      serializeBookingListItem(updated, coachViewerSerializeOptions(req.user.id, updated, req.user.roles || [])),
      'Booking marked as completed',
    );
  } catch (error) {
    const sm = respondIfBookingStateMachineError(res, error);
    if (sm) return sm;
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
        status: { [Op.in]: [...ACTIVE_DISPUTE_STATUSES] },
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
    const finalizedCheck = checkAttendanceFinalized(booking);
    if (!finalizedCheck.ok) {
      return errorResponse(res, finalizedCheck.message, 409, null, { code: finalizedCheck.code });
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
    await applyBookingStatusTransition(booking, {
      toStatus: 'student_no_show',
      via: BookingTransitionVia.COACH_MARK_STUDENT_NO_SHOW,
      patch: {},
    });
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
        primaryStudentInclude(),
      ],
    });
    if (booking.primary_student_id != null) {
      await updateUserReliability(booking.primary_student_id, 'student').catch((err) =>
        logger.error('Failed to update student reliability after student_no_show:', err),
      );
    }
    const responseData = serializeBookingResponse(
      updated,
      {
        attendance_outcome: 'student_no_show',
        no_show_party: 'student',
      },
      coachViewerSerializeOptions(req.user.id, updated, req.user.roles || []),
    );
    return successResponse(res, responseData, 'Booking marked as student_no_show');
  } catch (error) {
    const sm = respondIfBookingStateMachineError(res, error);
    if (sm) return sm;
    logger.error('No-show booking error:', error);
    return errorResponse(res, 'Failed to mark booking as student_no_show', 500);
  }
};

/**
 * Coach accepts a pending booking. Captures payment and sets status to confirmed.
 * MVP: only the assigned coach may accept (not admin, not student).
 */
function respondIfPaymentAuthorizationError(res, error) {
  if (error?.statusCode === 400 && error?.code?.startsWith('payment_')) {
    return errorResponse(res, error.message, 400, null, { code: error.code });
  }
  return null;
}

export const acceptBooking = async (req, res) => {
  try {
    const { id } = req.params;

    await sequelize.transaction(async (t) => {
      const booking = await Booking.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!booking) {
        const err = new Error('Booking not found');
        err.statusCode = 404;
        throw err;
      }
      if (booking.status !== 'pending') {
        const err = new Error(
          `Booking is not pending (status: ${booking.status}). Only pending bookings can be accepted.`,
        );
        err.statusCode = 400;
        throw err;
      }
      if (req.user.id !== booking.coach_id) {
        const err = new Error('Only the coach for this booking can accept it');
        err.statusCode = 403;
        throw err;
      }

      const payment = await Payment.findOne({
        where: { booking_id: booking.id },
        order: [['id', 'DESC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (payment) {
        await paymentService.capturePaymentOnCoachAccept(payment.id, { transaction: t });
      } else {
        await applyBookingStatusTransition(booking, {
          toStatus: 'confirmed',
          via: BookingTransitionVia.COACH_ACCEPT_WITHOUT_PAYMENT,
          options: { transaction: t },
        });
        await logAudit(req.user.id, 'booking_confirmed_by_coach', 'bookings', booking.id, null, { status: 'confirmed' }, req);
      }
    });

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        primaryStudentInclude(),
      ],
    });

    void notificationService.notifyBookingAccepted(id).catch((err) => {
      logger.warn({ component: 'booking', event: 'accept_notify_failed', bookingId: id, message: err?.message });
    });

    const payload = await attachConversationSummaryToBookingJson(
      updated.toJSON(),
      req.user.id,
      req.user.roles || [],
    );

    return successResponse(
      res,
      serializeBookingListItem(payload, { includeStudentReliability: true, viewerIsPrivileged: true }),
      'Booking accepted. If payment was pending capture, confirmation completes when Stripe sends payment_intent.succeeded.'
    );
  } catch (error) {
    if (error?.statusCode === 404) return errorResponse(res, error.message, 404);
    if (error?.statusCode === 403) return errorResponse(res, error.message, 403);
    if (error?.statusCode === 400) return errorResponse(res, error.message, 400);
    const sm = respondIfBookingStateMachineError(res, error);
    if (sm) return sm;
    const pay = respondIfPaymentAuthorizationError(res, error);
    if (pay) return pay;
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
 * Optional decline_reason_code enum for analytics (see getValidDeclineReasonCodes).
 */
export const declineBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { message_to_student, decline_reason_code } = req.validated || {};
    const noteToStore = (message_to_student && message_to_student.trim()) ? message_to_student.trim() : null;
    const codeToStore = (decline_reason_code && decline_reason_code.trim()) ? decline_reason_code.trim() : null;

    await sequelize.transaction(async (t) => {
      const booking = await Booking.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!booking) {
        const err = new Error('Booking not found');
        err.statusCode = 404;
        throw err;
      }
      if (booking.status !== 'pending') {
        const err = new Error(
          `Booking is not pending (status: ${booking.status}). Only pending bookings can be declined.`,
        );
        err.statusCode = 400;
        throw err;
      }
      if (req.user.id !== booking.coach_id) {
        const err = new Error('Only the coach for this booking can decline it');
        err.statusCode = 403;
        throw err;
      }

      const payment = await Payment.findOne({
        where: { booking_id: booking.id },
        order: [['id', 'DESC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (payment) {
        await paymentService.cancelPaymentOnCoachDecline(payment.id, { transaction: t });
      } else {
        await applyBookingStatusTransition(booking, {
          toStatus: 'cancelled',
          via: BookingTransitionVia.COACH_DECLINE,
          patch: {
            cancelled_by: 'coach',
            cancelled_at: new Date(),
          },
          options: { transaction: t },
        });
        await logAudit(req.user.id, 'booking_declined_by_coach', 'bookings', booking.id, null, { status: 'cancelled' }, req);
      }

      const now = new Date();
      await booking.update(
        {
          declined_at: now,
          decline_message_to_student: noteToStore,
          decline_reason_code: codeToStore,
        },
        { transaction: t },
      );

      await CancellationHistory.create(
        {
          booking_id: booking.id,
          cancelled_by: 'coach',
          reason: 'other',
          reason_notes: (noteToStore || 'Coach declined').substring(0, 255),
          affects_reliability: false,
          refund_amount: 0,
          penalty_amount: 0,
        },
        { transaction: t },
      );
    });

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        primaryStudentInclude(),
      ],
    });

    void notificationService.notifyBookingDeclined(id).catch((err) => {
      logger.warn({ component: 'booking', event: 'decline_notify_failed', bookingId: id, message: err?.message });
    });

    return successResponse(
      res,
      serializeBookingListItem(updated, { includeStudentReliability: true, viewerIsPrivileged: true }),
      'Booking declined',
    );
  } catch (error) {
    if (error?.statusCode === 404) return errorResponse(res, error.message, 404);
    if (error?.statusCode === 403) return errorResponse(res, error.message, 403);
    if (error?.statusCode === 400) return errorResponse(res, error.message, 400);
    const sm = respondIfBookingStateMachineError(res, error);
    if (sm) return sm;
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
    const isParticipant = isCoach || isStudent;
    const isAdminRoute = (req.baseUrl || '').includes('/admin');
    if (isAdmin && !isAdminRoute && !isParticipant) {
      return errorResponse(res, 'Use /api/admin/bookings/:id/cancel for admin cancellation', 403);
    }
    if (!isAdmin && !isCoach && !isStudent) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const cancelledBy = isCoach ? 'coach' : isStudent ? 'student' : 'admin';
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
    let queuedCancelRefundPaymentActionId = null;

    /**
     * Lock booking row first (`SELECT ... FOR UPDATE`), re-check status, then enqueue refund / void PI, then persist.
     * Prevents concurrent cancels; Stripe execution runs via `payment_actions` worker.
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
          assertBookingStatusAllowsPreLessonCancel(booking.status);
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
          'Only pending or confirmed bookings can be cancelled before the lesson starts. Use post-lesson workflows for completion, attendance, or disputes.',
        );
        err.statusCode = 400;
        err.code = 'cancel_pre_lesson_only';
        err.booking_status = booking.status;
        throw err;
      }

      assertPreLessonCancelAllowed(booking.scheduled_at, new Date());

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
          const queued = await PaymentAction.create(
            {
              booking_id: booking.id,
              payment_id: payment.id,
              dispute_id: null,
              action_type: 'booking_cancel_refund',
              status: 'pending',
              refund_cents: refundCents,
              idempotency_key: null,
              stripe_idempotency_key: null,
              attempts: 0,
            },
            { transaction: t },
          );
          queuedCancelRefundPaymentActionId = queued.id;
          refundPaymentId = payment.id;
        }
      }
      if (!payment?.charge_id && payment?.payment_intent_id && ['pending', 'authorized'].includes(payment.payment_status)) {
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
          ...cancellationFinancialsForHistory({
            voidedPaymentId,
            refund_amount,
            penalty_amount,
            penalty_reason,
          }),
        },
        { transaction: t },
      );

      if (refundPaymentId) {
        await cancellationHistory.update({ refund_payment_id: refundPaymentId }, { transaction: t });
      }

      const queueLateCancelCoachPayout = shouldQueueLateCancelCoachPayout({
        bookingStatus: 'cancelled',
        cancelledBy,
        penaltyCents,
        penaltyReason,
        refundPaymentId,
        voidedPaymentId,
      });

      await applyBookingStatusTransition(booking, {
        toStatus: 'cancelled',
        via: BookingTransitionVia.PRE_LESSON_CANCEL,
        patch: {
          cancelled_by: cancelledBy,
          cancelled_at: new Date(),
          ...(queueLateCancelCoachPayout ? { payout_status: 'pending' } : {}),
        },
        options: { transaction: t },
      });
    });

    afterBooking = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        primaryStudentInclude(),
      ],
    });
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
        queued_refund_payment_action_id: queuedCancelRefundPaymentActionId,
        total_charge_cents: totalChargeCents,
        refund_cents: voidedPaymentId ? 0 : refundCents,
        retained_penalty_cents: voidedPaymentId ? 0 : penaltyCents,
        is_late_cancel: isLateCancel,
        cancelled_by: cancelledBy,
        penalty_reason: voidedPaymentId ? null : penaltyReason,
        uncaptured_authorization_voided: Boolean(voidedPaymentId),
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
        if (userToUpdate) {
          const reliabilityRole = cancelledBy === 'coach' ? 'coach' : 'student';
          await updateUserReliability(userIdToUpdate, reliabilityRole).catch((err) => {
            logger.error('Failed to update reliability after cancellation:', err);
          });
        }
      }
    }

    void notificationService.notifyBookingCancelled(id, {
      cancelledBy,
      reason,
      reason_notes: cancellationHistory.reason_notes,
      refund_amount: cancellationHistory.refund_amount,
      penalty_amount: cancellationHistory.penalty_amount,
      refund_status: queuedCancelRefundPaymentActionId
        ? 'pending_stripe_execution'
        : voidedPaymentId
          ? 'voided_authorization'
          : null,
    }).catch((err) => {
      logger.warn({ component: 'booking', event: 'cancel_notify_failed', bookingId: id, message: err?.message });
    });

    const cancellationPayload = buildCancellationApiPayload(cancellationHistory, {
      isLateCancel,
    });

    return successResponse(
      res,
      {
        booking: serializeBookingListItem(afterBooking, coachViewerSerializeOptions(req.user.id, afterBooking, req.user.roles || [])),
        cancellation: cancellationPayload,
        ...(queuedCancelRefundPaymentActionId
          ? {
              refund: {
                queued: true,
                payment_action_id: queuedCancelRefundPaymentActionId,
                refund_amount: paymentService.centsToDecimalString(refundCents),
                refund_status: 'pending_stripe_execution',
              },
            }
          : {}),
      },
      'Booking cancelled successfully',
    );
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
    if (!ADMIN_MARK_NO_SHOW_SOURCE_STATUSES.includes(booking.status)) {
      return errorResponse(
        res,
        `Cannot mark coach_no_show from status ${booking.status}. Allowed: ${ADMIN_MARK_NO_SHOW_SOURCE_STATUSES.join(', ')}.`,
        400,
        null,
        { booking_status: booking.status },
      );
    }
    const activeDispute = await Dispute.findOne({
      where: {
        booking_id: booking.id,
        status: { [Op.in]: [...ACTIVE_DISPUTE_STATUSES] },
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
    const finalizedCheck = checkAttendanceFinalized(booking);
    if (!finalizedCheck.ok) {
      return errorResponse(res, finalizedCheck.message, 409, null, {
        code: finalizedCheck.code,
        booking_status: booking.status,
      });
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

    const scheduledCoachRefund = {
      enqueue: false,
      paymentId: null,
      refundCents: 0,
      skipReason: 'no_refundable_payment',
    };
    const refundStatePreTxn = await paymentService.getLatestBookingRefundState(booking.id);
    const payPre = refundStatePreTxn.payment;
    if (!payPre) {
      scheduledCoachRefund.skipReason = 'payment_missing';
    } else if (!payPre.charge_id) {
      scheduledCoachRefund.paymentId = payPre.id;
      scheduledCoachRefund.skipReason = 'charge_missing';
    } else {
      scheduledCoachRefund.paymentId = payPre.id;
      const remainingCents = Math.max(
        0,
        refundStatePreTxn.chargeAmountCents - refundStatePreTxn.refundedSoFarCents,
      );
      if (payPre.refund_status === 'pending') {
        scheduledCoachRefund.skipReason = 'refund_pending';
      } else if (refundStatePreTxn.hasQueuedPaymentActionRefund) {
        scheduledCoachRefund.skipReason = 'refund_pipeline_pending';
      } else if (remainingCents < 1) {
        scheduledCoachRefund.skipReason = 'already_fully_refunded';
      } else if (!['captured', 'partially_refunded'].includes(payPre.payment_status)) {
        scheduledCoachRefund.skipReason = `payment_status_not_refundable:${payPre.payment_status}`;
      } else {
        scheduledCoachRefund.enqueue = true;
        scheduledCoachRefund.refundCents = remainingCents;
        scheduledCoachRefund.skipReason = null;
      }
    }

    let coachRefundPaymentActionId = null;

    await sequelize.transaction(async (tx) => {
      const locked = await Booking.findByPk(id, { transaction: tx, lock: tx.LOCK.UPDATE });
      if (!locked) {
        const err = new Error('Booking not found');
        err.statusCode = 404;
        throw err;
      }
      if (locked.status !== fromStatus) {
        const err = new Error('Booking changed while processing. Refresh and retry.');
        err.statusCode = 409;
        err.code = 'booking_concurrent_update';
        err.booking_status = locked.status;
        throw err;
      }
      if (!ADMIN_MARK_NO_SHOW_SOURCE_STATUSES.includes(locked.status)) {
        const err = new Error(
          `Cannot mark coach_no_show from status ${locked.status}. Allowed: ${ADMIN_MARK_NO_SHOW_SOURCE_STATUSES.join(', ')}.`,
        );
        err.statusCode = 400;
        err.booking_status = locked.status;
        throw err;
      }

      await applyBookingStatusTransition(locked, {
        toStatus: 'coach_no_show',
        via: BookingTransitionVia.ADMIN_MARK_COACH_NO_SHOW,
        patch: {},
        options: { transaction: tx },
      });

      if (scheduledCoachRefund.enqueue && scheduledCoachRefund.paymentId) {
        const created = await PaymentAction.create(
          {
            booking_id: locked.id,
            payment_id: scheduledCoachRefund.paymentId,
            dispute_id: null,
            action_type: 'booking_coach_no_show_refund',
            status: 'pending',
            refund_cents: scheduledCoachRefund.refundCents,
            idempotency_key: null,
            stripe_idempotency_key: null,
            attempts: 0,
          },
          { transaction: tx },
        );
        coachRefundPaymentActionId = created.id;
      }
    });

    const updated = await Booking.findByPk(id, {
      include: [
        { model: Lesson, as: 'lesson' },
        { model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] },
        primaryStudentInclude(),
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
      if (coachUser) {
        await updateUserReliability(booking.coach_id, 'coach').catch((err) =>
          logger.error('Failed to update reliability after coach_no_show:', err),
        );
      }
    }

    const autoRefund = {
      status: coachRefundPaymentActionId ? 'queued' : 'skipped',
      reason: coachRefundPaymentActionId ? null : scheduledCoachRefund.skipReason,
      payment_id: scheduledCoachRefund.paymentId,
      refund_cents: coachRefundPaymentActionId ? scheduledCoachRefund.refundCents : 0,
      stripe_refund_id: null,
      payment_action_id: coachRefundPaymentActionId,
      refund_status: coachRefundPaymentActionId ? 'pending_stripe_execution' : null,
    };

    const responseData = serializeBookingResponse(
      updated,
      {
        attendance_outcome: 'coach_no_show',
        no_show_party: 'coach',
        auto_refund: autoRefund,
      },
      coachViewerSerializeOptions(req.user.id, updated, req.user.roles || []),
    );
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
      const extra =
        error.code && typeof error.code === 'string'
          ? {
              code: error.code,
              ...(error.booking_status && { booking_status: error.booking_status }),
            }
          : null;
      return errorResponse(res, error.message, 409, null, extra);
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
    if (!ADMIN_MARK_NO_SHOW_SOURCE_STATUSES.includes(booking.status)) {
      return errorResponse(
        res,
        `Cannot mark student_no_show from status ${booking.status}. Allowed: ${ADMIN_MARK_NO_SHOW_SOURCE_STATUSES.join(', ')}.`,
        400,
        null,
        { booking_status: booking.status },
      );
    }

    const activeDispute = await Dispute.findOne({
      where: {
        booking_id: booking.id,
        status: { [Op.in]: [...ACTIVE_DISPUTE_STATUSES] },
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
    const finalizedCheck = checkAttendanceFinalized(booking);
    if (!finalizedCheck.ok) {
      return errorResponse(res, finalizedCheck.message, 409, null, {
        code: finalizedCheck.code,
        booking_status: booking.status,
      });
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
    await applyBookingStatusTransition(booking, {
      toStatus: 'student_no_show',
      via: BookingTransitionVia.ADMIN_MARK_STUDENT_NO_SHOW,
      patch: {},
    });
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
        primaryStudentInclude(),
      ],
    });
    if (booking.primary_student_id != null) {
      await updateUserReliability(booking.primary_student_id, 'student').catch((err) =>
        logger.error('Failed to update student reliability after admin student_no_show:', err),
      );
    }
    const responseData = serializeBookingResponse(
      updated,
      {
        attendance_outcome: 'student_no_show',
        no_show_party: 'student',
      },
      coachViewerSerializeOptions(req.user.id, updated, req.user.roles || []),
    );
    return successResponse(res, responseData, 'Booking marked as student_no_show');
  } catch (error) {
    const sm = respondIfBookingStateMachineError(res, error);
    if (sm) return sm;
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
        status: { [Op.in]: [...ACTIVE_DISPUTE_STATUSES] },
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

    const pa = await PaymentAction.create({
      booking_id: booking.id,
      payment_id: payment.id,
      dispute_id: null,
      action_type: 'booking_admin_refund',
      status: 'pending',
      refund_cents: refundCents,
      idempotency_key: null,
      stripe_idempotency_key: null,
      attempts: 0,
    });

    await logAudit(
      req.user.id,
      'admin_booking_refund_queued',
      'bookings',
      booking.id,
      null,
      {
        payment_id: payment.id,
        payment_action_id: pa.id,
        refund_cents: refundCents,
        reason: reason || 'requested_by_customer',
        reason_notes: reason_notes || null,
        refund_status: 'pending_stripe_execution',
      },
      req,
    );

    return successResponse(
      res,
      {
        queued: true,
        booking_id: booking.id,
        payment_id: payment.id,
        payment_action_id: pa.id,
        refund_amount: paymentService.centsToDecimalString(refundCents),
        refund_status: 'pending_stripe_execution',
        stripe_refund_id: null,
        reason: reason || 'requested_by_customer',
      },
      'Booking refund queued; Stripe executes via worker',
    );
  } catch (error) {
    logger.error('Admin refund booking error:', error);
    return errorResponse(res, error.message || 'Failed to refund booking', 500);
  }
};
