import { Booking } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as paymentService from '../services/paymentService.js';
import {
  getCoachAcceptanceTimeoutHours,
  getMinBookingLeadHours,
  isWithinCoachAcceptanceWindow,
} from '../utils/coachAcceptanceTimeout.js';

/**
 * Cancel authorized pending bookings when the coach acceptance window has closed:
 * earlier of (request + COACH_ACCEPTANCE_TIMEOUT_HOURS) or (lesson − MIN_BOOKING_LEAD_HOURS).
 * Frees the slot and voids uncaptured PaymentIntents.
 *
 * This is a **coach-action timeout**, not a payment-authorization timeout — bookings only
 * exist after authorization succeeds in the authorize-first flow.
 */
export const expireStalePendingBookings = async () => {
  const maxHours = getCoachAcceptanceTimeoutHours();
  const leadHours = getMinBookingLeadHours();
  const now = new Date();
  const requestCutoff = new Date(now.getTime() - maxHours * 60 * 60 * 1000);
  // Lesson starts within leadHours → acceptance deadline (lesson − lead) has already passed.
  const lessonCutoff = new Date(now.getTime() + leadHours * 60 * 60 * 1000);

  const candidates = await Booking.findAll({
    where: {
      status: 'pending',
      [Op.or]: [
        { created_at: { [Op.lt]: requestCutoff } },
        { scheduled_at: { [Op.lte]: lessonCutoff } },
      ],
    },
    attributes: ['id', 'created_at', 'scheduled_at'],
    order: [['id', 'ASC']],
    limit: 200,
  });

  const stale = candidates.filter((row) => !isWithinCoachAcceptanceWindow({
    requestAt: row.created_at,
    scheduledAt: row.scheduled_at,
    now,
    maxHours,
    leadHours,
  }));

  let expired = 0;
  for (const row of stale) {
    try {
      const result = await paymentService.expirePendingBookingNoCoachResponse(row.id);
      if (result.expired) expired += 1;
    } catch (error) {
      logger.error({
        component: 'worker',
        event: 'pending_booking_expiry_failed',
        bookingId: row.id,
        message: error?.message || String(error),
      });
    }
  }

  if (candidates.length > 0) {
    logger.info({
      component: 'worker',
      event: 'pending_booking_expiry_run',
      expiryHours: maxHours,
      minLeadHours: leadHours,
      candidates: candidates.length,
      stale: stale.length,
      expired,
    });
  }
};
