import {
  sequelize,
  Payment,
  Booking,
  CancellationHistory,
  AuditLog,
} from '../models/index.js';
import { applyBookingStatusTransition, BookingTransitionVia } from './bookingStateMachine.js';
import { createAuditLog } from '../utils/audit.js';
import { logger } from '../config/logger.js';
import * as notificationService from './notificationService.js';
import {
  COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY,
  PAYMENT_AUTH_FAILURE_CANCELLATION_NOTE,
  hasAuthFailureCancellationHistory,
  isBookingTerminalForAuthFailureCancel,
  isPaymentIntentAuthorizedForManualCapture,
  wasCoachBookingRequestNotified,
} from '../utils/paymentAuthorizationGate.js';

const AUTH_FAILURE_AUDIT_ACTION = 'payment_authorization_failed_booking_cancelled';

/**
 * Mark payment authorized (manual capture) and notify coach once.
 * Idempotent on webhook retries.
 *
 * @param {import('stripe').Stripe.PaymentIntent} paymentIntent
 */
export async function handlePaymentAuthorizationSucceeded(paymentIntent) {
  if (!isPaymentIntentAuthorizedForManualCapture(paymentIntent)) {
    logger.info({
      component: 'stripe',
      event: 'payment_authorization_skipped_not_capturable',
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      amountCapturable: paymentIntent.amount_capturable,
    });
    return { processed: false, reason: 'not_authorized_state' };
  }

  const transaction = await sequelize.transaction();
  let bookingId = null;
  let shouldNotifyCoach = false;

  try {
    const payment = await Payment.findOne({
      where: { payment_intent_id: paymentIntent.id },
      include: [{ model: Booking, as: 'booking' }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!payment) {
      await transaction.rollback();
      logger.info({
        component: 'stripe',
        event: 'payment_authorization_succeeded_no_payment_row',
        paymentIntentId: paymentIntent.id,
        note: 'Authorize-first flow: booking created at POST /api/bookings/confirm',
      });
      return { processed: false, reason: 'intent_only_flow' };
    }

    bookingId = payment.booking_id;
    const booking = payment.booking;
    const metadata = { ...(payment.metadata || {}) };

    if (payment.payment_status === 'pending') {
      metadata.authorization_succeeded_at = new Date().toISOString();
      await payment.update(
        {
          payment_status: 'authorized',
          metadata,
        },
        { transaction },
      );

      await createAuditLog({
        user_id: payment.student_id,
        action: 'payment_authorized',
        table_name: 'payments',
        record_id: payment.id,
        after_state: {
          payment_status: 'authorized',
          payment_intent_id: paymentIntent.id,
          amount_capturable: paymentIntent.amount_capturable,
        },
      });
    } else if (payment.payment_status !== 'authorized') {
      await transaction.commit();
      return { processed: false, reason: `payment_status_${payment.payment_status}` };
    }

    shouldNotifyCoach =
      booking?.status === 'pending' && !wasCoachBookingRequestNotified(metadata);

    if (shouldNotifyCoach) {
      metadata[COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY] = true;
      metadata.coach_booking_request_notified_at = new Date().toISOString();
      await payment.update({ metadata }, { transaction });
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  if (shouldNotifyCoach && bookingId) {
    try {
      await notificationService.notifyCoachNewBookingRequest(bookingId);
    } catch (notifyErr) {
      logger.warn({
        component: 'booking',
        event: 'notify_coach_after_authorization_failed',
        bookingId,
        message: notifyErr?.message || String(notifyErr),
      });
    }
  }

  logger.info({
    component: 'stripe',
    event: 'payment_authorization_succeeded_processed',
    paymentIntentId: paymentIntent.id,
    bookingId,
    coachNotified: shouldNotifyCoach,
  });

  return { processed: true, coachNotified: shouldNotifyCoach };
}

/**
 * Auto-cancel pending booking when authorization fails.
 * Idempotent on webhook retries.
 *
 * @param {import('stripe').Stripe.PaymentIntent} paymentIntent
 */
export async function handlePaymentAuthorizationFailed(paymentIntent) {
  const transaction = await sequelize.transaction();

  try {
    const payment = await Payment.findOne({
      where: { payment_intent_id: paymentIntent.id },
      include: [{ model: Booking, as: 'booking' }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!payment) {
      await transaction.rollback();
      logger.info({
        component: 'stripe',
        event: 'payment_authorization_failed_no_payment_row',
        paymentIntentId: paymentIntent.id,
        note: 'No booking exists yet in authorize-first flow',
      });
      return { processed: false, reason: 'intent_only_flow' };
    }

    const terminalOrAdvancedStates = new Set(['captured', 'partially_refunded', 'refunded', 'authorized', 'pending_capture']);
    if (terminalOrAdvancedStates.has(payment.payment_status)) {
      await transaction.commit();
      logger.info({
        component: 'stripe',
        event: 'payment_intent_failed_ignored_stale',
        paymentIntentId: paymentIntent.id,
        paymentId: payment.id,
        currentPaymentStatus: payment.payment_status,
      });
      return { processed: false, reason: 'stale_payment_status' };
    }

    const booking = payment.booking;
    const bookingTerminal = booking && isBookingTerminalForAuthFailureCancel(booking.status);

    if (payment.payment_status !== 'failed') {
      await payment.update({ payment_status: 'failed' }, { transaction });
    }

    if (!booking || booking.status !== 'pending') {
      await transaction.commit();
      return { processed: true, bookingCancelled: false, reason: bookingTerminal ? 'booking_terminal' : 'booking_not_pending' };
    }

    const existingHistory = await CancellationHistory.findAll({
      where: { booking_id: booking.id },
      transaction,
    });

    if (hasAuthFailureCancellationHistory(existingHistory)) {
      await transaction.commit();
      return { processed: true, bookingCancelled: false, reason: 'already_cancelled_for_auth_failure' };
    }

    const existingAudit = await AuditLog.findOne({
      where: {
        action: AUTH_FAILURE_AUDIT_ACTION,
        table_name: 'bookings',
        record_id: booking.id,
      },
      transaction,
    });

    await applyBookingStatusTransition(booking, {
      toStatus: 'cancelled',
      via: BookingTransitionVia.PAYMENT_AUTHORIZATION_FAILED,
      patch: {
        cancelled_by: 'system',
        cancelled_at: new Date(),
      },
      options: { transaction },
    });

    await CancellationHistory.create(
      {
        booking_id: booking.id,
        cancelled_by: 'system',
        reason: 'other',
        reason_notes: PAYMENT_AUTH_FAILURE_CANCELLATION_NOTE,
        affects_reliability: false,
        refund_amount: 0,
        penalty_amount: 0,
      },
      { transaction },
    );

    if (!existingAudit) {
      await AuditLog.create(
        {
          user_id: null,
          action: AUTH_FAILURE_AUDIT_ACTION,
          table_name: 'bookings',
          record_id: booking.id,
          after_state: {
            status: 'cancelled',
            cancelled_by: 'system',
            payment_intent_id: paymentIntent.id,
            payment_status: 'failed',
          },
        },
        { transaction },
      );
    }

    await transaction.commit();

    logger.info({
      component: 'stripe',
      event: 'payment_authorization_failed_booking_cancelled',
      paymentIntentId: paymentIntent.id,
      bookingId: booking.id,
    });

    return { processed: true, bookingCancelled: true };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
