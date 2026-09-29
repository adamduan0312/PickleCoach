/**
 * Student-facing copy for booking API errors.
 * Never surface raw codes like `student_schedule_conflict` in the UI.
 */

const STUDENT_SCHEDULE_CONFLICT = 'student_schedule_conflict';
const SLOT_NO_LONGER_AVAILABLE = 'slot_no_longer_available';
const SLOT_OUTSIDE_COACH_AVAILABILITY = 'slot_outside_coach_availability';

const SLOT_UNAVAILABLE_TITLE = 'This time slot is no longer available.';

/**
 * Wording for what happened to the card when a slot conflict is found.
 * `authorization_cancelled` is only present on confirm (after the card was authorized).
 */
function authorizationOutcomeSentence(err) {
  const cancelled = err?.payload?.authorization_cancelled;
  if (cancelled === true) return ' Your payment authorization was cancelled.';
  if (cancelled === false) {
    return ' You were not charged, and any temporary hold on your card will be released automatically.';
  }
  return '';
}

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
      body: `You can't book overlapping lessons.${authorizationOutcomeSentence(err)} Please choose another time.`,
    };
  }
  if (code === SLOT_NO_LONGER_AVAILABLE) {
    const afterAuthorization = typeof err?.payload?.authorization_cancelled === 'boolean';
    const lead = afterAuthorization
      ? 'Another student booked this time while you were completing checkout.'
      : 'Another student has already booked this time.';
    return {
      kind: 'slot_taken',
      title: SLOT_UNAVAILABLE_TITLE,
      body: `${lead}${authorizationOutcomeSentence(err)} Please choose another available time.`,
    };
  }
  if (code === SLOT_OUTSIDE_COACH_AVAILABILITY) {
    return {
      kind: 'slot_taken',
      title: SLOT_UNAVAILABLE_TITLE,
      body: `The coach's availability has changed.${authorizationOutcomeSentence(err)} Please choose another available time.`,
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
