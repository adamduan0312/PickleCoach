import Stripe from 'stripe';
import { logger } from '../config/logger.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-11-20.acacia',
});

const logStripeApiError = (operation, error, extra = {}) => {
  logger.error({
    component: 'stripe',
    event: 'stripe_api_error',
    operation,
    message: error?.message || String(error),
    code: error?.code,
    type: error?.type,
    decline_code: error?.decline_code,
    ...extra,
  });
};

/**
 * Create a PaymentIntent for a booking
 * @param {number} amount - Amount in cents
 * @param {string} currency - Currency code (default: 'usd')
 * @param {string} customerId - Stripe customer ID (optional)
 * @param {Object} metadata - Additional metadata
 * @param {Object} options - { captureMethod: 'manual' | 'automatic' } - use 'manual' for coach-must-confirm (authorize only; capture on accept)
 * @returns {Promise<Object>} PaymentIntent object
 */
export const createPaymentIntent = async (amount, currency = 'usd', customerId = null, metadata = {}, options = {}) => {
  try {
    const params = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
      capture_method: options.captureMethod || 'automatic',
    };

    if (customerId) {
      params.customer = customerId;
    }
    if (options.paymentMethodId) {
      params.payment_method = options.paymentMethodId;
    }
    if (options.confirm === true) {
      params.confirm = true;
    }

    const requestOptions = options.idempotencyKey
      ? { idempotencyKey: options.idempotencyKey }
      : {};
    const paymentIntent = await stripe.paymentIntents.create(params, requestOptions);
    logger.info('PaymentIntent created', { paymentIntentId: paymentIntent.id, amount });
    return paymentIntent;
  } catch (error) {
    logStripeApiError('createPaymentIntent', error);
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
 * Cancel a PaymentIntent (releases authorization when capture_method was 'manual')
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @returns {Promise<Object>} PaymentIntent object
 */
export const cancelPaymentIntent = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
    logger.info('PaymentIntent cancelled', { paymentIntentId });
    return paymentIntent;
  } catch (error) {
    logStripeApiError('cancelPaymentIntent', error, { paymentIntentId });
    throw error;
  }
};

/**
 * Create a refund (amount in integer cents; omit amountCents for full remaining balance).
 */
const STRIPE_REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

export const createRefund = async (
  chargeId,
  {
    amountCents = null,
    reason = 'requested_by_customer',
    idempotencyKey = null,
  } = {}
) => {
  try {
    const stripeReason = STRIPE_REFUND_REASONS.has(reason) ? reason : 'requested_by_customer';
    const params = {
      charge: chargeId,
      reason: stripeReason,
    };

    if (amountCents != null) {
      params.amount = Math.round(amountCents);
    }

    const requestOptions = idempotencyKey ? { idempotencyKey } : {};
    const refund = await stripe.refunds.create(params, requestOptions);
    logger.info({
      component: 'stripe',
      event: 'refund_created',
      refundId: refund.id,
      chargeId,
      amountCents: amountCents ?? 'full_remaining',
      idempotencyKey: idempotencyKey || null,
    });
    return refund;
  } catch (error) {
    logStripeApiError('createRefund', error, { chargeId });
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
    logStripeApiError('transferToConnectedAccount', error, { connectedAccountId });
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
    logStripeApiError('createConnectAccount', error);
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
    logStripeApiError('verifyWebhookSignature', error);
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

/**
 * Create a Stripe Customer
 */
export const createCustomer = async ({ email, name, metadata = {} } = {}) => {
  try {
    return await stripe.customers.create({
      email,
      name,
      metadata,
    });
  } catch (error) {
    logStripeApiError('createCustomer', error);
    throw error;
  }
};

/**
 * Attach an existing PaymentMethod to a customer
 */
export const attachPaymentMethodToCustomer = async (paymentMethodId, customerId) => {
  try {
    return await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  } catch (error) {
    logStripeApiError('attachPaymentMethodToCustomer', error, { paymentMethodId, customerId });
    throw error;
  }
};

/**
 * List card payment methods for a customer
 */
export const listCustomerPaymentMethods = async (customerId) => {
  try {
    return await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
  } catch (error) {
    logStripeApiError('listCustomerPaymentMethods', error, { customerId });
    throw error;
  }
};

/**
 * Set default payment method for invoice/subscription flows
 */
export const setCustomerDefaultPaymentMethod = async (customerId, paymentMethodId) => {
  try {
    return await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  } catch (error) {
    logStripeApiError('setCustomerDefaultPaymentMethod', error, { customerId, paymentMethodId });
    throw error;
  }
};

export const getCustomer = async (customerId) => {
  try {
    return await stripe.customers.retrieve(customerId);
  } catch (error) {
    logStripeApiError('getCustomer', error, { customerId });
    throw error;
  }
};

/**
 * Detach PaymentMethod from customer
 */
export const detachPaymentMethod = async (paymentMethodId) => {
  try {
    return await stripe.paymentMethods.detach(paymentMethodId);
  } catch (error) {
    logStripeApiError('detachPaymentMethod', error, { paymentMethodId });
    throw error;
  }
};

/**
 * Retrieve Charge (source of truth for amount captured vs refunded)
 */
export const retrieveCharge = async (chargeId) => {
  try {
    return await stripe.charges.retrieve(chargeId, { expand: ['refunds'] });
  } catch (error) {
    logStripeApiError('retrieveCharge', error, { chargeId });
    throw error;
  }
};

export default stripe;

