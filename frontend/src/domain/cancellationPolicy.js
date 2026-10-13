/**
 * Cancellation policy copy shown at decision points (checkout, accept, booking detail, cancel).
 *
 * Money follows who cancels and when (backend paymentEngine.computeCancellationSplitCents).
 * Inside 24h a student's cancel refunds 50%. Either side may cancel for Weather until 24h before;
 * inside 24h Weather is a mutual request (open until 24h after the lesson ends) that refunds in full.
 * Which reasons are reliability-neutral is deliberately not shown, so the reason picked can't be
 * tuned to the score; coaches only get a broad "may affect your reliability score" warning.
 */
import { formatBookingWhenInZone, formatRemainingUntil } from '../utils/datetime.js';

export const FULL_REFUND_CUTOFF_HOURS = 24;

const WEATHER_REQUEST_STATUSES = ['confirmed', 'awaiting_verification'];
const HOUR_MS = 60 * 60 * 1000;

export const STUDENT_WEATHER_POLICY_LINE =
  'Bad weather within 24 hours of the lesson? Send your coach a weather cancellation request — you can until 24 hours after the lesson ends. If they agree, you get a full refund.';

export const WEATHER_TIMING_POLICY_LINE =
  'Weather cancellations are available up to 24 hours before the lesson. Inside 24 hours, both sides must agree to a weather cancellation.';

export const COACH_WEATHER_POLICY_LINE =
  'Bad weather within 24 hours of the lesson? You or the student can ask to cancel for weather, until 24 hours after the lesson ends. If the other person agrees, the student gets a full refund and you aren’t paid.';

export function studentCancellationPolicyLines() {
  return [
    'Until your coach accepts, you can cancel for free — your card is only authorized.',
    'After your coach accepts, cancel at least 24 hours before the lesson for a full refund.',
    'Cancellations less than 24 hours before the lesson receive a 50% refund.',
    WEATHER_TIMING_POLICY_LINE,
    STUDENT_WEATHER_POLICY_LINE,
    'If your coach cancels, you get a full refund.',
    'If you don’t show up, your payment isn’t automatically refunded and your reliability score is affected.',
  ];
}

export function coachCancellationPolicyLines() {
  return [
    'If you decline a request, the student’s card authorization is released and they aren’t charged.',
    'If you cancel an accepted lesson, the student gets a full refund and you aren’t paid for it.',
    'If the student cancels less than 24 hours before the lesson, they get 50% back and you’re paid your share of the rest.',
    WEATHER_TIMING_POLICY_LINE,
    COACH_WEATHER_POLICY_LINE,
    'If the student doesn’t show up, mark Student no-show after the lesson. Their payment isn’t automatically refunded.',
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

/** When a weather request can no longer be made or accepted: 24h after the lesson ends. */
export function weatherRequestClosesAtMs(booking) {
  for (const iso of [booking?.weather_cancellation?.closes_at, booking?.financial_review?.review_until]) {
    const t = iso ? new Date(iso).getTime() : NaN;
    if (Number.isFinite(t)) return t;
  }
  const start = booking?.scheduled_at ? new Date(booking.scheduled_at).getTime() : NaN;
  if (!Number.isFinite(start)) return NaN;
  return start + (Number(booking.duration_minutes) || 0) * 60 * 1000 + 24 * HOUR_MS;
}

function weatherRequestWindowOpen(booking, now) {
  if (!WEATHER_REQUEST_STATUSES.includes(booking?.status)) return false;
  const closes = weatherRequestClosesAtMs(booking);
  return Number.isFinite(closes) && now < closes;
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
        body: 'If you accept and later cancel, the student gets a full refund and you aren’t paid.',
      };
    }
    return {
      headline: 'If you need to cancel',
      body: 'The student gets a full refund and you aren’t paid.',
    };
  }

  if (booking.status === 'pending') {
    return {
      headline: 'Free to cancel — you haven’t been charged',
      body: late
        ? 'Once your coach accepts, cancellations receive a 50% refund because the lesson is less than 24 hours away.'
        : `Once your coach accepts, you can still cancel for a full refund until ${when}. After that, cancellations receive a 50% refund.`,
    };
  }

  if (late) {
    return {
      headline: 'Cancelling now refunds 50%',
      body: `The full-refund deadline was ${when}. If it’s because of bad weather, send your coach a weather cancellation request instead — if they agree, you get a full refund.`,
    };
  }
  return {
    headline: `Full refund until ${when}`,
    body: `${formatRemainingUntil(deadline, new Date(now))} left. After that, cancellations receive a 50% refund.`,
  };
}

export const WEATHER_ACTION_NEEDED_LABEL = 'Action needed — Weather cancellation request';

/**
 * The other participant asked to cancel for weather and this viewer hasn't answered yet.
 * List rows carry `pending_weather_request`; booking detail carries `weather_cancellation`.
 */
export function weatherRequestAwaitsResponse(booking, audience, now = Date.now()) {
  if (audience !== 'coach' && audience !== 'student') return false;
  if (!weatherRequestWindowOpen(booking, now)) return false;
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
  if (!block || !weatherRequestWindowOpen(booking, now)) return null;
  const start = new Date(booking.scheduled_at).getTime();
  const started = now >= start;

  const other = otherPartyName(booking, audience);
  const otherShort = audience === 'coach' ? 'the student' : 'your coach';
  const closesLabel = formatBookingWhenInZone(new Date(weatherRequestClosesAtMs(booking)).toISOString(), tz);
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
      body: started
        ? `If you agree, the lesson is cancelled and ${refundForViewer}. If you don’t, the lesson stands. Respond by ${closesLabel}.`
        : `If you agree, the lesson is cancelled and ${refundForViewer}. If you’d rather play, keep the lesson. Respond by ${closesLabel}.`,
      note: req.note || null,
    };
  }
  if (req?.status === 'pending' && req.requested_by_me) {
    return {
      kind: 'waiting',
      prominent: true,
      requestId: req.id,
      title: 'Weather cancellation requested',
      body: `Waiting for ${otherShort} to respond. If they agree, ${refundForViewer}. The request stays open until ${closesLabel}, 24 hours after the lesson ends.`,
      note: req.note || null,
    };
  }
  if (req?.status === 'declined') {
    let body = started ? 'The lesson isn’t cancelled.' : 'The lesson is still on.';
    if (!req.requested_by_me) body = `You declined the weather cancellation. ${body}`;
    else if (audience === 'coach' && !started) body += ' You can still cancel it yourself — the student gets a full refund.';
    return {
      kind: 'declined',
      prominent: true,
      title: req.requested_by_me ? `${other} declined your weather cancellation` : 'You kept the lesson',
      body,
    };
  }
  // More than 24h out a normal Weather cancel already refunds in full, so there is nothing to ask for.
  if (block.can_request && now >= start - FULL_REFUND_CUTOFF_HOURS * HOUR_MS) {
    return {
      kind: 'available',
      prominent: false,
      title: 'Bad weather?',
      body: started
        ? `If weather stopped the lesson, ask ${otherShort} to cancel for weather by ${closesLabel}. If they agree, ${refundForViewer}.`
        : `Ask ${otherShort} to cancel for weather. If they agree, ${refundForViewer}. If not, the lesson stays on.`,
    };
  }
  return null;
}

/** Booking changes only happen through the app; chat or text agreements don't count. */
export const IN_APP_BOOKING_CHANGES_LINE =
  'Cancellations, weather cancellations, attendance and issue reports only count when completed in PickleCoach. Agreements made in messages, by text, or elsewhere don’t change the booking. There is no reschedule option — to change the time, cancel and book a new slot.';

export const COACH_PENDING_IN_APP_STEP = {
  title: 'Keep booking changes in PickleCoach',
  body: 'Cancellations, weather cancellations and attendance only count when completed in PickleCoach. Agreements in messages or by text don’t change the booking.',
};

export const STAY_ON_PLATFORM_TITLE = 'Stay on PickleCoach';

export const STAY_ON_PLATFORM_BODY =
  'Keep communication, booking, and payment on PickleCoach. Off-platform arrangements aren’t permitted and may result in loss of platform protections and account restrictions.';

export const COACH_PENDING_STAY_ON_PLATFORM_STEP = { title: STAY_ON_PLATFORM_TITLE, body: STAY_ON_PLATFORM_BODY };

export const MESSAGES_STAY_ON_PLATFORM_NOTE =
  'Keep your lesson on PickleCoach. Don’t exchange payment information or arrange PickleCoach bookings outside the platform. '
  + 'Messages may be reviewed for safety, fraud prevention, and policy enforcement.';

export const MESSAGES_BOOKING_CHANGES_TITLE = 'Keep booking changes on the booking page';

export const MESSAGES_BOOKING_CHANGES_NOTE =
  'Agreeing here to cancel or change the lesson doesn’t update the booking. Use the booking page to cancel, ask to cancel for weather, or report an issue.';

/** No reschedule yet: same rule for both sides, with the action each one can actually take. */
export function rescheduleHint(booking, audience, now = Date.now()) {
  if (!['pending', 'confirmed'].includes(booking?.status) || lessonStarted(booking, now)) return null;
  const coach = audience === 'coach';
  if (booking.status === 'pending') {
    return coach
      ? 'There is no reschedule option. If the student needs a different time, decline this request and ask them to book a new slot.'
      : 'There is no reschedule option. If you need a different time, cancel this request (it’s free) and book a new slot.';
  }
  if (isWithinLateCancelWindow(booking, now)) {
    return coach
      ? 'There is no reschedule option. If you can’t make it, you can still cancel — the student gets a full refund. For bad weather, send a weather cancellation request so the student can agree to the cancellation.'
      : 'There is no reschedule option. You can cancel this booking for a 50% refund. For bad weather, send your coach a weather cancellation request — if they agree, you get a full refund.';
  }
  return coach
    ? 'There is no reschedule option. If the student needs a different time, cancel this booking and ask them to book a new slot.'
    : 'There is no reschedule option. To change the time, cancel this booking and book a new slot.';
}

function weatherNeedsAgreement(booking, now) {
  return booking?.status === 'confirmed' && isWithinLateCancelWindow(booking, now);
}

/** Same for both sides: Weather is a cancel reason until 24h before a confirmed lesson, then mutual only. */
export function cancelReasonsFor(reasons, booking, now = Date.now()) {
  return weatherNeedsAgreement(booking, now) ? reasons.filter((r) => r.value !== 'weather') : reasons;
}

export const COACH_CANCEL_RELIABILITY_WARNING =
  'Cancelling this booking may affect your reliability score. Please only cancel when necessary.';

export const COACH_LATE_CANCEL_WEATHER_LINE =
  'Weather cancellations must be handled through a weather cancellation request.';

export const STUDENT_LATE_CANCEL_WEATHER_HINT =
  'Bad weather? Send your coach a weather cancellation request instead. If they agree, you get a full refund.';

export function cancelWeatherHint(audience, booking, now = Date.now()) {
  if (booking?.status !== 'confirmed') return null;
  const late = weatherNeedsAgreement(booking, now);
  if (audience === 'coach') return late ? `${COACH_CANCEL_RELIABILITY_WARNING} ${COACH_LATE_CANCEL_WEATHER_LINE}` : COACH_CANCEL_RELIABILITY_WARNING;
  return late && !weatherRequestUsed(booking) ? STUDENT_LATE_CANCEL_WEATHER_HINT : null;
}

/** Each booking gets one weather request; once it's been sent, don't suggest sending another. */
function weatherRequestUsed(booking) {
  return Boolean(booking?.weather_cancellation?.request);
}

/** Cancel reasons are self-reported; say who sees them. */
export function cancelReasonSharedHint(audience) {
  const other = audience === 'coach' ? 'student' : 'coach';
  return `Select the reason that best describes your cancellation. It’s shared with your ${other}.`;
}
