import { Booking, Payment } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { createAuditLog } from '../utils/audit.js';

/**
 * Auto-confirm lessons that are past scheduled time and haven't been confirmed
 * Runs every 5 minutes
 */
export const autoConfirmLessons = async () => {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    // Find bookings that:
    // 1. Are in 'awaiting_verification' status
    // 2. Scheduled time has passed
    // 3. No coach confirmation within 24 hours
    const bookings = await Booking.findAll({
      where: {
        status: 'awaiting_verification',
        scheduled_at: {
          [Op.lte]: twentyFourHoursAgo, // Scheduled at least 24 hours ago
        },
      },
      include: [
        {
          model: Payment,
          as: 'payments',
          required: false,
        },
      ],
    });

    for (const booking of bookings) {
      // Check if there's an open dispute
      const hasOpenDispute = await booking.getDisputes({
        where: {
          status: { [Op.in]: ['open', 'under_review'] },
        },
      });

      if (hasOpenDispute.length > 0) {
        logger.info(`Skipping auto-confirm for booking ${booking.id} - open dispute exists`);
        continue;
      }

      // Auto-confirm the booking
      await booking.update({
        status: 'completed',
        payout_status: 'pending', // Ready for payout processing
      });

      await createAuditLog({
        user_id: null,
        action: 'booking_auto_confirmed',
        table_name: 'bookings',
        record_id: booking.id,
        after_state: { status: 'completed', payout_status: 'pending' },
      });

      logger.info(`Auto-confirmed booking ${booking.id}`);
    }

    logger.info(`Auto-confirm worker processed ${bookings.length} bookings`);
  } catch (error) {
    logger.error('Error in auto-confirm worker:', error);
    throw error;
  }
};

