import * as paymentService from '../services/paymentService.js';
import { logger } from '../config/logger.js';

/**
 * Executes deferred refunds (`payment_actions`: disputes, cancel, coach no-show auto, admin) via Stripe workers.
 * Stale pending rows are logged from the hourly `stripeReconciliationWorker` run.
 */
export const runRefundPaymentActions = async () => {
  try {
    await paymentService.processPendingRefundPaymentActions({ batchLimit: 14 });
  } catch (err) {
    logger.error({
      component: 'payments',
      event: 'payment_action_worker_cycle_error',
      message: err?.message || String(err),
    });
    throw err;
  }
};
