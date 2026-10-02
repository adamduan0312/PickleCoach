import { UniqueConstraintError } from 'sequelize';
import { sequelize, Booking, WeatherCancellationRequest } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { logger } from '../config/logger.js';
import * as notificationService from '../services/notificationService.js';
import {
  effectiveWeatherRequestStatus,
  serializeWeatherCancellation,
  weatherRequestEligibility,
} from '../utils/weatherCancellation.js';
import { runPreLessonCancel } from './bookingController.js';

function httpError(statusCode, message, code = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function participantRole(userId, booking) {
  if (Number(userId) === Number(booking.coach_id)) return 'coach';
  if (Number(userId) === Number(booking.primary_student_id)) return 'student';
  return null;
}

function respondWithError(res, error, label) {
  if (error instanceof UniqueConstraintError || error?.name === 'SequelizeUniqueConstraintError') {
    return errorResponse(
      res,
      'You’ve already sent a weather cancellation request for this lesson.',
      400,
      null,
      { code: 'weather_request_already_used' },
    );
  }
  if ([400, 403, 404].includes(error.statusCode)) {
    return errorResponse(res, error.message, error.statusCode, null, error.code ? { code: error.code } : null);
  }
  logger.error(`${label}:`, error);
  return errorResponse(res, 'Something went wrong. Please try again.', 500);
}

async function weatherBlockFor(bookingId, booking, viewerRole) {
  const rows = await WeatherCancellationRequest.findAll({ where: { booking_id: bookingId } });
  return serializeWeatherCancellation(rows.map((r) => r.toJSON()), { booking, viewerRole });
}

/** POST /api/bookings/:id/weather-cancellation */
export const requestWeatherCancellation = async (req, res) => {
  try {
    const { id } = req.params;
    const note = String(req.validated?.note || '').trim() || null;
    let created = null;
    let booking = null;
    let requesterRole = null;

    await sequelize.transaction(async (t) => {
      booking = await Booking.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!booking) throw httpError(404, 'Booking not found');
      requesterRole = participantRole(req.user.id, booking);
      if (!requesterRole) throw httpError(403, 'Unauthorized');

      const requests = await WeatherCancellationRequest.findAll({
        where: { booking_id: booking.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      const eligibility = weatherRequestEligibility({ booking, requesterRole, requests });
      if (!eligibility.ok) throw httpError(400, eligibility.message, eligibility.code);

      created = await WeatherCancellationRequest.create(
        {
          booking_id: booking.id,
          requested_by_role: requesterRole,
          requested_by_user_id: req.user.id,
          note,
          status: 'pending',
          expires_at: booking.scheduled_at,
        },
        { transaction: t },
      );
    });

    await logAudit(req.user.id, 'weather_cancellation_requested', 'weather_cancellation_requests', created.id, null, created.toJSON(), req);
    void notificationService
      .notifyWeatherCancellationRequested(booking.id, { requesterRole, note })
      .catch((err) => logger.warn({ component: 'booking', event: 'weather_request_notify_failed', bookingId: booking.id, message: err?.message }));

    return successResponse(
      res,
      { weather_cancellation: await weatherBlockFor(booking.id, booking, requesterRole) },
      'Weather cancellation requested',
      201,
    );
  } catch (error) {
    return respondWithError(res, error, 'Request weather cancellation error');
  }
};

/** POST /api/bookings/:id/weather-cancellation/:requestId/accept — cancels with a full refund. */
export const acceptWeatherCancellation = async (req, res) => {
  const requestId = Number(req.params.requestId);
  if (!Number.isInteger(requestId) || requestId < 1) {
    return errorResponse(res, 'Weather cancellation request not found.', 404);
  }
  return runPreLessonCancel(req, res, { requestId });
};

function respondToRequest(action) {
  const label = action === 'decline' ? 'Decline weather cancellation error' : 'Withdraw weather cancellation error';
  return async (req, res) => {
    try {
      const { id, requestId } = req.params;
      let booking = null;
      let request = null;
      let viewerRole = null;

      await sequelize.transaction(async (t) => {
        booking = await Booking.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!booking) throw httpError(404, 'Booking not found');
        viewerRole = participantRole(req.user.id, booking);
        if (!viewerRole) throw httpError(403, 'Unauthorized');

        request = await WeatherCancellationRequest.findOne({
          where: { id: Number(requestId) || 0, booking_id: booking.id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!request) throw httpError(404, 'Weather cancellation request not found.');

        const status = effectiveWeatherRequestStatus(request, booking);
        if (status !== 'pending') {
          throw httpError(400, 'This weather cancellation request is no longer open.', `weather_request_${status}`);
        }
        const isOwn = request.requested_by_role === viewerRole;
        if (action === 'decline' && isOwn) {
          throw httpError(400, 'You can’t respond to your own request. Withdraw it instead.', 'weather_request_own');
        }
        if (action === 'withdraw' && !isOwn) {
          throw httpError(403, 'Only the person who asked can withdraw this request.', 'weather_request_not_own');
        }

        await request.update(
          {
            status: action === 'decline' ? 'declined' : 'withdrawn',
            responded_by_user_id: req.user.id,
            responded_at: new Date(),
          },
          { transaction: t },
        );
      });

      await logAudit(req.user.id, `weather_cancellation_${action === 'decline' ? 'declined' : 'withdrawn'}`, 'weather_cancellation_requests', request.id, null, request.toJSON(), req);
      if (action === 'decline') {
        void notificationService
          .notifyWeatherCancellationDeclined(booking.id, { requesterRole: request.requested_by_role })
          .catch((err) => logger.warn({ component: 'booking', event: 'weather_decline_notify_failed', bookingId: booking.id, message: err?.message }));
      }

      return successResponse(
        res,
        { weather_cancellation: await weatherBlockFor(booking.id, booking, viewerRole) },
        action === 'decline' ? 'Weather cancellation declined' : 'Weather cancellation request withdrawn',
      );
    } catch (error) {
      return respondWithError(res, error, label);
    }
  };
}

/** POST /api/bookings/:id/weather-cancellation/:requestId/decline */
export const declineWeatherCancellation = respondToRequest('decline');

/** POST /api/bookings/:id/weather-cancellation/:requestId/withdraw */
export const withdrawWeatherCancellation = respondToRequest('withdraw');
