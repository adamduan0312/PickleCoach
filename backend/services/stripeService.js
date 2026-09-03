import Stripe from 'stripe';
import { logger } from '../config/logger.js';

/**
 * Integration tests only (`RUN_PAYMENT_INTEGRATION=1`): when set, matching methods delegate here instead of Stripe.
 * Production must never call `setStripeTestDouble`.
 */
let stripeTestDouble = null;

/** @param {null | Record<string, Function>} impl */
export const setStripeTestDouble = (impl) => {
  stripeTestDouble = impl && typeof impl === 'object' ? impl : null;
};

export const clearStripeTestDouble = () => {
  stripeTestDouble = null;
};

/** Dev-only seeded PaymentIntents (`pi_seed_dev_*`) for Postman without live Stripe. Never used in production. */
const DEV_SEED_PI_PREFIX = 'pi_seed_dev_';
/** @type {Map<string, { amountCapturableCents: number, status: string, chargeId: string | null }>} */
const devSeedPaymentIntentRegistry = new Map();

export function isDevSeedPaymentIntentId(paymentIntentId) {
  if (process.env.NODE_ENV === 'production') return false;
  return String(paymentIntentId || '').startsWith(DEV_SEED_PI_PREFIX);
}

/** Optional eager registration (seed scripts); API server hydrates from DB on first use. */
export function registerDevSeedPaymentIntent(paymentIntentId, { amountCapturableCents }) {
  if (process.env.NODE_ENV === 'production') return;
  const id = String(paymentIntentId || '');
  if (!id.startsWith(DEV_SEED_PI_PREFIX)) {
    throw new Error(`Dev seed PaymentIntent ids must start with ${DEV_SEED_PI_PREFIX}`);
  }
  devSeedPaymentIntentRegistry.set(id, {
    amountCapturableCents: Math.round(Number(amountCapturableCents) || 0),
    status: 'requires_capture',
    chargeId: null,
  });
}

/**
 * Load dev-seed PI state from the payments row so stubs work after server restart
 * (seed scripts run in a separate process from the API server).
 */
async function ensureDevSeedIntentLoaded(paymentIntentId) {
  const id = String(paymentIntentId || '');
  if (!isDevSeedPaymentIntentId(id)) return false;
  if (devSeedPaymentIntentRegistry.has(id)) return true;

  const { Payment } = await import('../models/index.js');
  const payment = await Payment.findOne({ where: { payment_intent_id: id } });

  if (!payment) {
    devSeedPaymentIntentRegistry.set(id, {
      amountCapturableCents: 100,
      status: 'requires_capture',
      chargeId: null,
    });
    logger.warn({
      component: 'stripe',
      event: 'dev_seed_pi_hydrated_default',
      paymentIntentId: id,
    });
    return true;
  }

  const total = Number(payment.total_charge_to_student) || 0;
  const amountCapturableCents = Math.round(total * 100);
  let status = 'requires_capture';
  let chargeId = payment.charge_id || null;

  if (['captured', 'pending_capture'].includes(String(payment.payment_status || ''))) {
    status = 'succeeded';
    chargeId = chargeId || `ch_seed_dev_${id.slice(-12)}`;
  } else if (['pending_void', 'failed'].includes(String(payment.payment_status || ''))) {
    status = 'canceled';
    chargeId = null;
  }

  devSeedPaymentIntentRegistry.set(id, {
    amountCapturableCents: status === 'requires_capture' ? amountCapturableCents : 0,
    status,
    chargeId,
  });
  logger.info({
    component: 'stripe',
    event: 'dev_seed_pi_hydrated_from_db',
    paymentIntentId: id,
    paymentStatus: payment.payment_status,
  });
  return true;
}

function buildDevSeedPaymentIntentResponse(paymentIntentId) {
  const row = devSeedPaymentIntentRegistry.get(String(paymentIntentId));
  if (!row) {
    throw new Error(`Dev seed PaymentIntent ${paymentIntentId} is not loaded.`);
  }
  return {
    id: paymentIntentId,
    status: row.status,
    amount_capturable: row.status === 'requires_capture' ? row.amountCapturableCents : 0,
    latest_charge: row.chargeId,
    charges: row.chargeId ? { data: [{ id: row.chargeId }] } : { data: [] },
    client_secret: `${paymentIntentId}_secret_dev`,
  };
}

async function devSeedCapturePaymentIntent(paymentIntentId) {
  await ensureDevSeedIntentLoaded(paymentIntentId);
  const id = String(paymentIntentId);
  const row = devSeedPaymentIntentRegistry.get(id);
  if (row.status === 'succeeded') {
    return buildDevSeedPaymentIntentResponse(paymentIntentId);
  }
  if (row.status !== 'requires_capture') {
    throw new Error(`Dev seed PaymentIntent ${paymentIntentId} is not capturable (status: ${row.status})`);
  }
  row.chargeId = `ch_seed_dev_${id.slice(-12)}`;
  row.status = 'succeeded';
  row.amountCapturableCents = 0;
  logger.info('Dev seed PaymentIntent captured (stub)', { paymentIntentId });
  return buildDevSeedPaymentIntentResponse(paymentIntentId);
}

async function devSeedCancelPaymentIntent(paymentIntentId) {
  await ensureDevSeedIntentLoaded(paymentIntentId);
  const row = devSeedPaymentIntentRegistry.get(String(paymentIntentId));
  if (!row) {
    throw new Error(`Dev seed PaymentIntent ${paymentIntentId} is not loaded.`);
  }
  if (row.status === 'canceled') {
    return buildDevSeedPaymentIntentResponse(paymentIntentId);
  }
  row.status = 'canceled';
  row.amountCapturableCents = 0;
  logger.info('Dev seed PaymentIntent cancelled (stub)', { paymentIntentId });
  return buildDevSeedPaymentIntentResponse(paymentIntentId);
}

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
    if (stripeTestDouble?.createPaymentIntent) {
      return stripeTestDouble.createPaymentIntent(amount, currency, customerId, metadata, options);
    }
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
  if (isDevSeedPaymentIntentId(paymentIntentId)) {
    return devSeedCapturePaymentIntent(paymentIntentId);
  }
  if (stripeTestDouble?.capturePaymentIntent) {
    return stripeTestDouble.capturePaymentIntent(paymentIntentId);
  }
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
  if (isDevSeedPaymentIntentId(paymentIntentId)) {
    return devSeedCancelPaymentIntent(paymentIntentId);
  }
  if (stripeTestDouble?.cancelPaymentIntent) {
    return stripeTestDouble.cancelPaymentIntent(paymentIntentId);
  }
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
    metadata = null,
  } = {}
) => {
  if (stripeTestDouble?.createRefund) {
    return stripeTestDouble.createRefund(chargeId, {
      amountCents,
      reason,
      idempotencyKey,
      metadata,
    });
  }
  try {
    const stripeReason = STRIPE_REFUND_REASONS.has(reason) ? reason : 'requested_by_customer';
    const params = {
      charge: chargeId,
      reason: stripeReason,
    };

    if (amountCents != null) {
      params.amount = Math.round(amountCents);
    }

    if (metadata && typeof metadata === 'object') {
      const flat = {};
      for (const [k, v] of Object.entries(metadata)) {
        if (v == null) continue;
        flat[String(k).slice(0, 40)] = String(v).slice(0, 500);
      }
      if (Object.keys(flat).length) params.metadata = flat;
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

export const retrieveRefund = async (refundId) => {
  if (stripeTestDouble?.retrieveRefund) {
    return stripeTestDouble.retrieveRefund(refundId);
  }
  try {
    return await stripe.refunds.retrieve(refundId);
  } catch (error) {
    logStripeApiError('retrieveRefund', error, { refundId });
    throw error;
  }
};

/**
 * Refunds for a charge (paginated; most charges have few refunds).
 */
export const listRefundsForCharge = async (chargeId, { limitPerPage = 100, maxPages = 5 } = {}) => {
  if (stripeTestDouble?.listRefundsForCharge) {
    return stripeTestDouble.listRefundsForCharge(chargeId, { limitPerPage, maxPages });
  }
  const all = [];
  let startingAfter = null;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await stripe.refunds.list({
      charge: chargeId,
      limit: limitPerPage,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    all.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return all;
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
  if (stripeTestDouble?.transferToConnectedAccount) {
    return stripeTestDouble.transferToConnectedAccount(connectedAccountId, amount, currency, metadata);
  }
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
 * Reverse a Connect transfer (e.g. duplicate payout race). Amount defaults to full reverse.
 * @param {string} transferId
 * @param {{ amountCents?: number, metadata?: object }} [options]
 */
export const reverseTransfer = async (transferId, { amountCents, metadata = {} } = {}) => {
  if (stripeTestDouble?.reverseTransfer) {
    return stripeTestDouble.reverseTransfer(transferId, { amountCents, metadata });
  }
  try {
    const params = { metadata };
    if (amountCents != null) params.amount = amountCents;
    const reversal = await stripe.transfers.createReversal(transferId, params);
    logger.info('Transfer reversed', { transferId, reversalId: reversal.id, amountCents });
    return reversal;
  } catch (error) {
    logStripeApiError('reverseTransfer', error, { transferId });
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
  if (stripeTestDouble?.verifyWebhookSignature) {
    return stripeTestDouble.verifyWebhookSignature(payload, signature);
  }
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
  if (stripeTestDouble?.getPaymentIntent) {
    return stripeTestDouble.getPaymentIntent(paymentIntentId);
  }
  if (isDevSeedPaymentIntentId(paymentIntentId)) {
    await ensureDevSeedIntentLoaded(paymentIntentId);
    return buildDevSeedPaymentIntentResponse(paymentIntentId);
  }
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
    if (stripeTestDouble?.createCustomer) {
      return stripeTestDouble.createCustomer({ email, name, metadata });
    }
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
  if (stripeTestDouble?.retrieveCharge) {
    return stripeTestDouble.retrieveCharge(chargeId);
  }
  try {
    return await stripe.charges.retrieve(chargeId, { expand: ['refunds'] });
  } catch (error) {
    logStripeApiError('retrieveCharge', error, { chargeId });
    throw error;
  }
};

export default stripe;

