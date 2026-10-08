/**
 * Cancellation policy copy shown at decision points (checkout, accept, booking detail, cancel).
 *
 * Money follows who cancels and when (backend paymentEngine.computeCancellationSplitCents).
 * Students can't cancel a confirmed lesson inside 24h; weather then needs the coach to agree
 * (mutual request, open until 24h after the lesson ends).
 * Reliability consequences of cancelling or declining are deliberately not shown to students or
 * coaches, so the reason they pick can't be tuned to the score.
 */
import { formatBookingWhenInZone, formatRemainingUntil } from '../utils/datetime.js';

export const FULL_REFUND_CUTOFF_HOURS = 24;

const WEATHER_REQUEST_STATUSES = ['confirmed', 'awaiting_verification'];
const HOUR_MS = 60 * 60 * 1000;

export const STUDENT_WEATHER_POLICY_LINE =
  'Bad weather within 24 hours of the lesson? Ask your coach to cancel for weather — you can ask until 24 hours after the lesson ends. If they agree, you get a full refund.';

export const COACH_WEATHER_POLICY_LINE =
  'Bad weather within 24 hours of the lesson? You or the student can ask to cancel for weather, until 24 hours after the lesson ends. If the other person agrees, the student gets a full refund and you aren’t paid.';

export function studentCancellationPolicyLines() {
  return [
    'Until your coach accepts, you can cancel for free — your card is only authorized.',
    'After your coach accepts, you can cancel up to 24 hours before the lesson for a full refund.',
    'Less than 24 hours before the lesson, you can’t cancel it yourself.',
    STUDENT_WEATHER_POLICY_LINE,
    'If your coach cancels, you get a full refund.',
    'If you don’t show up, your payment isn’t automatically refunded and your reliability score is affected.',
  ];
}

export function coachCancellationPolicyLines() {
  return [
    'If you decline a request, the student’s card authorization is released and they aren’t charged.',
    'If you cancel an accepted lesson, the student gets a full refund and you aren’t paid for it.',
    'Students can cancel for a full refund up to 24 hours before the lesson. After that, they can’t cancel it themselves.',
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
        ? 'Once your coach accepts, you can’t cancel because the lesson is less than 24 hours away.'
        : `Once your coach accepts, you can still cancel for a full refund until ${when}. After that, you can’t cancel it yourself.`,
    };
  }

  if (late) {
    return {
      headline: 'This lesson can no longer be cancelled',
      body: `Cancelling closed at ${when}, 24 hours before the lesson. If it’s because of bad weather, ask your coach to cancel for weather — if they agree, you get a full refund.`,
    };
  }
  return {
    headline: `Full refund until ${when}`,
    body: `${formatRemainingUntil(deadline, new Date(now))} left. After that, you can’t cancel it yourself.`,
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

export const MESSAGES_BOOKING_CHANGES_NOTE =
  'Agreeing here to cancel or change the lesson doesn’t update the booking. Use the booking page to cancel, ask to cancel for weather, or report an issue.';

/**
 * No reschedule yet. Coaches decline pending requests; a confirmed lesson inside 24h can't be
 * cancelled by the student, so only weather (with the coach's agreement) remains.
 */
export function rescheduleHint(booking, audience, now = Date.now()) {
  if (!['pending', 'confirmed'].includes(booking?.status) || lessonStarted(booking, now)) return null;
  if (audience === 'coach' && booking.status === 'pending') {
    return 'There is no reschedule option. Decline this request and ask the student to book a new slot.';
  }
  if (audience === 'student' && booking.status === 'confirmed' && isWithinLateCancelWindow(booking, now)) {
    return 'There is no reschedule option, and this lesson is less than 24 hours away, so it can’t be cancelled. For bad weather, ask your coach to cancel for weather.';
  }
  return 'There is no reschedule option. To change the time, cancel this booking and book a new slot.';
}

/** Cancel reasons are self-reported; say who sees them. */
export function cancelReasonSharedHint(audience) {
  const other = audience === 'coach' ? 'student' : 'coach';
  return `Select the reason that best describes your cancellation. It’s shared with your ${other}.`;
}
