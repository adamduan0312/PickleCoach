/**
 * Coach acceptance window for pending bookings.
 *
 * Rules (MVP):
 * - Students cannot request a lesson starting sooner than MIN_BOOKING_LEAD_HOURS (default 2).
 * - Coaches have at most COACH_ACCEPTANCE_TIMEOUT_HOURS (default 24) from the request to respond.
 * - Coaches must also accept at least MIN_BOOKING_LEAD_HOURS before lesson start.
 * - Effective deadline = earlier of (request + max window, lesson − lead time).
 */

export function getCoachAcceptanceTimeoutHours() {
  const raw =
    process.env.COACH_ACCEPTANCE_TIMEOUT_HOURS ??
    process.env.PENDING_BOOKING_EXPIRY_HOURS ??
    '24';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 24;
}

/** Minimum hours before lesson start for a new request, and for coach accept. */
export function getMinBookingLeadHours() {
  const raw = process.env.MIN_BOOKING_LEAD_HOURS ?? '2';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 2;
}

export function formatHourSpan(hours) {
  const n = Number.isFinite(Number(hours)) ? Math.max(0, Math.trunc(Number(hours))) : 24;
  if (n === 1) return '1 hour';
  return `${n} hours`;
}

/**
 * @param {{ requestAt: Date|string|number, scheduledAt: Date|string|number, maxHours?: number, leadHours?: number }} opts
 * @returns {Date}
 */
export function getCoachAcceptanceDeadlineAt({
  requestAt,
  scheduledAt,
  maxHours = getCoachAcceptanceTimeoutHours(),
  leadHours = getMinBookingLeadHours(),
}) {
  const requestMs = new Date(requestAt).getTime();
  const lessonMs = new Date(scheduledAt).getTime();
  if (!Number.isFinite(requestMs) || !Number.isFinite(lessonMs)) {
    throw new Error('Invalid requestAt or scheduledAt for acceptance deadline');
  }
  const fromRequest = requestMs + maxHours * 60 * 60 * 1000;
  const beforeLesson = lessonMs - leadHours * 60 * 60 * 1000;
  return new Date(Math.min(fromRequest, beforeLesson));
}

/**
 * True when the coach may still accept (now strictly before the deadline).
 */
export function isWithinCoachAcceptanceWindow({
  requestAt,
  scheduledAt,
  now = new Date(),
  maxHours = getCoachAcceptanceTimeoutHours(),
  leadHours = getMinBookingLeadHours(),
}) {
  const deadline = getCoachAcceptanceDeadlineAt({
    requestAt,
    scheduledAt,
    maxHours,
    leadHours,
  });
  return new Date(now).getTime() < deadline.getTime();
}

/**
 * Student may create a request only when lesson start is far enough in the future.
 * @returns {{ ok: true } | { ok: false, status: number, message: string, code: string }}
 */
export function assertMinBookingLeadTime(scheduledAt, now = new Date(), leadHours = getMinBookingLeadHours()) {
  const lessonMs = new Date(scheduledAt).getTime();
  if (!Number.isFinite(lessonMs)) {
    return { ok: false, status: 400, message: 'Invalid scheduled_at', code: 'invalid_scheduled_at' };
  }
  const earliest = new Date(now).getTime() + leadHours * 60 * 60 * 1000;
  if (lessonMs < earliest) {
    const span = formatHourSpan(leadHours);
    return {
      ok: false,
      status: 400,
      message:
        leadHours <= 0
          ? 'Cannot book in the past'
          : `Lessons must be booked at least ${span} in advance so the coach has time to accept.`,
      code: 'booking_too_soon',
    };
  }
  return { ok: true };
}

/**
 * Coach accept guard — deadline already passed.
 * @returns {{ ok: true } | { ok: false, status: number, message: string, code: string }}
 */
export function assertCoachMayAcceptPending(booking, now = new Date()) {
  if (!booking) {
    return { ok: false, status: 404, message: 'Booking not found', code: 'booking_not_found' };
  }
  if (!isWithinCoachAcceptanceWindow({
    requestAt: booking.created_at,
    scheduledAt: booking.scheduled_at,
    now,
  })) {
    return {
      ok: false,
      status: 400,
      message:
        'This booking request can no longer be accepted. The acceptance window has closed (24-hour request limit or too close to the lesson).',
      code: 'acceptance_window_closed',
    };
  }
  return { ok: true };
}

/** Email + booking-detail copy for coaches (deadline is the earlier of max window / lead before lesson). */
export function bookingRequestCoachTimeoutCopy(
  hours = getCoachAcceptanceTimeoutHours(),
  leadHours = getMinBookingLeadHours(),
) {
  const maxSpan = formatHourSpan(hours);
  const leadSpan = formatHourSpan(leadHours);
  if (leadHours <= 0) {
    return `Please accept or decline this request in PickleCoach within ${maxSpan} of this request. If you don’t respond, the request is cancelled automatically and the student’s payment authorization is released.`;
  }
  return `Please accept or decline this request in PickleCoach within ${maxSpan} of this request, and at least ${leadSpan} before the lesson starts (whichever comes first). If you don’t respond in time, the request is cancelled automatically and the student’s payment authorization is released.`;
}

/** Student-facing short policy for checkout / pending bookings. */
export function bookingRequestStudentAcceptanceCopy(
  hours = getCoachAcceptanceTimeoutHours(),
  leadHours = getMinBookingLeadHours(),
) {
  const maxSpan = formatHourSpan(hours);
  const leadSpan = formatHourSpan(leadHours);
  if (leadHours <= 0) {
    return `The coach has up to ${maxSpan} to accept your booking. If they don’t respond in time, the request is cancelled and your payment authorization is released.`;
  }
  return `The coach has up to ${maxSpan} to accept your booking, but must accept at least ${leadSpan} before the lesson starts (whichever comes first). If they don’t respond in time, the request is cancelled and your payment authorization is released.`;
}
