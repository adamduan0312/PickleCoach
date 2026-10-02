/**
 * Mutual weather cancellation rules.
 *
 * Either participant may ask once per booking, from 24h before the lesson until it starts, while
 * the booking is confirmed. The other participant accepts (full refund, no reliability impact for
 * either side) or declines (normal cancellation rules stay in place). Requests expire at lesson start.
 */

export const WEATHER_REQUEST_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

function startMs(booking) {
  const t = booking?.scheduled_at ? new Date(booking.scheduled_at).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

/** ISO time requests open (24h before the lesson). */
export function weatherRequestOpensAt(booking) {
  const start = startMs(booking);
  return start == null ? null : new Date(start - WEATHER_REQUEST_WINDOW_HOURS * HOUR_MS).toISOString();
}

/** Status after applying expiry / booking state; persisted `pending` can be stale. */
export function effectiveWeatherRequestStatus(row, booking, now = new Date()) {
  if (!row) return null;
  if (row.status !== 'pending') return row.status;
  if (booking && booking.status !== 'confirmed') return 'closed';
  if (now.getTime() >= new Date(row.expires_at).getTime()) return 'expired';
  return 'pending';
}

/**
 * @param {{ booking: object, requesterRole: 'student'|'coach', requests: object[], now?: Date }} args
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function weatherRequestEligibility({ booking, requesterRole, requests = [], now = new Date() }) {
  if (!booking || booking.status !== 'confirmed') {
    return { ok: false, code: 'weather_request_not_confirmed', message: 'Weather cancellation is only available for confirmed lessons.' };
  }
  const start = startMs(booking);
  if (start == null || now.getTime() >= start) {
    return { ok: false, code: 'weather_request_lesson_started', message: 'This lesson has already started.' };
  }
  if (now.getTime() < start - WEATHER_REQUEST_WINDOW_HOURS * HOUR_MS) {
    return {
      ok: false,
      code: 'weather_request_too_early',
      message: 'Weather cancellation requests open 24 hours before the lesson.',
    };
  }
  if (requests.some((r) => effectiveWeatherRequestStatus(r, booking, now) === 'pending')) {
    return { ok: false, code: 'weather_request_already_pending', message: 'A weather cancellation request is already waiting for a response.' };
  }
  if (requests.some((r) => r.requested_by_role === requesterRole)) {
    return { ok: false, code: 'weather_request_already_used', message: 'You’ve already sent a weather cancellation request for this lesson.' };
  }
  return { ok: true };
}

/**
 * Booking-detail block: the latest request (viewer-relative) and whether the viewer may ask.
 * @param {object[]} requests — rows for this booking (any order)
 * @param {{ booking: object, viewerRole: 'student'|'coach'|null, now?: Date }} ctx
 */
export function serializeWeatherCancellation(requests, { booking, viewerRole, now = new Date() }) {
  const rows = [...(requests || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id,
  );
  const latest = rows[0] || null;
  const status = effectiveWeatherRequestStatus(latest, booking, now);
  const eligibility = viewerRole
    ? weatherRequestEligibility({ booking, requesterRole: viewerRole, requests: rows, now })
    : { ok: false, code: 'weather_request_not_participant' };

  return {
    opens_at: weatherRequestOpensAt(booking),
    can_request: eligibility.ok,
    request_unavailable_code: eligibility.ok ? null : eligibility.code,
    request: latest
      ? {
          id: latest.id,
          status,
          requested_by: latest.requested_by_role,
          requested_by_me: viewerRole != null && latest.requested_by_role === viewerRole,
          note: latest.note || null,
          expires_at: latest.expires_at,
          created_at: latest.created_at,
          responded_at: latest.responded_at || null,
          cancellation_history_id: latest.cancellation_history_id || null,
          can_respond: status === 'pending' && viewerRole != null && latest.requested_by_role !== viewerRole,
          can_withdraw: status === 'pending' && viewerRole != null && latest.requested_by_role === viewerRole,
        }
      : null,
  };
}
