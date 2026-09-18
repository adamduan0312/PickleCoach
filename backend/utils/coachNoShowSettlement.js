/**
 * Coach-no-show settlement: auto remaining refund vs retained coach payout.
 *
 * Admin dispute resolve is authoritative for money:
 * - `refund_student` (full) → student gets remaining; coach $0
 * - `refund_student_partial` → student gets the selected amount; remainder is
 *   coach/platform split (same net-retained math as completed lessons)
 * - No dispute partial path (plain admin mark) → after the review window,
 *   `booking_coach_no_show_refund` refunds remaining to the student
 *
 * Do not treat booking.status === coach_no_show alone as "refund everything."
 */
import { Op } from 'sequelize';
import { Dispute, DisputeResolutionAction, PaymentAction } from '../models/index.js';
import { isLateCancelRefundSettledForPayout } from './lateCancelPayout.js';

/** Pure: dispute partial means retain remainder for coach/platform, not a second refund. */
export function shouldRetainCoachNoShowRemainderForPayout({
  hasDisputePartialPaymentAction = false,
  resolutionActionCode = null,
} = {}) {
  if (hasDisputePartialPaymentAction) return true;
  return String(resolutionActionCode || '') === 'partial_refund';
}

/**
 * True when a dispute intentionally left retained funds for coach payout
 * (partial refund path), so auto coach-no-show remaining refund must not run.
 *
 * @param {number} bookingId
 * @returns {Promise<boolean>}
 */
export async function hasCoachNoShowRetainedPayoutIntent(bookingId) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id < 1) return false;

  const partialAction = await PaymentAction.findOne({
    where: {
      booking_id: id,
      action_type: 'dispute_refund_partial',
      status: { [Op.in]: ['pending', 'succeeded'] },
    },
    attributes: ['id'],
  });

  const dispute = await Dispute.findOne({
    where: { booking_id: id, status: 'resolved' },
    include: [
      {
        model: DisputeResolutionAction,
        as: 'resolutionAction',
        attributes: ['code'],
        required: false,
      },
    ],
    order: [['resolved_at', 'DESC'], ['id', 'DESC']],
  });

  return shouldRetainCoachNoShowRemainderForPayout({
    hasDisputePartialPaymentAction: Boolean(partialAction),
    resolutionActionCode: dispute?.resolutionAction?.code ?? null,
  });
}

/**
 * Same Stripe settlement gate as late-cancel retained payout:
 * partial mirrored + refund_status succeeded + refunded_amount > 0.
 */
export function isDisputePartialRefundSettledForPayout(payment) {
  return isLateCancelRefundSettledForPayout(payment);
}
