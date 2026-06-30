/**
 * Payment authorization gating for coach-must-confirm (manual capture) bookings.
 * Pure helpers — safe to unit test without DB or Stripe.
 */

export const PAYMENT_AUTH_FAILURE_CANCELLATION_NOTE =
  'Payment authorization failed — booking auto-cancelled';

export const COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY = 'coach_booking_request_notified';

/** Stripe PI statuses that mean funds are authorized and ready for manual capture. */
const STRIPE_AUTHORIZED_FOR_MANUAL_CAPTURE = new Set(['requires_capture']);

const TERMINAL_BOOKING_STATUSES = new Set([
  'cancelled',
  'completed',
  'disputed',
  'student_no_show',
  'coach_no_show',
]);

const PAYMENT_STATUSES_BLOCKED_FOR_ACCEPT = new Set([
  'failed',
  'pending_void',
  'refunded',
  'partially_refunded',
  'pending_capture',
  'captured',
]);

/**
 * @param {{ status?: string, amount_capturable?: number }} paymentIntent
 */
export function isPaymentIntentAuthorizedForManualCapture(paymentIntent) {
  if (!paymentIntent?.status) return false;
  if (!STRIPE_AUTHORIZED_FOR_MANUAL_CAPTURE.has(paymentIntent.status)) return false;
  const capturable = Number(paymentIntent.amount_capturable ?? 0);
  return capturable > 0;
}

/**
 * @param {string | null | undefined} bookingStatus
 */
export function isBookingTerminalForAuthFailureCancel(bookingStatus) {
  return TERMINAL_BOOKING_STATUSES.has(String(bookingStatus || ''));
}

/**
 * @param {object | null | undefined} metadata
 */
export function wasCoachBookingRequestNotified(metadata) {
  return metadata?.[COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY] === true;
}

/**
 * @param {Array<{ cancelled_by?: string, reason_notes?: string | null }> | null | undefined} historyRows
 */
export function hasAuthFailureCancellationHistory(historyRows) {
  if (!Array.isArray(historyRows) || historyRows.length === 0) return false;
  return historyRows.some(
    (row) =>
      row.cancelled_by === 'system' &&
      String(row.reason_notes || '').includes(PAYMENT_AUTH_FAILURE_CANCELLATION_NOTE),
  );
}

/**
 * Pending coach requests are visible only when the latest payment is authorized,
 * or when no payment row exists (legacy accept-without-payment path).
 *
 * @param {string | null | undefined} latestPaymentStatus — null when no payment row
 */
export function isPendingBookingVisibleToCoach(latestPaymentStatus) {
  if (latestPaymentStatus == null) return true;
  return latestPaymentStatus === 'authorized';
}

/**
 * @param {string | null | undefined} paymentStatus
 * @param {string | null | undefined} [stripePaymentIntentStatus]
 */
export function assertPaymentReadyForCoachCapture(paymentStatus, stripePaymentIntentStatus = null) {
  if (paymentStatus === 'authorized') {
    if (
      stripePaymentIntentStatus &&
      !STRIPE_AUTHORIZED_FOR_MANUAL_CAPTURE.has(stripePaymentIntentStatus)
    ) {
      const err = new Error(
        'Payment is not authorized for capture. The student must complete card authorization before you can accept.',
      );
      err.statusCode = 400;
      err.code = 'payment_not_authorized_for_accept';
      throw err;
    }
    return;
  }

  if (paymentStatus === 'pending') {
    const err = new Error(
      'Payment authorization is still pending. The student must complete card authorization before you can accept.',
    );
    err.statusCode = 400;
    err.code = 'payment_authorization_pending';
    throw err;
  }

  if (PAYMENT_STATUSES_BLOCKED_FOR_ACCEPT.has(String(paymentStatus || ''))) {
    const err = new Error(
      'Payment is not in an authorized state. This booking cannot be accepted.',
    );
    err.statusCode = 400;
    err.code = 'payment_not_authorized_for_accept';
    throw err;
  }

  const err = new Error(
    'Payment is not in an authorized state. This booking cannot be accepted.',
  );
  err.statusCode = 400;
  err.code = 'payment_not_authorized_for_accept';
  throw err;
}
