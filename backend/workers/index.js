import cron from 'node-cron';
import { logger } from '../config/logger.js';
import * as reminderWorker from './reminderWorker.js';
import * as autoConfirmWorker from './autoConfirmWorker.js';
import * as payoutWorker from './payoutWorker.js';
import * as reliabilityWorker from './reliabilityWorker.js';
import * as chargePaidRescheduleWorker from './chargePaidRescheduleWorker.js';
import * as retryFailedPaymentsWorker from './retryFailedPaymentsWorker.js';
import * as stripeReconciliationWorker from './stripeReconciliationWorker.js';
import * as pendingBookingExpiryWorker from './pendingBookingExpiryWorker.js';

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

  // Process paid reschedule payments: every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      await chargePaidRescheduleWorker.processPaidReschedulePayments();
    } catch (error) {
      logger.error('Error in paid reschedule worker:', error);
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

  // Expire stale pending bookings (no coach response): every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await pendingBookingExpiryWorker.expireStalePendingBookings();
    } catch (error) {
      logger.error('Error in pending booking expiry worker:', error);
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

  // V2 reliability uses rolling window + decay, so hard monthly resets are disabled.

  workersRunning = true;
  logger.info('✅ Background workers started successfully');
  logger.info('   - Reminder notifications: every minute');
  logger.info('   - Auto-confirm lessons: every 5 minutes');
  logger.info('   - Process payouts: every 10 minutes');
  logger.info('   - Process paid reschedules: every 10 minutes');
  logger.info('   - Retry failed payments: every 10 minutes');
  logger.info('   - Pending booking expiry: every 15 minutes (PENDING_BOOKING_EXPIRY_HOURS, default 24)');
  logger.info('   - Stripe reconciliation: hourly');
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

