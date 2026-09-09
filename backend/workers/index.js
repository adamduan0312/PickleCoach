import cron from 'node-cron';
import { logger } from '../config/logger.js';
import * as reminderWorker from './reminderWorker.js';
import * as autoConfirmWorker from './autoConfirmWorker.js';
import * as payoutWorker from './payoutWorker.js';
import * as reliabilityWorker from './reliabilityWorker.js';
import * as retryFailedPaymentsWorker from './retryFailedPaymentsWorker.js';
import * as stripeReconciliationWorker from './stripeReconciliationWorker.js';
import * as pendingBookingExpiryWorker from './pendingBookingExpiryWorker.js';
import * as paymentActionWorker from './paymentActionWorker.js';

let workersRunning = false;
/** @type {import('node-cron').ScheduledTask[]} */
const scheduledTasks = [];

function workersEnabledByEnv() {
  const raw = process.env.WORKERS_ENABLED;
  if (raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  // Default: on for API servers except automated test harness.
  return process.env.NODE_ENV !== 'test';
}

function schedule(expression, label, fn) {
  const task = cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (error) {
      logger.error(`Error in ${label}:`, error);
    }
  });
  scheduledTasks.push(task);
  return task;
}

/**
 * Start all background workers (in-process cron).
 * Set WORKERS_ENABLED=false on API replicas if a dedicated worker process is used.
 * Do not run multiple API+worker processes against the same DB without understanding
 * that cron jobs will overlap (workers themselves are largely idempotent).
 */
export const startWorkers = () => {
  if (workersRunning) {
    logger.warn('Workers already running');
    return;
  }
  if (!workersEnabledByEnv()) {
    logger.info('Background workers disabled (WORKERS_ENABLED=false or NODE_ENV=test)');
    return;
  }

  logger.info('Starting background workers...');

  schedule('* * * * *', 'reminder worker', () => reminderWorker.sendReminderNotifications());
  schedule('*/5 * * * *', 'auto-confirm worker', () => autoConfirmWorker.autoConfirmLessons());
  schedule('*/10 * * * *', 'payout worker', () => payoutWorker.processPayouts());
  schedule('*/10 * * * *', 'retry failed payments worker', () => retryFailedPaymentsWorker.retryFailedPayments());
  schedule('*/15 * * * *', 'coach acceptance timeout worker', () => pendingBookingExpiryWorker.expireStalePendingBookings());
  schedule('0 2 * * *', 'reliability worker', () => reliabilityWorker.recalculateReliability());
  schedule('*/2 * * * *', 'refund payment action worker', () => paymentActionWorker.runRefundPaymentActions());
  schedule('0 * * * *', 'Stripe reconciliation worker', () => stripeReconciliationWorker.reconcileStripePayments());

  workersRunning = true;
  logger.info('✅ Background workers started successfully');
  logger.info('   - Reminder notifications: every minute');
  logger.info('   - Auto-confirm lessons: every 5 minutes');
  logger.info('   - Process payouts: every 10 minutes');
  logger.info('   - Retry failed payments: every 10 minutes');
  logger.info('   - Coach acceptance timeout: every 15 minutes');
  logger.info('   - Deferred dispute refunds (`payment_actions`): every 2 minutes');
  logger.info('   - Stripe reconciliation + stale refund-action probe: hourly');
  logger.info('   - Recalculate reliability: daily at 2 AM');
};

/**
 * Stop scheduled cron tasks (graceful shutdown).
 */
export const stopWorkers = () => {
  while (scheduledTasks.length) {
    const task = scheduledTasks.pop();
    try {
      task.stop();
    } catch (err) {
      logger.warn({ component: 'workers', event: 'stop_task_failed', message: err?.message });
    }
  }
  workersRunning = false;
  logger.info('Workers stopped');
};
