import { Booking } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as paymentService from '../services/paymentService.js';

const expiryHours = () =>
  Math.max(1, Number.parseInt(process.env.PENDING_BOOKING_EXPIRY_HOURS || '24', 10));

/**
 * Cancel pending bookings that are older than PENDING_BOOKING_EXPIRY_HOURS (default 24) with no coach accept/decline.
 * Frees the slot and voids uncaptured PaymentIntents.
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
