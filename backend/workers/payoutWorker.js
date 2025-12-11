import { Booking, Payment, User, CoachProfile } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as paymentService from '../services/paymentService.js';

/**
 * Process payouts for completed bookings
 * Runs every 10 minutes
 */
export const processPayouts = async () => {
  try {
    // Find payments that are:
    // 1. In 'held' escrow status
    // 2. Associated with completed bookings
    // 3. No open disputes
    const payments = await Payment.findAll({
      where: {
        escrow_status: 'held',
        payment_status: 'captured',
      },
      include: [
        {
          model: Booking,
          as: 'booking',
          where: {
            status: { [Op.in]: ['completed', 'awaiting_verification'] },
            payout_status: { [Op.in]: ['none', 'pending', 'awaiting_verification'] },
          },
          include: [
            {
              model: Payment,
              as: 'payments',
            },
          ],
        },
        {
          model: User,
          as: 'coach',
          include: [
            {
              model: CoachProfile,
              as: 'coachProfile',
            },
          ],
        },
      ],
    });

    for (const payment of payments) {
      try {
        // Check for open disputes
        const disputes = await payment.booking.getDisputes({
          where: {
            status: { [Op.in]: ['open', 'under_review'] },
          },
        });

        if (disputes.length > 0) {
          logger.info(`Skipping payout for payment ${payment.id} - open dispute exists`);
          continue;
        }

        // Check if booking is completed (or auto-confirmed)
        if (payment.booking.status !== 'completed') {
          // Only process if it's been 24 hours since scheduled time
          const scheduledTime = new Date(payment.booking.scheduled_at);
          const now = new Date();
          const hoursSinceScheduled = (now - scheduledTime) / (1000 * 60 * 60);

          if (hoursSinceScheduled < 24) {
            continue; // Not ready yet
          }
        }

        // Get coach's Stripe Connect account ID (if available)
        // TODO: Store this in coach profile or user metadata
        const coachStripeAccountId = payment.coach.coachProfile?.stripe_account_id || null;

        // Process payout
        await paymentService.releaseEscrow(payment.id, coachStripeAccountId);

        // Update booking payout status
        await payment.booking.update({
          payout_status: 'processing',
        });

        logger.info(`Processed payout for payment ${payment.id}`);
      } catch (error) {
        logger.error(`Error processing payout for payment ${payment.id}:`, error);
        // Continue with next payment
      }
    }

    logger.info(`Payout worker processed ${payments.length} payments`);
  } catch (error) {
    logger.error('Error in payout worker:', error);
    throw error;
  }
};

