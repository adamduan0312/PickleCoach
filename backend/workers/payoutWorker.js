import { Booking, Payment, User, CoachProfile, CancellationHistory, PaymentAction, Dispute, sequelize } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import * as paymentService from '../services/paymentService.js';
import { ACTIVE_DISPUTE_STATUSES } from '../services/disputeStateMachine.js';
import {
  isLateCancelRetainedRevenueEligibleFromHistory,
  isLateCancelRefundSettledForPayout,
} from '../utils/lateCancelPayout.js';
import { isPaymentEscrowPayable } from '../utils/payoutEscrowEligibility.js';
import { nextBookingPayoutStatusAfterReleaseEscrow } from '../utils/bookingPayoutStatus.js';
import {
  bookingStatusUsesPostLessonPayoutClock,
  isPostLessonFinancialReviewElapsed,
} from '../utils/financialReviewWindow.js';
import {
  hasCoachNoShowRetainedPayoutIntent,
  isDisputePartialRefundSettledForPayout,
} from '../utils/coachNoShowSettlement.js';

/**
 * One held-escrow payment through the same gates as `processPayouts`.
 * Exported so cutoff-race integration tests can target a fixture without
 * scanning every payable row in the database.
 */
export async function processHeldEscrowPayment(payment) {
  if (!isPaymentEscrowPayable(payment)) {
    logger.info(
      `Skipping payout for payment ${payment.id} - escrow_status "${payment.escrow_status}" not payable`,
    );
    return { skipped: true, reason: 'escrow_not_payable' };
  }

  // Dev/QA fixtures may insert held escrow without a transferable Stripe charge.
  // Never let the worker park those at manual_payout_required.
  const meta = payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : {};
  if (meta.seed_skip_payout_worker === true || meta.qa_fixture === true) {
    logger.info(`Skipping payout for payment ${payment.id} - seed/QA fixture`);
    return { skipped: true, reason: 'seed_fixture' };
  }

  if (bookingStatusUsesPostLessonPayoutClock(payment.booking.status)
    && !isPostLessonFinancialReviewElapsed(payment.booking)) {
    logger.info(
      `Skipping payout for payment ${payment.id} - 24h post-lesson financial review window has not ended`,
    );
    return { skipped: true, reason: 'review_window' };
  }

  if (payment.booking.status === 'cancelled') {
    const history = await CancellationHistory.findOne({
      where: { booking_id: payment.booking_id },
      order: [['id', 'DESC']],
    });
    if (!isLateCancelRetainedRevenueEligibleFromHistory(history)) {
      return { skipped: true, reason: 'late_cancel_ineligible' };
    }
    const pendingCancelRefund = await PaymentAction.findOne({
      where: {
        booking_id: payment.booking_id,
        action_type: 'booking_cancel_refund',
        status: 'pending',
      },
    });
    if (pendingCancelRefund) {
      logger.info(`Skipping late-cancel payout for payment ${payment.id} - cancel refund action pending`);
      return { skipped: true, reason: 'cancel_refund_pending' };
    }
    if (payment.refund_status === 'pending') {
      logger.info(`Skipping late-cancel payout for payment ${payment.id} - refund pending`);
      return { skipped: true, reason: 'refund_pending' };
    }
    if (!isLateCancelRefundSettledForPayout(payment)) {
      logger.info(`Skipping late-cancel payout for payment ${payment.id} - partial refund not settled yet`);
      return { skipped: true, reason: 'late_cancel_refund_unsettled' };
    }
  }

  if (payment.booking.status === 'coach_no_show') {
    if (!(await hasCoachNoShowRetainedPayoutIntent(payment.booking_id))) {
      // Plain coach_no_show is refunded via settleCoachNoShowRefunds, not paid out.
      return { skipped: true, reason: 'coach_no_show_auto_refund_path' };
    }
    const pendingPartial = await PaymentAction.findOne({
      where: {
        booking_id: payment.booking_id,
        action_type: 'dispute_refund_partial',
        status: 'pending',
      },
    });
    if (pendingPartial) {
      logger.info(`Skipping coach_no_show retained payout for payment ${payment.id} - dispute partial pending`);
      return { skipped: true, reason: 'dispute_partial_pending' };
    }
    if (payment.refund_status === 'pending') {
      logger.info(`Skipping coach_no_show retained payout for payment ${payment.id} - refund pending`);
      return { skipped: true, reason: 'refund_pending' };
    }
    if (!isDisputePartialRefundSettledForPayout(payment)) {
      logger.info(`Skipping coach_no_show retained payout for payment ${payment.id} - partial refund not settled`);
      return { skipped: true, reason: 'dispute_partial_unsettled' };
    }
  }

  // Serialize against dispute create: lock the booking, recheck window + open disputes.
  let payoutBlockedReason = null;
  await sequelize.transaction(async (transaction) => {
    const lockedBooking = await Booking.findByPk(payment.booking_id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lockedBooking) {
      payoutBlockedReason = 'booking_missing';
      return;
    }
    if (
      bookingStatusUsesPostLessonPayoutClock(lockedBooking.status)
      && !isPostLessonFinancialReviewElapsed(lockedBooking)
    ) {
      payoutBlockedReason = 'review_window';
      return;
    }
    const lockedDisputes = await Dispute.findAll({
      where: {
        booking_id: lockedBooking.id,
        status: { [Op.in]: [...ACTIVE_DISPUTE_STATUSES] },
      },
      transaction,
    });
    if (lockedDisputes.length > 0) {
      payoutBlockedReason = 'open_dispute';
    }
  });
  if (payoutBlockedReason) {
    logger.info(`Skipping payout for payment ${payment.id} - ${payoutBlockedReason}`);
    return { skipped: true, reason: payoutBlockedReason };
  }

  const pendingSettlementRefund = await PaymentAction.findOne({
    where: {
      booking_id: payment.booking_id,
      action_type: {
        [Op.in]: [
          'dispute_refund_full',
          'dispute_refund_partial',
          'booking_admin_refund',
          'booking_coach_no_show_refund',
        ],
      },
      status: 'pending',
    },
  });
  if (pendingSettlementRefund) {
    logger.info(
      `Skipping payout for payment ${payment.id} - refund action pending (${pendingSettlementRefund.action_type})`,
    );
    return { skipped: true, reason: 'refund_action_pending' };
  }

  if (payment.refund_status === 'pending') {
    logger.info(`Skipping payout for payment ${payment.id} - refund pending`);
    return { skipped: true, reason: 'refund_pending' };
  }

  const coachStripeAccountId = payment.coach.coachProfile?.stripe_account_id || null;
  const releaseResult = await paymentService.releaseEscrow(payment.id, coachStripeAccountId);
  if (releaseResult?.skipped) {
    logger.info(
      `Skipping payout for payment ${payment.id} - ${releaseResult.reason || 'release_skipped'}`,
    );
    return { skipped: true, reason: releaseResult.reason || 'release_skipped' };
  }

  await payment.reload();
  await payment.booking.reload();
  const nextPayoutStatus = nextBookingPayoutStatusAfterReleaseEscrow({
    currentPayoutStatus: payment.booking.payout_status,
    escrowStatus: payment.escrow_status,
  });
  if (nextPayoutStatus !== payment.booking.payout_status) {
    await payment.booking.update({ payout_status: nextPayoutStatus });
  }

  logger.info(`Processed payout for payment ${payment.id}`);
  return { skipped: false, reason: null };
}

/**
 * Process payouts for completed bookings and student late-cancels with retained revenue.
 * Runs every 10 minutes
 *
 * Post-lesson payouts (`completed`, `student_no_show`, and `coach_no_show` after a
 * dispute partial retained remainder) wait until lesson end + 24h regardless of
 * Complete / no-show clicks. Open disputes block payout. Late-cancel `cancelled`
 * payouts are pre-lesson and do not use this clock. Plain `coach_no_show` without
 * a dispute partial is refunded via settleCoachNoShowRefunds instead.
 */
export const processPayouts = async () => {
  try {
    await settleCoachNoShowRefunds();

    const payments = await Payment.findAll({
      where: {
        escrow_status: 'held',
        payment_status: { [Op.in]: ['captured', 'partially_refunded'] },
      },
      include: [
        {
          model: Booking,
          as: 'booking',
          where: {
            status: {
              [Op.in]: ['completed', 'student_no_show', 'cancelled', 'coach_no_show'],
            },
            payout_status: { [Op.in]: ['none', 'pending', 'awaiting_verification'] },
          },
          include: [
            {
              model: Payment,
              as: 'payments',
            },
          ],
        },
        {
          model: User,
          as: 'coach',
          attributes: ['id', 'full_name', 'email'],
          include: [
            {
              model: CoachProfile,
              as: 'coachProfile',
            },
          ],
        },
      ],
    });

    for (const payment of payments) {
      try {
        await processHeldEscrowPayment(payment);
      } catch (error) {
        logger.error(`Error processing payout for payment ${payment.id}:`, error);
        // Continue with next payment
      }
    }

    await healReleasedBookingsStillProcessing();

    logger.info(`Payout worker processed ${payments.length} payments`);
  } catch (error) {
    logger.error('Error in payout worker:', error);
    throw error;
  }
};

/**
 * After the 24h review window, enqueue student refunds for coach_no_show bookings
 * that have no open dispute. Marks do not refund immediately.
 */
async function settleCoachNoShowRefunds() {
  const bookings = await Booking.findAll({
    where: { status: 'coach_no_show' },
    attributes: ['id', 'scheduled_at', 'duration_minutes', 'status'],
  });
  for (const booking of bookings) {
    if (!isPostLessonFinancialReviewElapsed(booking)) continue;
    try {
      const result = await paymentService.enqueueCoachNoShowRefundIfEligible(booking.id);
      if (result.status === 'queued') {
        logger.info(`Queued coach_no_show refund for booking ${booking.id} after review window`);
      }
    } catch (error) {
      logger.error(`Error settling coach_no_show refund for booking ${booking.id}:`, error);
    }
  }
}

/**
 * Bookings left at `processing` after a confirmed release (webhook already ran,
 * or the prior worker only wrote `processing`). Advance to `paid`.
 */
async function healReleasedBookingsStillProcessing() {
  const stale = await Booking.findAll({
    where: { payout_status: 'processing' },
    include: [
      {
        model: Payment,
        as: 'payments',
        required: true,
        where: { escrow_status: 'released' },
      },
    ],
  });
  for (const booking of stale) {
    await paymentService.markBookingPayoutPaid(booking.id);
  }
  if (stale.length) {
    logger.info(`Healed ${stale.length} booking(s) payout_status processing → paid`);
  }
}

