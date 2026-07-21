/**
 * Court address visibility — separate from discovery (`is_private`).
 *
 * MVP policy (no extra DB column):
 * - `is_private: false` → exact address always visible (already public places)
 * - `is_private: true` → exact address / GPS revealed **only on booking DTOs**,
 *   and only when that booking’s status is confirmed (or a later post-confirm
 *   status). Coach discovery surfaces (`GET /api/coaches/:id/courts`, marketplace
 *   coach cards) **always** redact private exact location — they have no booking
 *   context and must not unlock every private court because one booking is confirmed.
 * - Coaches and admins always see exact location.
 *
 * `is_private` remains a discovery flag only (public court directory). This module
 * controls when street address and coordinates are revealed on coach/booking DTOs.
 */

/** Booking statuses where students may see exact private-court location. */
export const PRIVATE_COURT_ADDRESS_REVEAL_STATUSES = Object.freeze([
  'confirmed',
  'awaiting_verification',
  'completed',
  'student_no_show',
  'coach_no_show',
  'disputed',
  // `cancelled` and `pending` omitted: pending never reveals; cancelled-from-pending
  // must not leak. Follow-up: `confirmed_at` to keep history after confirmed→cancelled.
]);

const REVEAL_SET = new Set(PRIVATE_COURT_ADDRESS_REVEAL_STATUSES);

/**
 * Coarse area label from a US-style address without exposing the street line.
 * "123 Oak Lane, Coral Springs, FL 33065" → "Coral Springs, FL 33065"
 * @param {string|null|undefined} address
 * @returns {string|null}
 */
export function approximateAreaFromAddress(address) {
  if (address == null || typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(1).join(', ');
  }
  return null;
}

/**
 * @param {{
 *   isPrivate?: boolean,
 *   bookingStatus?: string|null,
 *   viewerIsPrivileged?: boolean,
 * }} opts
 *   `viewerIsPrivileged` — coach on this booking, court owner coach viewing own list, or admin.
 */
export function shouldRevealPrivateCourtExactAddress({
  isPrivate = false,
  bookingStatus = null,
  viewerIsPrivileged = false,
} = {}) {
  if (!isPrivate) return true;
  if (viewerIsPrivileged) return true;
  if (bookingStatus == null || bookingStatus === '') return false;
  return REVEAL_SET.has(String(bookingStatus));
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Haversine miles (same formula as marketplace geo helpers).
 */
export function distanceMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Student/public discovery shape for a court (coach profile / marketplace card).
 * Private courts: redact address + coordinates; keep id/name/area/is_private;
 * optional server-computed distance when search origin is provided.
 *
 * @param {object|null|undefined} court
 * @param {{
 *   searchLat?: number|null,
 *   searchLng?: number|null,
 *   idKey?: 'id' | 'court_id',
 *   latKey?: 'latitude' | 'lat',
 *   lngKey?: 'longitude' | 'lng',
 *   includeId?: boolean,
 * }} [opts]
 */
export function serializeCourtForPublicViewer(court, opts = {}) {
  if (!court) return null;
  const plain = court?.toJSON ? court.toJSON() : { ...court };
  const isPrivate = Boolean(plain.is_private);
  const lat = toNum(plain.latitude ?? plain.lat);
  const lng = toNum(plain.longitude ?? plain.lng);
  const searchLat = toNum(opts.searchLat);
  const searchLng = toNum(opts.searchLng);
  const idKey = opts.idKey || 'id';
  const latKey = opts.latKey || 'latitude';
  const lngKey = opts.lngKey || 'longitude';

  let distance = null;
  if (
    searchLat != null &&
    searchLng != null &&
    lat != null &&
    lng != null
  ) {
    const d = distanceMiles(searchLat, searchLng, lat, lng);
    if (d != null) distance = Math.round(d * 10) / 10;
  }

  const base = {
    name: plain.name ?? null,
    is_private: isPrivate,
    area: approximateAreaFromAddress(plain.address),
  };
  if (opts.includeId !== false && plain.id != null) {
    base[idKey] = plain.id;
  } else if (opts.includeId !== false && plain.court_id != null) {
    base[idKey] = plain.court_id;
  }

  if (!isPrivate) {
    base.address = plain.address ?? null;
    base[latKey] = lat;
    base[lngKey] = lng;
    if (distance != null) base.distance_miles = distance;
    return base;
  }

  // Private: discovery-safe — no street / GPS on the wire
  base.address = null;
  base[latKey] = null;
  base[lngKey] = null;
  if (distance != null) base.distance_miles = distance;
  return base;
}

/**
 * Booking-embedded court summary (latitude/longitude field names).
 * @param {object|null|undefined} courtLocation
 * @param {{
 *   bookingStatus?: string|null,
 *   viewerIsPrivileged?: boolean,
 * }} [opts]
 */
export function serializeCourtLocationForBooking(courtLocation, opts = {}) {
  if (!courtLocation) return null;
  const plain = courtLocation?.toJSON ? courtLocation.toJSON() : { ...courtLocation };
  const isPrivate = Boolean(plain.is_private);
  const reveal = shouldRevealPrivateCourtExactAddress({
    isPrivate,
    bookingStatus: opts.bookingStatus,
    viewerIsPrivileged: Boolean(opts.viewerIsPrivileged),
  });

  const lat = toNum(plain.latitude);
  const lng = toNum(plain.longitude);
  const area = approximateAreaFromAddress(plain.address);

  if (reveal) {
    return {
      id: plain.id,
      name: plain.name ?? null,
      address: plain.address ?? null,
      latitude: lat,
      longitude: lng,
      is_private: isPrivate,
      area,
    };
  }

  return {
    id: plain.id,
    name: plain.name ?? null,
    address: null,
    latitude: null,
    longitude: null,
    is_private: isPrivate,
    area,
  };
}
