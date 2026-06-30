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

/**
 * Start all background workers
 */
export const startWorkers = () => {
  if (workersRunning) {
    logger.warn('Workers already running');
    return;
  }

  logger.info('Starting background workers...');

  // Reminder notifications: every minute
  cron.schedule('* * * * *', async () => {
    try {
      await reminderWorker.sendReminderNotifications();
    } catch (error) {
      logger.error('Error in reminder worker:', error);
    }
  });

  // Auto-confirm lessons: every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await autoConfirmWorker.autoConfirmLessons();
    } catch (error) {
      logger.error('Error in auto-confirm worker:', error);
    }
  });

  // Process payouts: every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      await payoutWorker.processPayouts();
    } catch (error) {
      logger.error('Error in payout worker:', error);
    }
  });

  // Retry failed payments: every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      await retryFailedPaymentsWorker.retryFailedPayments();
    } catch (error) {
      logger.error('Error in retry failed payments worker:', error);
    }
  });


  // Coach acceptance timeout: pending (authorized) bookings with no coach response
  cron.schedule('*/15 * * * *', async () => {
    try {
      await pendingBookingExpiryWorker.expireStalePendingBookings();
    } catch (error) {
      logger.error('Error in coach acceptance timeout worker:', error);
    }
  });

  // Recalculate reliability: daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      await reliabilityWorker.recalculateReliability();
    } catch (error) {
      logger.error('Error in reliability worker:', error);
    }
  });

  // Deferred dispute refunds (`payment_actions` → Stripe): every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await paymentActionWorker.runRefundPaymentActions();
    } catch (error) {
      logger.error('Error in refund payment action worker:', error);
    }
  });

  // Stripe charge/payment parity + stale deferred-refund probes: hourly
  cron.schedule('0 * * * *', async () => {
    try {
      await stripeReconciliationWorker.reconcileStripePayments();
    } catch (error) {
      logger.error('Error in Stripe reconciliation worker:', error);
    }
  });

  // V2 reliability uses rolling window + decay, so hard monthly resets are disabled.

  workersRunning = true;
  logger.info('✅ Background workers started successfully');
  logger.info('   - Reminder notifications: every minute');
  logger.info('   - Auto-confirm lessons: every 5 minutes');
  logger.info('   - Process payouts: every 10 minutes');
  logger.info('   - Retry failed payments: every 10 minutes');
  logger.info('   - Coach acceptance timeout: every 15 minutes (COACH_ACCEPTANCE_TIMEOUT_HOURS, default 24)');
  logger.info('   - Deferred dispute refunds (`payment_actions`): every 2 minutes');
  logger.info('   - Stripe reconciliation + stale refund-action probe: hourly');
  logger.info('   - Recalculate reliability: daily at 2 AM');
  logger.info('   - Monthly coach reliability reset: disabled (V2 decay model)');
};

/**
 * Stop all workers (for graceful shutdown)
 */
export const stopWorkers = () => {
  workersRunning = false;
  logger.info('Workers stopped');
};

