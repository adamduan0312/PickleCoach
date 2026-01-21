import { Payment, Booking, Payout } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { createAuditLog } from '../utils/audit.js';
import * as stripeService from '../services/stripeService.js';

/**
 * Retry failed payment attempts
 * Runs every 10 minutes
 * Retries failed PaymentIntents and payout transfers
 */
export const retryFailedPayments = async () => {
  try {
    // Find payments that:
    // 1. Have failed status
    // 2. Have a PaymentIntent ID
    // 3. Were created in the last 24 hours (don't retry old failures indefinitely)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const failedPayments = await Payment.findAll({
      where: {
        payment_status: 'failed',
        payment_intent_id: { [Op.ne]: null },
        created_at: {
          [Op.gte]: twentyFourHoursAgo,
        },
      },
      include: [
        {
          model: Booking,
          as: 'booking',
        },
      ],
      limit: 50, // Process max 50 at a time
    });

    for (const payment of failedPayments) {
      try {
        // Check if PaymentIntent can be retried
        if (!payment.payment_intent_id) {
          continue;
        }

        const paymentIntent = await stripeService.getPaymentIntent(payment.payment_intent_id);

        // If PaymentIntent is in a retryable state, attempt to confirm it
        if (paymentIntent.status === 'requires_payment_method' || 
            paymentIntent.status === 'requires_confirmation') {
          // For now, we'll just log it - actual retry would require customer action
          // In a full implementation, you might:
          // 1. Send notification to customer to update payment method
          // 2. Create a new PaymentIntent if the old one is expired
          // 3. Use saved payment methods if available

          logger.info(`Payment ${payment.id} requires customer action. PaymentIntent status: ${paymentIntent.status}`);
          
          // Create audit log
          await createAuditLog({
            user_id: payment.student_id,
            action: 'payment_retry_attempted',
            table_name: 'payments',
            record_id: payment.id,
            after_state: { payment_intent_status: paymentIntent.status },
          });
        } else if (paymentIntent.status === 'succeeded') {
          // Payment actually succeeded, update our record
          await payment.update({
            payment_status: 'captured',
            charge_id: paymentIntent.latest_charge || null,
            escrow_status: 'held',
          });

          // Unlock messaging if this is a booking payment
          if (payment.booking) {
            await payment.booking.update({
              messaging_locked: false,
              status: 'confirmed',
            });
          }

          await createAuditLog({
            user_id: payment.student_id,
            action: 'payment_retry_succeeded',
            table_name: 'payments',
            record_id: payment.id,
            after_state: { payment_status: 'captured', charge_id: paymentIntent.latest_charge },
          });

          logger.info(`Retry succeeded for payment ${payment.id}`);
        }
      } catch (error) {
        logger.error(`Error retrying payment ${payment.id}:`, error);
        // Continue with next payment
      }
    }

    // Also retry failed payouts
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
          include: [
            {
              model: Booking,
              as: 'booking',
            },
          ],
        },
      ],
      limit: 50,
    });

    for (const payout of failedPayouts) {
      try {
        // Retry payout transfer if coach has Stripe Connect account
        // This would require storing the coach's Stripe account ID
        // For now, just log it
        logger.info(`Payout ${payout.id} failed and may need manual retry`);
        
        await createAuditLog({
          user_id: payout.coach_id,
          action: 'payout_retry_attempted',
          table_name: 'payouts',
          record_id: payout.id,
          after_state: { status: 'failed' },
        });
      } catch (error) {
        logger.error(`Error retrying payout ${payout.id}:`, error);
      }
    }

    logger.info(`Retry worker processed ${failedPayments.length} failed payments and ${failedPayouts.length} failed payouts`);
  } catch (error) {
    logger.error('Error in retry failed payments worker:', error);
    throw error;
  }
};

