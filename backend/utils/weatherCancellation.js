/**
 * Mutual weather cancellation rules.
 *
 * Either participant may ask once per booking, from 24h before the lesson until the post-lesson
 * review window closes (lesson end + 24h), while the booking is confirmed or awaiting verification
 * and no dispute is open. The other participant accepts (full refund, no coach payout, no
 * reliability impact for either side) or declines (normal rules stay in place). Marking the lesson
 * completed or a no-show, opening a dispute, or the window closing ends an open request.
 */
import { getFinancialReviewUntil } from './financialReviewWindow.js';

export const WEATHER_REQUEST_WINDOW_HOURS = 24;

/** Booking statuses in which a weather request can be made or accepted. */
export const WEATHER_REQUEST_BOOKING_STATUSES = Object.freeze(['confirmed', 'awaiting_verification']);

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

/** When open requests expire and new ones stop: the end of the post-lesson review window. */
export function weatherRequestClosesAt(booking) {
  const until = getFinancialReviewUntil(booking);
  return until ? until.toISOString() : null;
}

function requestExpiresMs(row, booking) {
  const closes = weatherRequestClosesAt(booking);
  return new Date(closes ?? row.expires_at).getTime();
}

/**
 * Status after applying expiry / booking state; persisted `pending` can be stale.
 * @param {{ hasActiveDispute?: boolean }} [ctx]
 */
export function effectiveWeatherRequestStatus(row, booking, now = new Date(), { hasActiveDispute = false } = {}) {
  if (!row) return null;
  if (row.status !== 'pending') return row.status;
  if (booking && !WEATHER_REQUEST_BOOKING_STATUSES.includes(booking.status)) return 'closed';
  if (hasActiveDispute) return 'closed';
  if (now.getTime() >= requestExpiresMs(row, booking)) return 'expired';
  return 'pending';
}

/**
 * @param {{
 *   booking: object,
 *   requesterRole: 'student'|'coach',
 *   requests: object[],
 *   hasActiveDispute?: boolean,
 *   now?: Date,
 * }} args
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function weatherRequestEligibility({ booking, requesterRole, requests = [], hasActiveDispute = false, now = new Date() }) {
  if (!booking || !WEATHER_REQUEST_BOOKING_STATUSES.includes(booking.status)) {
    return { ok: false, code: 'weather_request_not_confirmed', message: 'Weather cancellation is only available for confirmed lessons.' };
  }
  const start = startMs(booking);
  const closes = weatherRequestClosesAt(booking);
  if (start == null || !closes || now.getTime() >= new Date(closes).getTime()) {
    return {
      ok: false,
      code: 'weather_request_window_closed',
      message: 'Weather cancellation closed 24 hours after the lesson ended.',
    };
  }
  if (now.getTime() < start - WEATHER_REQUEST_WINDOW_HOURS * HOUR_MS) {
    return {
      ok: false,
      code: 'weather_request_too_early',
      message: 'Weather cancellation requests open 24 hours before the lesson.',
    };
  }
  if (hasActiveDispute) {
    return {
      ok: false,
      code: 'weather_request_dispute_open',
      message: 'A dispute is open for this lesson. It will be resolved through the dispute instead.',
    };
  }
  const ctx = { hasActiveDispute };
  if (requests.some((r) => effectiveWeatherRequestStatus(r, booking, now, ctx) === 'pending')) {
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
 * @param {{ booking: object, viewerRole: 'student'|'coach'|null, hasActiveDispute?: boolean, now?: Date }} ctx
 */
export function serializeWeatherCancellation(requests, { booking, viewerRole, hasActiveDispute = false, now = new Date() }) {
  const rows = [...(requests || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id,
  );
  const latest = rows[0] || null;
  const status = effectiveWeatherRequestStatus(latest, booking, now, { hasActiveDispute });
  const eligibility = viewerRole
    ? weatherRequestEligibility({ booking, requesterRole: viewerRole, requests: rows, hasActiveDispute, now })
    : { ok: false, code: 'weather_request_not_participant' };

  return {
    opens_at: weatherRequestOpensAt(booking),
    closes_at: weatherRequestClosesAt(booking),
    can_request: eligibility.ok,
    request_unavailable_code: eligibility.ok ? null : eligibility.code,
    request: latest
      ? {
          id: latest.id,
          status,
          requested_by: latest.requested_by_role,
          requested_by_me: viewerRole != null && latest.requested_by_role === viewerRole,
          note: latest.note || null,
          expires_at: status === 'pending' ? weatherRequestClosesAt(booking) ?? latest.expires_at : latest.expires_at,
          created_at: latest.created_at,
          responded_at: latest.responded_at || null,
          cancellation_history_id: latest.cancellation_history_id || null,
          can_respond: status === 'pending' && viewerRole != null && latest.requested_by_role !== viewerRole,
          can_withdraw: status === 'pending' && viewerRole != null && latest.requested_by_role === viewerRole,
        }
      : null,
  };
}
