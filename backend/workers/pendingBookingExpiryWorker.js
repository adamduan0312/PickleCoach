import { Booking } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as paymentService from '../services/paymentService.js';

/** Coach must accept/decline within this window (authorize-first: booking is already authorized). */
const expiryHours = () => {
  const raw =
    process.env.COACH_ACCEPTANCE_TIMEOUT_HOURS ??
    process.env.PENDING_BOOKING_EXPIRY_HOURS ??
    '24';
  return Math.max(1, Number.parseInt(raw, 10));
};

/**
 * Cancel authorized pending bookings when the coach does not accept or decline in time.
 * Frees the slot and voids uncaptured PaymentIntents (authorized manual-capture holds).
 *
 * This is a **coach-action timeout**, not a payment-authorization timeout — bookings only
 * exist after authorization succeeds in the authorize-first flow.
 */
export const expireStalePendingBookings = async () => {
  const hours = expiryHours();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const stale = await Booking.findAll({
    where: {
      status: 'pending',
      created_at: { [Op.lt]: cutoff },
    },
    attributes: ['id'],
    order: [['id', 'ASC']],
    limit: 200,
  });

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

  if (stale.length > 0) {
    logger.info({
      component: 'worker',
      event: 'pending_booking_expiry_run',
      expiryHours: hours,
      candidates: stale.length,
      expired,
    });
  }
};
