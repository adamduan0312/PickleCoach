import { Booking, Payment, User, CoachProfile, CancellationHistory, PaymentAction } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as paymentService from '../services/paymentService.js';
import { ACTIVE_DISPUTE_STATUSES } from '../services/disputeStateMachine.js';
import {
  isLateCancelRetainedRevenueEligibleFromHistory,
  isLateCancelRefundSettledForPayout,
} from '../utils/lateCancelPayout.js';
import { isPaymentEscrowPayable } from '../utils/payoutEscrowEligibility.js';

/**
 * Process payouts for completed bookings and student late-cancels with retained revenue.
 * Runs every 10 minutes
 *
 * Selection: payments with booking.status in completed / student_no_show,
 * or cancelled with a student late-cancel penalty on cancellation_history (coach compensation).
 *
 * `awaiting_verification` is intentionally excluded: the 24h post-lesson window ends when
 * `autoConfirmWorker` moves the booking to `completed` (lesson end + 24h). Payout runs on
 * `completed` so lifecycle, dispute window, and money stay aligned.
 */
export const processPayouts = async () => {
  try {
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
            status: {
              [Op.in]: ['completed', 'student_no_show', 'cancelled'],
            },
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
        // Defense-in-depth: never release money on booking status alone. A
        // `completed` booking can still have `escrow_status = 'disputed'`
        // (chargeback-opened dispute resolved back to completed without Stripe
        // escrow reconciliation). Escrow state is the payout authority.
        if (!isPaymentEscrowPayable(payment)) {
          logger.info(
            `Skipping payout for payment ${payment.id} - escrow_status "${payment.escrow_status}" not payable`,
          );
          continue;
        }

        if (payment.booking.status === 'cancelled') {
          const history = await CancellationHistory.findOne({
            where: { booking_id: payment.booking_id },
            order: [['id', 'DESC']],
          });
          if (!isLateCancelRetainedRevenueEligibleFromHistory(history)) {
            continue;
          }
          const pendingCancelRefund = await PaymentAction.findOne({
            where: {
              booking_id: payment.booking_id,
              action_type: 'booking_cancel_refund',
              status: 'pending',
            },
          });
          if (pendingCancelRefund) {
            logger.info(`Skipping late-cancel payout for payment ${payment.id} - cancel refund action pending`);
            continue;
          }
          if (payment.refund_status === 'pending') {
            logger.info(`Skipping late-cancel payout for payment ${payment.id} - refund pending`);
            continue;
          }
          if (!isLateCancelRefundSettledForPayout(payment)) {
            logger.info(`Skipping late-cancel payout for payment ${payment.id} - partial refund not settled yet`);
            continue;
          }
        }

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

        // Dispute-approved refunds enqueue payment_actions before refund_status flips to pending.
        // Block escrow release until those actions finish (same idea as booking_cancel_refund).
        const pendingDisputeRefund = await PaymentAction.findOne({
          where: {
            booking_id: payment.booking_id,
            action_type: { [Op.in]: ['dispute_refund_full', 'dispute_refund_partial'] },
            status: 'pending',
          },
        });
        if (pendingDisputeRefund) {
          logger.info(
            `Skipping payout for payment ${payment.id} - dispute refund action pending (${pendingDisputeRefund.action_type})`,
          );
          continue;
        }

        // Refunds are finalized from Stripe charge webhooks; do not release escrow while refund is pending.
        if (payment.refund_status === 'pending') {
          logger.info(`Skipping payout for payment ${payment.id} - refund pending`);
          continue;
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

