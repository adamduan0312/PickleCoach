import { Op } from 'sequelize';
import { Payment } from '../models/index.js';
import { logger } from '../config/logger.js';
import {
  assertStripePaymentConsistency,
  logStalePendingPaymentActions,
  reconcileRefundPaymentActionsWithStripe,
} from '../services/paymentService.js';

const BATCH = 40;

/**
 * Periodically compare local payments to Stripe Charge / PaymentIntent; optional auto-heal.
 */
export const reconcileStripePayments = async () => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const payments = await Payment.findAll({
    where: {
      updatedAt: { [Op.gte]: since },
      [Op.or]: [
        { charge_id: { [Op.ne]: null } },
        { payment_intent_id: { [Op.ne]: null } },
      ],
    },
    order: [['updatedAt', 'DESC']],
    limit: BATCH,
  });

  let mismatches = 0;
  for (const p of payments) {
    try {
      const r = await assertStripePaymentConsistency(p, {
        autoHeal: true,
        context: 'cron_reconcile',
      });
      if (r.mismatch) mismatches += 1;
    } catch (err) {
      logger.error({
        component: 'stripe',
        event: 'reconcile_row_error',
        paymentId: p.id,
        message: err.message,
      });
    }
  }

  if (payments.length) {
    logger.info({
      component: 'stripe',
      event: 'reconcile_batch_complete',
      scanned: payments.length,
      mismatchesRemaining: mismatches,
    });
  }

  try {
    const paRec = await reconcileRefundPaymentActionsWithStripe({ batchLimit: 45, autoHeal: true });
    if (paRec.healedMeta + paRec.healedReplay > 0) {
      logger.info({
        component: 'payments',
        event: 'cron_payment_actions_repaired',
        ...paRec,
      });
    }
  } catch (e) {
    logger.error({
      component: 'payments',
      event: 'payment_action_refund_reconcile_failed',
      message: e?.message || String(e),
    });
  }

  try {
    const staleRefundActions = await logStalePendingPaymentActions({ staleMs: 60 * 60 * 1000 });
    if (Number(staleRefundActions) > 0) {
      logger.info({
        component: 'stripe',
        event: 'reconcile_includes_stale_refund_payment_actions',
        stale_pending_count: staleRefundActions,
      });
    }
  } catch (e) {
    logger.error({
      component: 'stripe',
      event: 'stale_payment_actions_probe_failed',
      message: e?.message || String(e),
    });
  }
};
