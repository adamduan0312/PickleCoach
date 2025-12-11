import express from 'express';
import { WebhookLog, Payment, Booking } from '../models/index.js';
import * as stripeService from '../services/stripeService.js';
import * as paymentService from '../services/paymentService.js';
import { logger } from '../config/logger.js';

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events
 */
export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature
    event = stripeService.verifyWebhookSignature(req.body, sig);
  } catch (error) {
    logger.error('Webhook signature verification failed:', error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  // Log webhook event
  const webhookLog = await WebhookLog.create({
    provider: 'stripe',
    event_type: event.type,
    event_id: event.id,
    payload: event.data.object,
    received_at: new Date(),
    success: false,
  });

  try {
    // Handle different event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;

      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object);
        break;

      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    await webhookLog.update({
      success: true,
      processed_at: new Date(),
    });

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    await webhookLog.update({
      success: false,
      response: error.message,
      processed_at: new Date(),
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

/**
 * Handle payment_intent.succeeded event
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  const payment = await Payment.findOne({
    where: { payment_intent_id: paymentIntent.id },
    include: [{ model: Booking, as: 'booking' }],
  });

  if (!payment) {
    logger.warn(`Payment not found for PaymentIntent: ${paymentIntent.id}`);
    return;
  }

  // Get charge ID from payment intent
  const charges = paymentIntent.charges?.data || [];
  const chargeId = charges.length > 0 ? charges[0].id : null;

  // Handle payment capture
  await paymentService.handlePaymentCapture(paymentIntent.id, chargeId);

  logger.info(`Payment captured for PaymentIntent: ${paymentIntent.id}`);
};

/**
 * Handle payment_intent.payment_failed event
 */
const handlePaymentIntentFailed = async (paymentIntent) => {
  const payment = await Payment.findOne({
    where: { payment_intent_id: paymentIntent.id },
  });

  if (!payment) {
    logger.warn(`Payment not found for PaymentIntent: ${paymentIntent.id}`);
    return;
  }

  await payment.update({
    payment_status: 'failed',
  });

  logger.info(`Payment failed for PaymentIntent: ${paymentIntent.id}`);
};

/**
 * Handle charge.refunded event
 */
const handleChargeRefunded = async (charge) => {
  const payment = await Payment.findOne({
    where: { charge_id: charge.id },
  });

  if (!payment) {
    logger.warn(`Payment not found for charge: ${charge.id}`);
    return;
  }

  const refundAmount = charge.amount_refunded / 100; // Convert from cents

  await payment.update({
    payment_status: 'refunded',
    escrow_status: 'refunded',
    refunded_amount: refundAmount,
  });

  logger.info(`Refund processed for charge: ${charge.id}`);
};

/**
 * Handle charge.dispute.created event
 */
const handleDisputeCreated = async (charge) => {
  const payment = await Payment.findOne({
    where: { charge_id: charge.id },
    include: [{ model: Booking, as: 'booking' }],
  });

  if (!payment) {
    logger.warn(`Payment not found for charge: ${charge.id}`);
    return;
  }

  // Update payment and booking status
  await payment.update({
    escrow_status: 'disputed',
  });

  if (payment.booking) {
    await payment.booking.update({
      status: 'disputed',
    });
  }

  // TODO: Create dispute record in database
  logger.info(`Dispute created for charge: ${charge.id}`);
};

// Middleware to get raw body for Stripe webhook verification
export const stripeWebhookMiddleware = express.raw({ type: 'application/json' });

