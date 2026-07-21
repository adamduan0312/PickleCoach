import { UniqueConstraintError } from 'sequelize';
import { Payment, Booking, Dispute, DisputeType } from '../models/index.js';
import { logger } from '../config/logger.js';
import {
  applyBookingStatusTransition,
  BookingTransitionVia,
} from './bookingStateMachine.js';
import { applyDisputeStatusTransition, DisputeTransitionVia } from './disputeStateMachine.js';
import {
  buildStripeDisputePaymentPatch,
  isTerminalStripeDisputeStatus,
  shouldReleaseBookingFromStripeDisputeTerminal,
} from './paymentStripeContract.js';

/**
 * Map Stripe Dispute.status to in-app disputes.status enum.
 * Stripe is source of truth for lifecycle; this is display/workflow only.
 */
export function mapStripeDisputeStatusToLocal(stripeStatus) {
  if (!stripeStatus) return 'open';
  const underReview = new Set([
    'warning_needs_response',
    'needs_response',
    'warning_under_review',
    'under_review',
  ]);
  if (underReview.has(stripeStatus)) return 'under_review';
  const resolved = new Set(['won', 'lost', 'charge_refunded']);
  if (resolved.has(stripeStatus)) return 'resolved';
  return 'open';
}

/**
 * Mirror Stripe dispute onto payments + disputes rows (webhook-only path).
 */
export async function syncStripeDisputeToDatabase(stripeDispute, { eventType } = {}) {
  const chargeId =
    typeof stripeDispute.charge === 'string' ? stripeDispute.charge : stripeDispute.charge?.id;
  if (!chargeId) {
    throw new Error('Stripe dispute missing charge id');
  }

  const payment = await Payment.findOne({
    where: { charge_id: chargeId },
    include: [{ model: Booking, as: 'booking' }],
  });

  if (!payment) {
    throw new Error(`Payment not found for charge ${chargeId}; retry when linked`);
  }

  const localStatus = mapStripeDisputeStatusToLocal(stripeDispute.status);
  const isTerminal = isTerminalStripeDisputeStatus(stripeDispute.status);

  await payment.update(buildStripeDisputePaymentPatch(stripeDispute));

  if (payment.booking) {
    if (isTerminal) {
      if (shouldReleaseBookingFromStripeDisputeTerminal(payment.booking.status, stripeDispute.status)) {
        try {
          await applyBookingStatusTransition(payment.booking, {
            toStatus: 'completed',
            via: BookingTransitionVia.STRIPE_DISPUTE_TERMINAL,
          });
        } catch (err) {
          logger.warn({
            component: 'stripe',
            event: 'booking_disputed_terminal_release_rejected',
            bookingId: payment.booking_id,
            stripeStatus: stripeDispute.status,
            message: err?.message || String(err),
            code: err?.code,
          });
        }
      }
    } else {
      try {
        await applyBookingStatusTransition(payment.booking, {
          toStatus: 'disputed',
          via: BookingTransitionVia.STRIPE_DISPUTE_OPEN,
        });
      } catch (err) {
        logger.warn({
          component: 'stripe',
          event: 'booking_disputed_transition_rejected',
          bookingId: payment.booking_id,
          message: err?.message || String(err),
          code: err?.code,
        });
      }
    }
  }

  let dispute = await Dispute.findOne({ where: { stripe_dispute_id: stripeDispute.id } });

  if (!dispute) {
    let disputeType = await DisputeType.findOne({ where: { code: 'chargeback' } });
    if (!disputeType) {
      disputeType = await DisputeType.findOne({ order: [['id', 'ASC']] });
    }
    if (!disputeType) {
      logger.warn({
        component: 'stripe',
        event: 'dispute_sync_skipped',
        reason: 'no_dispute_type',
        chargeId,
        stripeDisputeId: stripeDispute.id,
      });
      return;
    }

    try {
      dispute = await Dispute.create({
        booking_id: payment.booking_id,
        dispute_type_id: disputeType.id,
        opened_by: 'system',
        status: localStatus,
        stripe_dispute_id: stripeDispute.id,
        stripe_dispute_status: stripeDispute.status,
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        dispute = await Dispute.findOne({ where: { stripe_dispute_id: stripeDispute.id } });
        if (!dispute) throw err;
      } else {
        throw err;
      }
    }

    if (dispute) await payment.update({ dispute_id: dispute.id });
  } else {
    await applyDisputeStatusTransition(dispute, {
      toStatus: localStatus,
      via: DisputeTransitionVia.STRIPE_SYNC,
      patch: {
        stripe_dispute_status: stripeDispute.status,
      },
    });
  }

  logger.info({
    component: 'stripe',
    event: 'dispute_synced',
    stripeDisputeId: stripeDispute.id,
    stripeStatus: stripeDispute.status,
    localStatus,
    eventType,
    paymentId: payment.id,
    terminal: isTerminal,
  });
}
