/**
 * Booking status derivation for `PUT /api/disputes/:id/resolve`.
 * Pure helpers — attendance/behavior rules unchanged; `other` mirrors behavior
 * for releasing Stripe-parked `disputed` bookings back to `completed`.
 */

import {
  BEHAVIOR_DISPUTE_TYPE_CODES,
  CATCHALL_DISPUTE_TYPE_CODE,
} from './disputeTypeCatalog.js';
import { BookingTransitionVia } from '../services/bookingStateMachine.js';

/**
 * @param {{ disputeTypeCode: string | null | undefined, bookingStatus: string, outcome?: string | null }}
 * @returns {string}
 */
export function deriveResolvedBookingStatusFromDisputeResolve({
  disputeTypeCode,
  bookingStatus,
  outcome,
}) {
  const isAttendanceClaim =
    disputeTypeCode === 'coach_no_show_claim' || disputeTypeCode === 'student_no_show_claim';
  const isBehaviorDispute = BEHAVIOR_DISPUTE_TYPE_CODES.includes(disputeTypeCode);
  const isCatchallDispute = disputeTypeCode === CATCHALL_DISPUTE_TYPE_CODE;

  let resolvedBookingStatus = bookingStatus;
  if (isAttendanceClaim) {
    if (outcome === 'student_no_show' || outcome === 'coach_no_show') {
      resolvedBookingStatus = outcome;
    }
  } else if ((isBehaviorDispute || isCatchallDispute) && bookingStatus === 'disputed') {
    resolvedBookingStatus = 'completed';
  }
  return resolvedBookingStatus;
}

/**
 * @param {{ disputeTypeCode: string | null | undefined, fromStatus: string, toStatus: string }}
 * @returns {string}
 */
export function deriveDisputeResolveBookingTransitionVia({ disputeTypeCode, fromStatus, toStatus }) {
  if (fromStatus === 'disputed' && toStatus === 'completed') {
    if (BEHAVIOR_DISPUTE_TYPE_CODES.includes(disputeTypeCode)) {
      return BookingTransitionVia.DISPUTE_RESOLVE_BEHAVIOR_ON_DISPUTED_BOOKING;
    }
    if (disputeTypeCode === CATCHALL_DISPUTE_TYPE_CODE) {
      return BookingTransitionVia.DISPUTE_RESOLVE_CATCHALL_ON_DISPUTED_BOOKING;
    }
  }
  return BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE;
}
