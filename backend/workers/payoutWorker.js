import { Booking, Payment, User, CoachProfile } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as paymentService from '../services/paymentService.js';
import { ACTIVE_DISPUTE_STATUSES } from '../services/disputeStateMachine.js';

/**
 * Process payouts for completed bookings
 * Runs every 10 minutes
 *
 * Selection: only payments with booking.status in completed / awaiting_verification / student_no_show
 * (and payout gating). student_no_show is payable because coach reserved and delivered attendance.
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
        payment_status: { [Op.in]: ['captured', 'partially_refunded'] },
      },
      include: [
        {
          model: Booking,
          as: 'booking',
          where: {
            status: { [Op.in]: ['completed', 'awaiting_verification', 'student_no_show'] },
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
          attributes: ['id', 'full_name', 'email'],
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
            status: { [Op.in]: [...ACTIVE_DISPUTE_STATUSES] },
          },
        });

        if (disputes.length > 0) {
          logger.info(`Skipping payout for payment ${payment.id} - open dispute exists`);
          continue;
        }

        // Refunds are finalized from Stripe charge webhooks; do not release escrow while refund is pending.
        if (payment.refund_status === 'pending') {
          logger.info(`Skipping payout for payment ${payment.id} - refund pending`);
          continue;
        }

        // completed and student_no_show are payable immediately once selected.
        // awaiting_verification keeps the 24h delay fallback.
        if (payment.booking.status === 'awaiting_verification') {
          // Only process if it's been 24 hours since scheduled time
          const scheduledTime = new Date(payment.booking.scheduled_at);
          const now = new Date();
          const hoursSinceScheduled = (now - scheduledTime) / (1000 * 60 * 60);

          if (hoursSinceScheduled < 24) {
            continue; // Not ready yet
          }
        }

        // Get coach's Stripe Connect account ID from coach profile
        // This is stored in coach_profiles.stripe_account_id when coach completes Stripe onboarding
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

