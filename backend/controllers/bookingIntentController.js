import * as bookingIntentService from '../services/bookingIntentService.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

const generateIntentIdempotencyKey = (studentId) =>
  `booking_intent_${studentId}_${Date.now()}_${crypto.randomUUID()}`;

function getCreateBookingErrorDetail(error, isDev) {
  if (!isDev) return null;
  const raw = error?.message || String(error);
  const isStripeKeyError = /api key|Authorization header|STRIPE|Bearer YOUR_SECRET_KEY/i.test(raw);
  if (isStripeKeyError) {
    return {
      detail: raw,
      hint: 'Set STRIPE_SECRET_KEY in your env file so the server can authenticate to Stripe.',
    };
  }
  return { detail: raw };
}

export const createBookingIntent = async (req, res) => {
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
      generateIntentIdempotencyKey(req.user.id);

    const result = await bookingIntentService.createBookingIntent({
      studentId: req.user.id,
      studentRoles: req.user.roles || [],
      lessonId: lesson_id,
      scheduledAt: scheduled_at,
      durationMinutes: duration_minutes,
      courtLocationId: court_location_id,
      playerIds: player_ids,
      paymentMethod: payment_method,
      paymentMethodId: payment_method_id || null,
      idempotencyKey: requestIdempotencyKey,
    });

    return successResponse(res, result, 'Booking intent created. Authorize payment, then POST /api/bookings/confirm.', 201);
  } catch (error) {
    if (error.statusCode && error.code) {
      return errorResponse(res, error.message, error.statusCode, null, { code: error.code });
    }
    if (error.statusCode) {
      return errorResponse(res, error.message, error.statusCode);
    }
    logger.error('Create booking intent error:', error);
    const isDev = process.env.NODE_ENV !== 'production';
    return errorResponse(
      res,
      'Failed to create booking intent',
      500,
      isDev ? getCreateBookingErrorDetail(error, true) : null,
    );
  }
};
