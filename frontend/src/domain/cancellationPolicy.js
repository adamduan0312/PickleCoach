/**
 * Cancellation policy copy shown at decision points (checkout, accept, booking detail, cancel).
 *
 * Money follows who cancels and when (backend paymentEngine.computeCancellationSplitCents);
 * reliability follows the reason, and only once the coach has accepted
 * (backend reliabilityPenaltyService + runPreLessonCancel). Keep both in sync.
 */
import { formatBookingWhenInZone, formatRemainingUntil } from '../utils/datetime.js';

export const FULL_REFUND_CUTOFF_HOURS = 24;

/** Mirrors NON_PENALIZED_REASONS in backend/services/reliabilityPenaltyService.js. */
export const RELIABILITY_EXCUSED_REASONS = Object.freeze(['weather', 'sickness', 'emergency']);

export const RELIABILITY_POLICY_LINE =
  'Once a lesson is accepted, cancelling for weather, sickness, or an emergency doesn’t affect your reliability score. Other reasons may affect it, especially within 24 hours.';

export const STUDENT_WEATHER_POLICY_LINE =
  'Bad weather within 24 hours of the lesson? Ask your coach to cancel for weather. If they agree, you get a full refund and neither of you is penalized.';

export const COACH_WEATHER_POLICY_LINE =
  'Bad weather within 24 hours of the lesson? You or the student can ask to cancel for weather. If the other person agrees, the student gets a full refund, you aren’t paid, and neither of you is penalized.';

export function studentCancellationPolicyLines() {
  return [
    'Until your coach accepts, you can cancel for free — your card is only authorized and your reliability score isn’t affected.',
    'After your coach accepts, cancel at least 24 hours before the lesson for a full refund.',
    'Cancellations less than 24 hours before the lesson receive a 50% refund.',
    STUDENT_WEATHER_POLICY_LINE,
    'If your coach cancels, you get a full refund.',
    'If you don’t show up, your payment isn’t automatically refunded and your reliability score is affected.',
    RELIABILITY_POLICY_LINE,
  ];
}

export function coachCancellationPolicyLines() {
  return [
    'Declining a request doesn’t affect your reliability score.',
    'If you cancel an accepted lesson, the student gets a full refund and you aren’t paid for it.',
    'If the student cancels less than 24 hours before the lesson, they get 50% back and you’re paid your share of the rest.',
    COACH_WEATHER_POLICY_LINE,
    'If the student doesn’t show up, mark Student no-show after the lesson. Their payment isn’t automatically refunded.',
    RELIABILITY_POLICY_LINE,
  ];
}

export function cancellationPolicyLines(audience) {
  return audience === 'coach' ? coachCancellationPolicyLines() : studentCancellationPolicyLines();
}

/** ISO time when student cancellations stop receiving a full refund. */
export function fullRefundDeadlineAt(booking) {
  const start = booking?.scheduled_at ? new Date(booking.scheduled_at).getTime() : NaN;
  if (!Number.isFinite(start)) return null;
  return new Date(start - FULL_REFUND_CUTOFF_HOURS * 60 * 60 * 1000).toISOString();
}

function lessonStarted(booking, now) {
  const start = booking?.scheduled_at ? new Date(booking.scheduled_at).getTime() : NaN;
  return !Number.isFinite(start) || now >= start;
}

/** True when the lesson is less than 24 hours away (and hasn't started). */
export function isWithinLateCancelWindow(booking, now = Date.now()) {
  const deadline = fullRefundDeadlineAt(booking);
  if (!deadline || lessonStarted(booking, now)) return false;
  return now >= new Date(deadline).getTime();
}

/**
 * Booking-detail summary of what cancelling means right now, with the concrete deadline.
 * Null once cancelling is no longer possible (lesson started / not pending or confirmed).
 *
 * @returns {{ headline: string, body: string } | null}
 */
export function cancellationPolicySummary(booking, { audience = 'student', now = Date.now(), tz } = {}) {
  if (!booking || !['pending', 'confirmed'].includes(booking.status)) return null;
  if (lessonStarted(booking, now)) return null;

  const deadline = fullRefundDeadlineAt(booking);
  const when = formatBookingWhenInZone(deadline, tz);
  const late = isWithinLateCancelWindow(booking, now);

  if (audience === 'coach') {
    if (booking.status === 'pending') {
      return {
        headline: 'Before you accept',
        body: 'If you accept and later cancel, the student gets a full refund and you aren’t paid. Declining now doesn’t affect your reliability score.',
      };
    }
    return {
      headline: 'If you need to cancel',
      body: late
        ? 'The student gets a full refund and you aren’t paid. The lesson is less than 24 hours away, so a cancellation may weigh more on your reliability score.'
        : `The student gets a full refund and you aren’t paid. A cancellation may affect your reliability score — more so after ${when}, when the lesson is less than 24 hours away.`,
    };
  }

  if (booking.status === 'pending') {
    return {
      headline: 'Free to cancel — you haven’t been charged',
      body: late
        ? 'Cancelling before your coach accepts doesn’t affect your reliability score. Once they accept, cancellations receive a 50% refund because the lesson is less than 24 hours away.'
        : `Cancelling before your coach accepts doesn’t affect your reliability score. Once they accept, you can still cancel for a full refund until ${when}. After that, cancellations receive a 50% refund.`,
    };
  }

  if (late) {
    return {
      headline: 'Cancelling now refunds 50%',
      body: booking.weather_cancellation?.can_request
        ? `The full-refund deadline was ${when}. If it’s because of bad weather, ask your coach to cancel for weather instead — if they agree, you get a full refund.`
        : `The full-refund deadline was ${when}.`,
    };
  }
  return {
    headline: `Full refund until ${when}`,
    body: `${formatRemainingUntil(deadline, new Date(now))} left. After that, cancellations receive a 50% refund.`,
  };
}

const EXCUSED_REASON_COPY = {
  weather: 'Cancelling for weather doesn’t affect your reliability score.',
  sickness: 'Cancelling because of sickness doesn’t affect your reliability score.',
  emergency: 'Cancelling for an emergency doesn’t affect your reliability score.',
};

/** Reliability line for the cancel dialog; updates with the selected reason. */
export function cancelReliabilityConsequenceCopy(reason, booking, now = Date.now()) {
  if (booking?.status === 'pending') {
    return 'Your coach hasn’t accepted yet, so cancelling doesn’t affect your reliability score.';
  }
  if (RELIABILITY_EXCUSED_REASONS.includes(reason)) return EXCUSED_REASON_COPY[reason];
  if (isWithinLateCancelWindow(booking, now)) {
    return 'This may affect your reliability score. Cancellations less than 24 hours before the lesson count more.';
  }
  return 'This may affect your reliability score.';
}

/** Student picked Weather inside 24h while a mutual request is still possible: point to it. */
export function cancelWeatherAlternativeHint(reason, booking, { audience, now = Date.now() } = {}) {
  if (reason !== 'weather' || audience !== 'student') return null;
  if (!isWithinLateCancelWindow(booking, now) || !booking?.weather_cancellation?.can_request) return null;
  return 'Instead of cancelling, ask your coach to cancel for weather (above). If they agree, you get a full refund.';
}

export const WEATHER_ACTION_NEEDED_LABEL = 'Action needed — Weather cancellation request';

/**
 * The other participant asked to cancel for weather and this viewer hasn't answered yet.
 * List rows carry `pending_weather_request`; booking detail carries `weather_cancellation`.
 */
export function weatherRequestAwaitsResponse(booking, audience, now = Date.now()) {
  if (booking?.status !== 'confirmed' || (audience !== 'coach' && audience !== 'student')) return false;
  const start = booking.scheduled_at ? new Date(booking.scheduled_at).getTime() : NaN;
  if (!Number.isFinite(start) || now >= start) return false;
  const detailRequest = booking.weather_cancellation?.request;
  if (detailRequest) return detailRequest.can_respond === true;
  const pending = booking.pending_weather_request;
  return Boolean(pending?.requested_by && pending.requested_by !== audience);
}

export function isMutualWeatherCancellation(booking) {
  return booking?.status === 'cancelled' && booking?.weather_cancellation?.request?.status === 'accepted';
}

function otherPartyName(booking, audience) {
  if (audience === 'coach') return booking?.primaryStudent?.full_name || 'The student';
  return booking?.coach?.full_name || 'Your coach';
}

/**
 * What the booking-detail weather card shows for the viewer.
 * `prominent` cards (a response is needed / waiting / just declined) sit at the top of the page.
 *
 * @returns {null | {
 *   kind: 'respond'|'waiting'|'declined'|'available',
 *   prominent: boolean, title: string, body: string, note?: string|null, requestId?: number
 * }}
 */
export function weatherCancellationView(booking, { audience = 'student', now = Date.now(), tz } = {}) {
  const block = booking?.weather_cancellation;
  if (!block || booking.status !== 'confirmed') return null;
  const start = booking.scheduled_at ? new Date(booking.scheduled_at).getTime() : NaN;
  if (!Number.isFinite(start) || now >= start) return null;

  const other = otherPartyName(booking, audience);
  const startLabel = formatBookingWhenInZone(booking.scheduled_at, tz);
  const req = block.request;
  const refundForViewer = audience === 'coach'
    ? 'the student gets a full refund and you aren’t paid'
    : 'you get a full refund';

  if (req?.status === 'pending' && req.can_respond) {
    return {
      kind: 'respond',
      prominent: true,
      requestId: req.id,
      title: `${other} asked to cancel for weather`,
      body: `If you agree, the lesson is cancelled, ${refundForViewer}, and neither of you is penalized. If you’d rather play, keep the lesson. Respond before the lesson starts (${startLabel}).`,
      note: req.note || null,
    };
  }
  if (req?.status === 'pending' && req.requested_by_me) {
    return {
      kind: 'waiting',
      prominent: true,
      requestId: req.id,
      title: 'Weather cancellation requested',
      body: `Waiting for ${audience === 'coach' ? 'the student' : 'your coach'} to respond. If they agree, ${refundForViewer}, and neither of you is penalized. The request expires when the lesson starts (${startLabel}).`,
      note: req.note || null,
    };
  }
  if (req?.status === 'declined') {
    return {
      kind: 'declined',
      prominent: true,
      title: req.requested_by_me ? `${other} declined your weather cancellation` : 'You kept the lesson',
      body: req.requested_by_me
        ? 'The lesson is still on. If you cancel, the normal cancellation rules apply.'
        : 'You declined the weather cancellation. The lesson is still on.',
    };
  }
  // More than 24h out a normal Weather cancel already refunds in full, so there is nothing to ask for.
  if (block.can_request && isWithinLateCancelWindow(booking, now)) {
    return {
      kind: 'available',
      prominent: false,
      title: 'Bad weather?',
      body: `Ask ${audience === 'coach' ? 'the student' : 'your coach'} to cancel for weather. If they agree, ${refundForViewer}, and neither of you is penalized. If not, the lesson stays on.`,
    };
  }
  return null;
}

/** No reschedule yet; coaches can't cancel a pending request, so they decline it instead. */
export function rescheduleHint(booking, audience) {
  if (!['pending', 'confirmed'].includes(booking?.status)) return null;
  if (audience === 'coach' && booking.status === 'pending') {
    return 'Need a different time? Decline this request and ask the student to book a new slot.';
  }
  return 'There is no reschedule option yet. To change the time, cancel this booking and book a new slot.';
}

/** Cancel reasons are self-reported; say who sees them. */
export function cancelReasonSharedHint(audience) {
  const other = audience === 'coach' ? 'student' : 'coach';
  return `Choose the reason that honestly describes what happened. It’s shared with your ${other}.`;
}
