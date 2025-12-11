import cron from 'node-cron';
import { logger } from '../config/logger.js';
import * as reminderWorker from './reminderWorker.js';
import * as autoConfirmWorker from './autoConfirmWorker.js';
import * as payoutWorker from './payoutWorker.js';
import * as reliabilityWorker from './reliabilityWorker.js';

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

  // Recalculate reliability: daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      await reliabilityWorker.recalculateReliability();
    } catch (error) {
      logger.error('Error in reliability worker:', error);
    }
  });

  workersRunning = true;
  logger.info('Background workers started successfully');
};

/**
 * Stop all workers (for graceful shutdown)
 */
export const stopWorkers = () => {
  workersRunning = false;
  logger.info('Workers stopped');
};

