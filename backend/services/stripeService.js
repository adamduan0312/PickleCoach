import Stripe from 'stripe';
import { logger } from '../config/logger.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-11-20.acacia',
});

/**
 * Create a PaymentIntent for a booking
 * @param {number} amount - Amount in cents
 * @param {string} currency - Currency code (default: 'usd')
 * @param {string} customerId - Stripe customer ID (optional)
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} PaymentIntent object
 */
export const createPaymentIntent = async (amount, currency = 'usd', customerId = null, metadata = {}) => {
  try {
    const params = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    };

    if (customerId) {
      params.customer = customerId;
    }

    const paymentIntent = await stripe.paymentIntents.create(params);
    logger.info('PaymentIntent created', { paymentIntentId: paymentIntent.id, amount });
    return paymentIntent;
  } catch (error) {
    logger.error('Error creating PaymentIntent:', error);
    throw error;
  }
};

/**
 * Capture a PaymentIntent
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @returns {Promise<Object>} PaymentIntent object
 */
export const capturePaymentIntent = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
    logger.info('PaymentIntent captured', { paymentIntentId });
    return paymentIntent;
  } catch (error) {
    logger.error('Error capturing PaymentIntent:', error);
    throw error;
  }
};

/**
 * Create a refund
 * @param {string} chargeId - Stripe charge ID
 * @param {number} amount - Amount to refund in dollars (optional, full refund if not provided)
 * @param {string} reason - Refund reason
 * @returns {Promise<Object>} Refund object
 */
export const createRefund = async (chargeId, amount = null, reason = 'requested_by_customer') => {
  try {
    const params = {
      charge: chargeId,
      reason,
    };

    if (amount) {
      params.amount = Math.round(amount * 100); // Convert to cents
    }

    const refund = await stripe.refunds.create(params);
    logger.info('Refund created', { refundId: refund.id, chargeId, amount });
    return refund;
  } catch (error) {
    logger.error('Error creating refund:', error);
    throw error;
  }
};

/**
 * Transfer funds to a connected account (coach payout)
 * @param {string} connectedAccountId - Stripe Connect account ID
 * @param {number} amount - Amount in dollars
 * @param {string} currency - Currency code
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Transfer object
 */
export const transferToConnectedAccount = async (connectedAccountId, amount, currency = 'usd', metadata = {}) => {
  try {
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      destination: connectedAccountId,
      metadata,
    });
    logger.info('Transfer created', { transferId: transfer.id, connectedAccountId, amount });
    return transfer;
  } catch (error) {
    logger.error('Error creating transfer:', error);
    throw error;
  }
};

/**
 * Create a Stripe Connect account for a coach
 * @param {string} email - Coach email
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Account object
 */
export const createConnectAccount = async (email, metadata = {}) => {
  try {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US', // Default, should be configurable
      email,
      metadata,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    logger.info('Connect account created', { accountId: account.id, email });
    return account;
  } catch (error) {
    logger.error('Error creating Connect account:', error);
    throw error;
  }
};

/**
 * Create account link for onboarding
 * @param {string} accountId - Stripe Connect account ID
 * @param {string} returnUrl - URL to return to after onboarding
 * @param {string} refreshUrl - URL to refresh the link
 * @returns {Promise<Object>} AccountLink object
 */
export const createAccountLink = async (accountId, returnUrl, refreshUrl) => {
  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding',
    });
    logger.info('Account link created', { accountId });
    return accountLink;
  } catch (error) {
    logger.error('Error creating account link:', error);
    throw error;
  }
};

/**
 * Verify webhook signature
 * @param {string} payload - Raw request body
 * @param {string} signature - Stripe signature header
 * @returns {Object} Event object
 */
export const verifyWebhookSignature = (payload, signature) => {
  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );
    return event;
  } catch (error) {
    logger.error('Webhook signature verification failed:', error);
    throw error;
  }
};

/**
 * Get PaymentIntent by ID
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @returns {Promise<Object>} PaymentIntent object
 */
export const getPaymentIntent = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent;
  } catch (error) {
    logger.error('Error retrieving PaymentIntent:', error);
    throw error;
  }
};

export default stripe;

