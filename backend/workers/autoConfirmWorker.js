import { Booking, Payment } from '../models/index.js';
import { Op } from 'sequelize';
import { sequelize } from '../models/sequelize.js';
import { logger } from '../config/logger.js';
import { createAuditLog } from '../utils/audit.js';
import {
  assertBulkBookingStatusTransition,
  applyBookingStatusTransition,
  BookingTransitionVia,
} from '../services/bookingStateMachine.js';
import { ACTIVE_DISPUTE_STATUSES } from '../services/disputeStateMachine.js';

/**
 * Move confirmed → awaiting_verification when lesson end time has passed.
 * Runs every 5 minutes (before the awaiting_verification → completed step).
 */
const moveConfirmedToAwaitingVerification = async () => {
  const dialect = sequelize.getDialect();
  const lessonEndPastLiteral =
    dialect === 'mysql'
      ? sequelize.literal('DATE_ADD(scheduled_at, INTERVAL duration_minutes MINUTE) <= NOW()')
      : dialect === 'postgres'
        ? sequelize.literal("(scheduled_at + duration_minutes * interval '1 minute') <= NOW()")
        : sequelize.literal("datetime(scheduled_at, '+' || duration_minutes || ' minutes') <= datetime('now')");

  assertBulkBookingStatusTransition(
    'confirmed',
    'awaiting_verification',
    BookingTransitionVia.WORKER_LESSON_END_TO_AWAITING_VERIFICATION,
  );
  const updated = await Booking.update(
    { status: 'awaiting_verification' },
    {
      where: {
        status: 'confirmed',
        [Op.and]: [lessonEndPastLiteral],
      },
    }
  );

  if (updated[0] > 0) {
    logger.info(`Moved ${updated[0]} booking(s) from confirmed to awaiting_verification (lesson time passed)`);
  }
};

/**
 * Auto-confirm lessons that are past scheduled time and haven't been confirmed.
 * 1. confirmed → awaiting_verification when lesson end time has passed.
 * 2. awaiting_verification → completed when 24h past lesson END time (no coach confirmation).
 *    Uses end time so the dispute window is exactly 24 hours after the lesson ends.
 * Runs every 5 minutes.
 */
export const autoConfirmLessons = async () => {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    // Phase 1: confirmed → awaiting_verification when lesson time has passed
    await moveConfirmedToAwaitingVerification();

    // Phase 2: Find bookings that:
    // 1. Are in 'awaiting_verification' status
    // 2. Lesson END time was at least 24 hours ago (not start time — gives full 24h dispute window)
    // 3. No coach confirmation within 24h of lesson end → auto-complete
    const dialect = sequelize.getDialect();
    const lessonEndColumn =
      dialect === 'mysql'
        ? sequelize.literal('DATE_ADD(scheduled_at, INTERVAL duration_minutes MINUTE)')
        : dialect === 'postgres'
          ? sequelize.literal("(scheduled_at + duration_minutes * interval '1 minute')")
          : sequelize.literal("datetime(scheduled_at, '+' || duration_minutes || ' minutes')");

    const bookings = await Booking.findAll({
      where: {
        status: 'awaiting_verification',
        [Op.and]: [
          sequelize.where(lessonEndColumn, Op.lte, twentyFourHoursAgo),
        ],
      },
      include: [
        {
          model: Payment,
          as: 'payments',
          required: false,
        },
      ],
    });

    for (const booking of bookings) {
      // Check if there's an open dispute
      const hasOpenDispute = await booking.getDisputes({
        where: {
          status: { [Op.in]: [...ACTIVE_DISPUTE_STATUSES] },
        },
      });

      if (hasOpenDispute.length > 0) {
        logger.info(`Skipping auto-confirm for booking ${booking.id} - open dispute exists`);
        continue;
      }

      // Auto-confirm the booking
      await applyBookingStatusTransition(booking, {
        toStatus: 'completed',
        via: BookingTransitionVia.MARK_COMPLETED,
        patch: { payout_status: 'pending' },
      });

      await createAuditLog({
        user_id: null,
        action: 'booking_auto_confirmed',
        table_name: 'bookings',
        record_id: booking.id,
        after_state: { status: 'completed', payout_status: 'pending' },
      });

      logger.info(`Auto-confirmed booking ${booking.id}`);
    }

    logger.info(`Auto-confirm worker processed ${bookings.length} bookings`);
  } catch (error) {
    logger.error('Error in auto-confirm worker:', error);
    throw error;
  }
};

