import { UniqueConstraintError } from 'sequelize';
import { WebhookLog, Payment, CoachProfile } from '../models/index.js';
import * as stripeService from '../services/stripeService.js';
import * as paymentService from '../services/paymentService.js';
import { syncStripeDisputeToDatabase } from '../services/stripeDisputeSyncService.js';
import { syncCoachStripeReadyFromAccount } from '../services/coachMarketplaceEligibility.js';
import { logger } from '../config/logger.js';
import * as paymentAuthorizationService from '../services/paymentAuthorizationService.js';
import { shouldStripeWebhookSkipAsDuplicate } from '../services/paymentStripeContract.js';
import { escrowAfterUncapturedVoid } from '../utils/paymentEscrowStatus.js';

async function assertConsistencyAfterWebhook(paymentId, context) {
  if (!paymentId) return;
  try {
    await paymentService.assertStripePaymentConsistency(paymentId, {
      context,
      autoHeal: false,
    });
  } catch (err) {
    logger.error({
      component: 'stripe',
      event: 'consistency_after_webhook_failed',
      paymentId,
      context,
      message: err.message,
    });
  }
}

/**
 * POST /api/webhooks/stripe
 *
 * MVP reliability:
 * - Verify Stripe signature (reject invalid with 400; do not retry signature failures from Dashboard)
 * - Idempotent by Stripe event.id (safe when Stripe retries the same event)
 * - On processing failure: persist error + return 500 so Stripe retries with backoff
 * - Missing Payment/charge rows: throw so Stripe retries after data exists (or use Dashboard Resend)
 */
export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeService.verifyWebhookSignature(req.body, sig);
  } catch (error) {
    logger.error({
      component: 'stripe',
      event: 'webhook_signature_failed',
      message: error.message,
    });
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (!event.id) {
    logger.error({ component: 'stripe', event: 'webhook_missing_event_id' });
    return res.status(400).json({ error: 'Missing event id' });
  }

  const processed = await WebhookLog.findOne({
    where: { provider: 'stripe', event_id: event.id },
  });

  if (shouldStripeWebhookSkipAsDuplicate(processed)) {
    logger.info({
      component: 'stripe',
      event: 'webhook_idempotent_skip',
      eventId: event.id,
    });
    return res.json({ received: true, duplicate: true });
  }

  let webhookLog = processed;

  if (!webhookLog) {
    try {
      webhookLog = await WebhookLog.create({
        provider: 'stripe',
        event_type: event.type,
        event_id: event.id,
        payload: event.data.object,
        received_at: new Date(),
        success: false,
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        webhookLog = await WebhookLog.findOne({
          where: { provider: 'stripe', event_id: event.id },
        });
        if (shouldStripeWebhookSkipAsDuplicate(webhookLog)) {
          return res.json({ received: true, duplicate: true });
        }
      }
      if (!webhookLog) {
        logger.error({
          component: 'stripe',
          event: 'webhook_log_create_failed',
          eventId: event.id,
          message: err.message,
        });
        return res.status(500).json({ error: 'Webhook log failed' });
      }
    }
  }

  if (!webhookLog) {
    logger.error({ component: 'stripe', event: 'webhook_log_missing', eventId: event.id });
    return res.status(500).json({ error: 'Webhook log failed' });
  }

  try {
    logger.info({
      component: 'stripe',
      event: 'webhook_processing',
      eventId: event.id,
      eventType: event.type,
    });

    switch (event.type) {
      case 'payment_intent.amount_capturable_updated':
        await handlePaymentIntentAmountCapturableUpdated(event.data.object);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;

      case 'payment_intent.canceled':
        await handlePaymentIntentCanceled(event.data.object);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;

      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
        await syncStripeDisputeToDatabase(event.data.object, { eventType: event.type });
        break;

      case 'transfer.created':
      case 'transfer.paid':
        await handleTransferFinalized(event.data.object);
        break;

      case 'transfer.reversed':
        await handleTransferReversed(event.data.object);
        break;

      case 'account.updated':
        await handleConnectAccountUpdated(event.data.object);
        break;

      default:
        logger.info({
          component: 'stripe',
          event: 'webhook_unhandled_type',
          eventType: event.type,
        });
    }

    await webhookLog.update({
      success: true,
      processed_at: new Date(),
      response: null,
    });

    return res.json({ received: true });
  } catch (error) {
    logger.error({
      component: 'stripe',
      event: 'webhook_processing_failed',
      eventId: event.id,
      eventType: event.type,
      message: error.message,
      stack: error.stack,
    });
    await webhookLog.update({
      success: false,
      response: (error.message || String(error)).slice(0, 5000),
      processed_at: new Date(),
    });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

/**
 * payment_intent.amount_capturable_updated — manual capture authorization succeeded
 */
const handlePaymentIntentAmountCapturableUpdated = async (paymentIntent) => {
  await paymentAuthorizationService.handlePaymentAuthorizationSucceeded(paymentIntent);

  const payment = await Payment.findOne({
    where: { payment_intent_id: paymentIntent.id },
  });
  await assertConsistencyAfterWebhook(payment?.id, 'payment_intent.amount_capturable_updated');

  logger.info({
    component: 'stripe',
    event: 'payment_intent_amount_capturable_updated_processed',
    paymentIntentId: paymentIntent.id,
  });
};

/**
 * payment_intent.succeeded — delegate to paymentService (throws if Payment row not ready → Stripe retries)
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  const charges = paymentIntent.charges?.data || [];
  const chargeId =
    charges.length > 0
      ? charges[0].id
      : typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;

  await paymentService.handlePaymentCapture(paymentIntent.id, chargeId);

  const payment = await Payment.findOne({
    where: { payment_intent_id: paymentIntent.id },
  });
  await assertConsistencyAfterWebhook(payment?.id, 'payment_intent.succeeded');

  logger.info({
    component: 'stripe',
    event: 'payment_intent_succeeded_processed',
    paymentIntentId: paymentIntent.id,
  });
};

/**
 * payment_intent.payment_failed
 */
const handlePaymentIntentFailed = async (paymentIntent) => {
  const payment = await Payment.findOne({
    where: { payment_intent_id: paymentIntent.id },
  });

  if (!payment) {
    throw new Error(
      `Payment not found for PaymentIntent ${paymentIntent.id}; retry when payment row exists`
    );
  }

  const terminalOrAdvancedStates = new Set(['captured', 'partially_refunded', 'refunded']);
  if (terminalOrAdvancedStates.has(payment.payment_status)) {
    logger.info({
      component: 'stripe',
      event: 'payment_intent_failed_ignored_stale',
      paymentIntentId: paymentIntent.id,
      paymentId: payment.id,
      currentPaymentStatus: payment.payment_status,
    });
    await assertConsistencyAfterWebhook(payment.id, 'payment_intent.payment_failed.stale');
    return;
  }

  await paymentAuthorizationService.handlePaymentAuthorizationFailed(paymentIntent);

  await assertConsistencyAfterWebhook(payment.id, 'payment_intent.payment_failed');

  logger.info({
    component: 'stripe',
    event: 'payment_intent_failed_processed',
    paymentIntentId: paymentIntent.id,
  });
};

/**
 * payment_intent.canceled — finalizes void after coach decline (API sets pending_void).
 */
const handlePaymentIntentCanceled = async (paymentIntent) => {
  const payment = await Payment.findOne({
    where: { payment_intent_id: paymentIntent.id },
  });

  if (!payment) {
    throw new Error(
      `Payment not found for PaymentIntent ${paymentIntent.id}; retry when payment row exists`
    );
  }

  const patch = {};
  if (['pending_void', 'pending', 'authorized'].includes(String(payment.payment_status || ''))) {
    patch.payment_status = 'failed';
  }
  // Uncaptured authorization: never leave escrow held after Stripe cancel.
  if (!payment.charge_id && !['released', 'refunded'].includes(String(payment.escrow_status || ''))) {
    patch.escrow_status = escrowAfterUncapturedVoid();
  }
  if (Object.keys(patch).length) {
    await payment.update(patch);
  }

  await assertConsistencyAfterWebhook(payment.id, 'payment_intent.canceled');

  logger.info({
    component: 'stripe',
    event: 'payment_intent_canceled_processed',
    paymentIntentId: paymentIntent.id,
  });
};

/**
 * charge.refunded
 */
const handleChargeRefunded = async (charge) => {
  const payment = await Payment.findOne({
    where: { charge_id: charge.id },
  });

  if (!payment) {
    throw new Error(`Payment not found for charge ${charge.id}; retry when charge_id is linked`);
  }

  const fullCharge = await stripeService.retrieveCharge(charge.id);
  const refunds = fullCharge.refunds?.data;
  const latestRefundId =
    Array.isArray(refunds) && refunds.length > 0 ? refunds[refunds.length - 1].id : null;

  await paymentService.applyRefundStateFromStripeCharge(payment, fullCharge, {
    stripeRefundId: latestRefundId,
  });

  await assertConsistencyAfterWebhook(payment.id, 'charge.refunded');

  logger.info({
    component: 'stripe',
    event: 'charge_refunded_processed',
    chargeId: charge.id,
  });
};

const handleTransferFinalized = async (transfer) => {
  const result = await paymentService.finalizeTransferFromStripe(transfer);
  const paymentId =
    result.payment?.id ??
    (transfer.metadata?.payment_id != null
      ? parseInt(String(transfer.metadata.payment_id), 10)
      : null);
  await assertConsistencyAfterWebhook(
    Number.isFinite(paymentId) ? paymentId : null,
    'transfer.finalized'
  );
};

const handleTransferReversed = async (transfer) => {
  const result = await paymentService.handleTransferReversedFromStripe(transfer);
  const paymentId =
    result.payment?.id ??
    (transfer.metadata?.payment_id != null
      ? parseInt(String(transfer.metadata.payment_id), 10)
      : null);
  await assertConsistencyAfterWebhook(
    Number.isFinite(paymentId) ? paymentId : null,
    'transfer.reversed'
  );
};

/** Keep local stripe_ready in sync when Connect onboarding / capability changes. */
const handleConnectAccountUpdated = async (account) => {
  if (!account?.id) return;
  const coachProfile = await CoachProfile.findOne({
    where: { stripe_account_id: account.id },
  });
  if (!coachProfile) {
    logger.info({
      component: 'stripe',
      event: 'account_updated_no_coach_profile',
      accountId: account.id,
    });
    return;
  }
  const ready = await syncCoachStripeReadyFromAccount(coachProfile, account);
  logger.info({
    component: 'stripe',
    event: 'account_updated_stripe_ready_synced',
    accountId: account.id,
    coachProfileId: coachProfile.id,
    stripe_ready: ready,
  });
};
