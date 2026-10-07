/**
 * Court DTO helpers. Every court is a shared physical location in the public directory, so its
 * full structured address and coordinates are always included.
 */

/**
 * Coarse area label from structured address fields (no street line).
 * "Coral Springs, FL 33065"
 * @param {{ city?: string|null, state?: string|null, postal_code?: string|null }|null|undefined} court
 * @returns {string|null}
 */
export function buildCourtArea(court) {
  if (court == null || typeof court !== 'object') return null;
  const city = court.city != null ? String(court.city).trim() : '';
  const state = court.state != null ? String(court.state).trim() : '';
  const postal = court.postal_code != null ? String(court.postal_code).trim() : '';
  if (!city || !state || !postal) return null;
  return `${city}, ${state} ${postal}`;
}

/**
 * Full single-line address from structured fields (for logs / display helpers).
 * @param {{
 *   address_line1?: string|null,
 *   city?: string|null,
 *   state?: string|null,
 *   postal_code?: string|null,
 * }|null|undefined} court
 * @returns {string|null}
 */
export function buildFullCourtAddress(court) {
  if (court == null || typeof court !== 'object') return null;
  const line1 = court.address_line1 != null ? String(court.address_line1).trim() : '';
  const area = buildCourtArea(court);
  if (!line1 || !area) return null;
  return `${line1}, ${area}`;
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

function structuredAddressFields(plain) {
  return {
    address_line1: plain.address_line1 ?? null,
    city: plain.city ?? null,
    state: plain.state ?? null,
    postal_code: plain.postal_code ?? null,
    country: plain.country ?? null,
    area: buildCourtArea(plain),
  };
}

/**
 * Student/public discovery shape for a court (coach profile / marketplace card), with optional
 * server-computed distance when a search origin is provided.
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
  const lat = toNum(plain.latitude ?? plain.lat);
  const lng = toNum(plain.longitude ?? plain.lng);
  const searchLat = toNum(opts.searchLat);
  const searchLng = toNum(opts.searchLng);
  const idKey = opts.idKey || 'id';
  const latKey = opts.latKey || 'latitude';
  const lngKey = opts.lngKey || 'longitude';

  const base = {
    name: plain.name ?? null,
    ...structuredAddressFields(plain),
  };
  if (opts.includeId !== false && plain.id != null) {
    base[idKey] = plain.id;
  } else if (opts.includeId !== false && plain.court_id != null) {
    base[idKey] = plain.court_id;
  }
  base[latKey] = lat;
  base[lngKey] = lng;

  if (searchLat != null && searchLng != null && lat != null && lng != null) {
    const d = distanceMiles(searchLat, searchLng, lat, lng);
    if (d != null) base.distance_miles = Math.round(d * 10) / 10;
  }
  return base;
}

/**
 * The court as it was when the booking was made: the booking's `court_*_at_booking`
 * snapshot when present, else the live court row (legacy bookings).
 *
 * @param {object|null|undefined} booking plain booking (snapshot columns)
 * @param {object|null|undefined} liveCourt associated CourtLocation (may be null)
 */
export function courtLocationAsBooked(booking, liveCourt) {
  const live = liveCourt?.toJSON ? liveCourt.toJSON() : liveCourt;
  if (!booking || booking.court_name_at_booking == null) return live ?? null;
  return {
    id: live?.id ?? booking.court_location_id ?? null,
    name: booking.court_name_at_booking,
    address_line1: booking.court_address_line1_at_booking ?? null,
    city: booking.court_city_at_booking ?? null,
    state: booking.court_state_at_booking ?? null,
    postal_code: booking.court_postal_code_at_booking ?? null,
    country: booking.court_country_at_booking ?? null,
    latitude: booking.court_latitude_at_booking ?? null,
    longitude: booking.court_longitude_at_booking ?? null,
  };
}

/**
 * Booking-embedded court summary (latitude/longitude field names).
 * @param {object|null|undefined} courtLocation
 */
export function serializeCourtLocationForBooking(courtLocation) {
  if (!courtLocation) return null;
  const plain = courtLocation?.toJSON ? courtLocation.toJSON() : { ...courtLocation };
  return {
    id: plain.id,
    name: plain.name ?? null,
    ...structuredAddressFields(plain),
    latitude: toNum(plain.latitude),
    longitude: toNum(plain.longitude),
  };
}
