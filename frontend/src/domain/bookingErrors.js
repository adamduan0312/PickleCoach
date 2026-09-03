/**
 * Student-facing copy for booking API errors.
 * Never surface raw codes like `student_schedule_conflict` in the UI.
 */

const STUDENT_SCHEDULE_CONFLICT = 'student_schedule_conflict';
const SLOT_NO_LONGER_AVAILABLE = 'slot_no_longer_available';

/**
 * @param {unknown} err
 * @returns {{ kind: 'student_schedule' | 'slot_taken', title: string, body: string } | null}
 */
export function bookingApiErrorCopy(err) {
  const code = err && typeof err === 'object' ? err.code : null;
  if (code === STUDENT_SCHEDULE_CONFLICT) {
    return {
      kind: 'student_schedule',
      title: 'You already have a booking at this time.',
      body: "You can't book overlapping lessons. Please choose another time.",
    };
  }
  if (code === SLOT_NO_LONGER_AVAILABLE) {
    return {
      kind: 'slot_taken',
      title: 'This time is no longer available.',
      body: 'Someone else may have booked this coach for that slot. Please choose another time.',
    };
  }
  return null;
}

/** Flat string for ErrorState / simple Alert. */
export function bookingApiErrorMessage(err) {
  const copy = bookingApiErrorCopy(err);
  if (copy) return `${copy.title} ${copy.body}`;
  const stripeCopy = stripePaymentFormErrorCopy(err);
  if (stripeCopy) return `${stripeCopy.title} ${stripeCopy.body}`;
  if (typeof err === 'string') return err;
  return err?.message || 'Something went wrong.';
}

/**
 * Stripe.js Payment Element lifecycle / confirm failures (never show raw Stripe messages).
 * @returns {{ title: string, body: string } | null}
 */
export function stripePaymentFormErrorCopy(err) {
  const raw = typeof err === 'string'
    ? err
    : (err?.message || '');
  const text = String(raw).toLowerCase();
  const looksUnmounted = text.includes('mounted payment element')
    || text.includes('express checkout element');
  if (looksUnmounted) {
    return {
      title: 'Payment form isn’t ready.',
      body: 'Check your connection, then refresh this page and try again.',
    };
  }
  return null;
}
