import { Payment, Payout, Booking } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { createAuditLog } from '../utils/audit.js';
import * as stripeService from '../services/stripeService.js';

/**
 * Does NOT write payment capture/refund state from polling Stripe.
 * Payment finalization is webhook-driven; this worker only logs and audits for ops follow-up.
 */
export const retryFailedPayments = async () => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const failedPayments = await Payment.findAll({
      where: {
        payment_status: 'failed',
        payment_intent_id: { [Op.ne]: null },
        created_at: {
          [Op.gte]: twentyFourHoursAgo,
        },
      },
      include: [{ model: Booking, as: 'booking' }],
      limit: 50,
    });

    for (const payment of failedPayments) {
      try {
        if (!payment.payment_intent_id) {
          continue;
        }

        const paymentIntent = await stripeService.getPaymentIntent(payment.payment_intent_id);

        if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_confirmation') {
          logger.info(
            `Payment ${payment.id} requires customer action. PaymentIntent status: ${paymentIntent.status}`
          );
          await createAuditLog({
            user_id: payment.student_id,
            action: 'payment_retry_attempted',
            table_name: 'payments',
            record_id: payment.id,
            after_state: { payment_intent_status: paymentIntent.status },
          });
        } else if (paymentIntent.status === 'succeeded') {
          logger.warn(
            `[reconcile] Payment ${payment.id}: Stripe shows PaymentIntent succeeded but local status is failed — ` +
              'check webhook logs or resend payment_intent.succeeded from Stripe Dashboard'
          );
          await createAuditLog({
            user_id: payment.student_id,
            action: 'payment_stripe_mismatch_logged',
            table_name: 'payments',
            record_id: payment.id,
            after_state: { payment_intent_status: paymentIntent.status, local_status: payment.payment_status },
          });
        }
      } catch (error) {
        logger.error(`Error inspecting payment ${payment.id}:`, error);
      }
    }

    const failedPayouts = await Payout.findAll({
      where: {
        status: 'failed',
        created_at: {
          [Op.gte]: twentyFourHoursAgo,
        },
      },
      include: [
        {
          model: Payment,
          as: 'payment',
          include: [{ model: Booking, as: 'booking' }],
        },
      ],
      limit: 50,
    });

    for (const payout of failedPayouts) {
      try {
        logger.info(`Payout ${payout.id} failed and may need manual retry`);
        await createAuditLog({
          user_id: payout.coach_id,
          action: 'payout_retry_attempted',
          table_name: 'payouts',
          record_id: payout.id,
          after_state: { status: 'failed' },
        });
      } catch (error) {
        logger.error(`Error logging payout ${payout.id}:`, error);
      }
    }

    logger.info(
      `Retry worker scanned ${failedPayments.length} failed payments and ${failedPayouts.length} failed payouts (no payment state writes)`
    );
  } catch (error) {
    logger.error('Error in retry failed payments worker:', error);
    throw error;
  }
};
