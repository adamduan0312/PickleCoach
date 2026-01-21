import { RescheduleHistory, Payment, Booking } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { createAuditLog } from '../utils/audit.js';
import * as stripeService from '../services/stripeService.js';

/**
 * Process paid reschedule payments
 * Checks for paid reschedule payments that need to be processed
 * Runs every 5-10 minutes
 */
export const processPaidReschedulePayments = async () => {
  try {
    // Find reschedule history records that:
    // 1. Are paid reschedules
    // 2. Have a transaction_id (payment record)
    // 3. Payment status is pending or captured
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
      try {
        const payment = reschedule.transaction;

        // If payment is pending, check Stripe PaymentIntent status
        if (payment.payment_status === 'pending' && payment.payment_intent_id) {
          try {
            // Retrieve PaymentIntent from Stripe to check status
            const paymentIntent = await stripeService.getPaymentIntent(payment.payment_intent_id);

            if (paymentIntent.status === 'succeeded') {
              // Payment succeeded, update payment record
              await payment.update({
                payment_status: 'captured',
                charge_id: paymentIntent.latest_charge || null,
                escrow_status: 'held',
              });

              await createAuditLog({
                user_id: payment.student_id,
                action: 'paid_reschedule_payment_captured',
                table_name: 'payments',
                record_id: payment.id,
                after_state: { payment_status: 'captured', charge_id: paymentIntent.latest_charge },
              });

              // Check if reschedule hasn't been applied yet (backup in case webhook didn't process it)
              // SAFEGUARD: Check approval_status to prevent double-application
              if (reschedule.approval_status === 'pending' && reschedule.booking) {
                const booking = reschedule.booking;
                
                // Apply the reschedule
                // IMPORTANT: Only update scheduled_at and extra_paid_reschedules
                // DO NOT modify booking.status (e.g., confirmed/completed) to prevent state regressions
                await booking.update({
                  scheduled_at: reschedule.new_scheduled_at,
                  extra_paid_reschedules: (booking.extra_paid_reschedules || 0) + 1,
                  // Explicitly preserve booking.status - reschedules do NOT change booking status
                });

                // Update reschedule history to approved
                await reschedule.update({
                  approval_status: 'approved',
                  approved_at: new Date(),
                });

                logger.info(`Paid reschedule ${reschedule.id} applied for booking ${booking.id} (via worker backup)`);
              }

              logger.info(`Paid reschedule payment ${payment.id} captured for reschedule ${reschedule.id}`);
            } else if (paymentIntent.status === 'requires_payment_method' || 
                       paymentIntent.status === 'canceled') {
              // Payment failed, mark as failed and reject reschedule
              await payment.update({
                payment_status: 'failed',
              });

              // Reject the reschedule if payment failed
              if (reschedule.approval_status === 'pending') {
                await reschedule.update({
                  approval_status: 'rejected',
                });
              }

              logger.warn(`Paid reschedule payment ${payment.id} failed for reschedule ${reschedule.id} - reschedule rejected`);
            }
          } catch (error) {
            logger.error(`Error checking PaymentIntent ${payment.payment_intent_id}:`, error);
            // Continue with next record
            continue;
          }
        }

        // If payment is captured, apply the reschedule if it hasn't been applied yet
        if (payment.payment_status === 'captured') {
          // Ensure reschedule is properly linked
          if (reschedule.transaction_id !== payment.id) {
            await reschedule.update({ transaction_id: payment.id });
            logger.info(`Linked payment ${payment.id} to reschedule ${reschedule.id}`);
          }

          // Apply reschedule if it's still pending (backup in case webhook didn't process it)
          // SAFEGUARD: Check approval_status to prevent double-application
          if (reschedule.approval_status === 'pending' && reschedule.booking) {
            const booking = reschedule.booking;
            const { User } = await import('../models/index.js');
            const { updateUserReliability } = await import('../services/reliabilityService.js');
            const { logAudit } = await import('../utils/audit.js');

            // Apply the reschedule
            // IMPORTANT: Only update scheduled_at and extra_paid_reschedules
            // DO NOT modify booking.status (e.g., confirmed/completed) to prevent state regressions
            await booking.update({
              scheduled_at: reschedule.new_scheduled_at,
              extra_paid_reschedules: (booking.extra_paid_reschedules || 0) + 1,
              // Explicitly preserve booking.status - reschedules do NOT change booking status
            });

            // Update reschedule history to approved
            await reschedule.update({
              approval_status: 'approved',
              approved_at: new Date(),
            });

            // Update reliability if needed
            // SAFEGUARD: Only update reliability once (since we check approval_status above, this ensures single execution)
            if (reschedule.affects_reliability && reschedule.requested_by !== 'admin') {
              const userIdToUpdate = reschedule.requested_by === 'coach' 
                ? booking.coach_id 
                : booking.primary_student_id;
              
              if (userIdToUpdate) {
                const userToUpdate = await User.findByPk(userIdToUpdate);
                if (userToUpdate && userToUpdate.role !== 'admin') {
                  await updateUserReliability(userIdToUpdate).catch(err => {
                    logger.error('Failed to update reliability after paid reschedule:', err);
                  });
                }
              }
            }

            await logAudit(
              payment.student_id,
              'paid_reschedule_applied',
              'bookings',
              booking.id,
              { scheduled_at: reschedule.old_scheduled_at },
              { scheduled_at: reschedule.new_scheduled_at },
              null
            );

            logger.info(`Paid reschedule ${reschedule.id} applied for booking ${booking.id} (via worker backup)`);
          }
        }

        // SAFEGUARD: Handle expired PaymentIntents (Stripe PaymentIntents expire after 24 hours)
        // If payment is still pending and PaymentIntent is older than 24 hours, reject the reschedule
        if (payment.payment_status === 'pending' && payment.payment_intent_id) {
          const paymentAge = Date.now() - new Date(payment.created_at).getTime();
          const twentyFourHours = 24 * 60 * 60 * 1000;

          if (paymentAge > twentyFourHours) {
            try {
              const paymentIntent = await stripeService.getPaymentIntent(payment.payment_intent_id);
              
              // If PaymentIntent is canceled or requires payment method (expired), reject reschedule
              if (paymentIntent.status === 'canceled' || 
                  paymentIntent.status === 'requires_payment_method') {
                await payment.update({
                  payment_status: 'failed',
                });

                if (reschedule.approval_status === 'pending') {
                  await reschedule.update({
                    approval_status: 'rejected',
                  });

                  logger.info(`Paid reschedule ${reschedule.id} rejected due to expired PaymentIntent (older than 24h)`);
                }
              }
            } catch (error) {
              logger.error(`Error checking expired PaymentIntent ${payment.payment_intent_id}:`, error);
            }
          }
        }
      } catch (error) {
        logger.error(`Error processing paid reschedule ${reschedule.id}:`, error);
        // Continue with next record
      }
    }

    logger.info(`Paid reschedule worker processed ${rescheduleRecords.length} records`);
  } catch (error) {
    logger.error('Error in paid reschedule worker:', error);
    throw error;
  }
};

