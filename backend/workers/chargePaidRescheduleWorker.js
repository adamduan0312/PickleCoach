import { RescheduleHistory, Payment, Booking } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as stripeService from '../services/stripeService.js';

/**
 * Reconciliation / alerting only — does NOT mutate payment or booking state.
 * Paid reschedule completion is owned by Stripe webhooks + paymentService.handlePaymentCapture.
 */
export const processPaidReschedulePayments = async () => {
  try {
    const rescheduleRecords = await RescheduleHistory.findAll({
      where: {
        paid_reschedule: true,
        transaction_id: { [Op.ne]: null },
      },
      include: [
        {
          model: Payment,
          as: 'transaction',
          where: {
            payment_status: { [Op.in]: ['pending', 'captured'] },
          },
          required: true,
        },
        {
          model: Booking,
          as: 'booking',
        },
      ],
    });

    for (const reschedule of rescheduleRecords) {
      const payment = reschedule.transaction;
      if (payment.payment_status !== 'pending' || !payment.payment_intent_id) {
        continue;
      }
      if (reschedule.approval_status !== 'pending') {
        continue;
      }

      try {
        const paymentIntent = await stripeService.getPaymentIntent(payment.payment_intent_id);
        if (paymentIntent.status === 'succeeded') {
          logger.warn(
            `[reconcile] Paid reschedule ${reschedule.id}: PaymentIntent ${paymentIntent.id} succeeded in Stripe ` +
              'but reschedule still pending locally — check webhook delivery or resend event from Stripe Dashboard'
          );
        }
        if (
          paymentIntent.status === 'requires_payment_method' ||
          paymentIntent.status === 'canceled'
        ) {
          logger.warn(
            `[reconcile] Paid reschedule ${reschedule.id}: PaymentIntent ${paymentIntent.id} status=${paymentIntent.status} ` +
              '(webhook should set payment failed / reject reschedule)'
          );
        }
      } catch (error) {
        logger.error(`Error checking PaymentIntent ${payment.payment_intent_id}:`, error);
      }
    }

    logger.info(`Paid reschedule reconciliation scan: ${rescheduleRecords.length} records`);
  } catch (error) {
    logger.error('Error in paid reschedule worker:', error);
    throw error;
  }
};
