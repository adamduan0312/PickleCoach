/**
 * Geocoding abstraction for Discover location search.
 * Default provider: OpenStreetMap Nominatim (no API key).
 *
 * Nominatim usage policy: identify the app; ≤1 request/second.
 */
import { logger } from '../config/logger.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT =
  process.env.GEOCODING_USER_AGENT
  || `PickleCoach/${process.env.npm_package_version || '1.0'} (${process.env.GEOCODING_CONTACT_EMAIL || 'dev@picklecoach.local'})`;

const US_STATE_ALIASES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

const US_STATE_CODES = new Set(Object.values(US_STATE_ALIASES));

let lastNominatimAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function respectNominatimRateLimit() {
  const elapsed = Date.now() - lastNominatimAt;
  if (elapsed < 1100) {
    await sleep(1100 - elapsed);
  }
  lastNominatimAt = Date.now();
}

/**
 * Settlement / locality name — prefer city-like fields over county.
 * Many FL towns (Davie, Weston) are tagged as suburb in OSM, not city.
 * @param {object} address
 * @returns {string|null}
 */
export function settlementName(address) {
  if (!address || typeof address !== 'object') return null;
  return (
    address.city
    || address.town
    || address.village
    || address.hamlet
    || address.municipality
    || address.suburb
    || address.neighbourhood
    || address.city_district
    || null
  );
}

/**
 * Build a short human-readable label from Nominatim address parts + display_name.
 * @param {object} hit
 * @returns {string}
 */
export function formatGeocodeLabel(hit) {
  if (!hit || typeof hit !== 'object') return '';
  const a = hit.address && typeof hit.address === 'object' ? hit.address : {};
  const place = settlementName(a);
  const county = a.county || null;
  const state = a.state || null;
  const zip = a.postcode || null;

  // ZIP centroids: always lead with the ZIP + locality when known.
  if (hit.type === 'postcode' && zip) {
    return [zip, place, !place ? county : null, state].filter(Boolean).join(', ');
  }

  const parts = [];
  if (a.road && a.house_number) parts.push(`${a.house_number} ${a.road}`);
  else if (a.road) parts.push(a.road);

  if (place) parts.push(place);
  else if (county) parts.push(county);

  if (state) parts.push(state);
  if (zip) parts.push(zip);

  if (parts.length >= 2) return parts.join(', ');
  if (typeof hit.display_name === 'string' && hit.display_name.trim()) {
    return hit.display_name.split(',').slice(0, 4).map((s) => s.trim()).join(', ');
  }
  return parts[0] || '';
}

/**
 * True when the hit is mainly a county/admin boundary with no city-like name.
 * @param {object} hit
 */
export function isCountyOnlyHit(hit) {
  const a = hit?.address && typeof hit.address === 'object' ? hit.address : {};
  if (settlementName(a)) return false;
  if (!a.county) return false;
  const type = String(hit?.type || '');
  const cls = String(hit?.class || '');
  return type === 'administrative' || cls === 'boundary' || /county/i.test(String(a.county));
}

/**
 * Prefer inhabited places / postcodes over same-named counties.
 * @param {object} hit
 * @param {{ preferPostcode?: boolean }} [ctx]
 */
export function rankGeocodeHit(hit, ctx = {}) {
  let score = Number(hit?.importance) || 0;
  const a = hit?.address && typeof hit.address === 'object' ? hit.address : {};
  if (settlementName(a)) score += 5;
  if (hit?.type === 'postcode' || hit?.class === 'place' && hit?.type === 'postcode') score += ctx.preferPostcode ? 10 : 2;
  if (isCountyOnlyHit(hit)) score -= 8;
  if (hit?.type === 'administrative' && !settlementName(a)) score -= 4;
  return score;
}

/**
 * @param {unknown} raw
 * @param {{ preferPostcode?: boolean }} [ctx]
 * @returns {{ label: string, lat: number, lng: number, type: string|null }[]}
 */
export function mapNominatimResults(raw, ctx = {}) {
  if (!Array.isArray(raw)) return [];
  const scored = [];
  for (const hit of raw) {
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = formatGeocodeLabel(hit);
    if (!label) continue;
    scored.push({
      label,
      lat,
      lng,
      type: hit?.type || null,
      _score: rankGeocodeHit(hit, ctx),
    });
  }
  scored.sort((a, b) => b._score - a._score);
  return scored.map(({ label, lat, lng, type }) => ({ label, lat, lng, type }));
}

/**
 * Parse free-text into a Nominatim strategy.
 * @param {string} query
 * @returns {{
 *   kind: 'zip' | 'city_state' | 'address' | 'free',
 *   params: Record<string, string>,
 *   preferPostcode: boolean,
 * }}
 */
export function parseGeocodeQuery(query) {
  const q = String(query || '').trim().replace(/\s+/g, ' ');
  const zipMatch = q.match(/^(\d{5})(?:-(\d{4}))?$/);
  if (zipMatch) {
    return {
      kind: 'zip',
      preferPostcode: true,
      params: {
        postalcode: zipMatch[1],
        country: 'US',
        format: 'json',
        addressdetails: '1',
      },
    };
  }

  // Street / full address → unrestricted free-form (never featureType=settlement).
  const looksLikeAddress = (
    /^\d+\s+\S/.test(q) // "123 Main…"
    || /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|hwy|highway|pkwy|parkway)\b/i.test(q)
  );
  if (looksLikeAddress) {
    return {
      kind: 'address',
      preferPostcode: false,
      params: {
        q,
        format: 'json',
        addressdetails: '1',
        countrycodes: 'us',
      },
    };
  }

  // "Davie, FL" / "Davie FL" / "Weston, Florida" — city/town only (no street tokens).
  const cityState = q.match(/^([^,]+?)[,\s]+([A-Za-z]{2}|[A-Za-z][A-Za-z\s]+)$/);
  if (cityState) {
    const city = cityState[1].trim();
    const stateRaw = cityState[2].trim();
    const stateLower = stateRaw.toLowerCase();
    const stateCode = stateRaw.length === 2
      ? stateRaw.toUpperCase()
      : US_STATE_ALIASES[stateLower] || null;
    const stateOk = stateCode && US_STATE_CODES.has(stateCode);
    const stateName = stateOk
      ? (Object.keys(US_STATE_ALIASES).find((k) => US_STATE_ALIASES[k] === stateCode) || stateRaw)
      : null;
    if (city && stateOk && !/^\d+$/.test(city) && !/,/.test(city)) {
      return {
        kind: 'city_state',
        preferPostcode: false,
        params: {
          city,
          state: stateName || stateCode,
          country: 'US',
          format: 'json',
          addressdetails: '1',
        },
      };
    }
  }

  // Bare place name (e.g. "davie") — bias to settlements, with unrestricted fallback.
  return {
    kind: 'free',
    preferPostcode: false,
    params: {
      q,
      format: 'json',
      addressdetails: '1',
      countrycodes: 'us',
      featureType: 'settlement',
    },
  };
}

async function nominatimFetch(params, signal) {
  await respectNominatimRateLimit();
  const url = `${NOMINATIM_URL}?${new URLSearchParams(params).toString()}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    logger.error('Geocode network error:', err);
    const e = new Error('Location search is temporarily unavailable. Try again in a moment.');
    e.code = 'GEOCODE_UNAVAILABLE';
    e.status = 503;
    throw e;
  }

  if (!res.ok) {
    logger.warn('Geocode provider HTTP %s', res.status);
    const e = new Error('Location search failed. Please try a different ZIP, city, or address.');
    e.code = 'GEOCODE_PROVIDER_ERROR';
    e.status = 502;
    throw e;
  }

  return res.json();
}

/**
 * Geocode a free-text query (ZIP, city, or address) to coordinates.
 * @param {string} query
 * @param {{ limit?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ label: string, lat: number, lng: number, type: string|null }[]>}
 */
export async function geocodeSearch(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 10);
  const parsed = parseGeocodeQuery(q);
  const params = { ...parsed.params, limit: String(limit) };

  // Structured queries use country=; free-form uses countrycodes=. Avoid both.
  if (params.country && params.countrycodes) delete params.countrycodes;

  let raw = await nominatimFetch(params, opts.signal);

  // featureType=settlement can miss some places — fall back to unrestricted free search.
  if ((!Array.isArray(raw) || raw.length === 0) && parsed.kind === 'free') {
    const { featureType, ...rest } = params;
    raw = await nominatimFetch(rest, opts.signal);
  }

  // Structured city/state miss → free-form with original query (keeps street addresses working).
  if ((!Array.isArray(raw) || raw.length === 0) && parsed.kind === 'city_state') {
    raw = await nominatimFetch({
      q,
      format: 'json',
      addressdetails: '1',
      countrycodes: 'us',
      limit: String(limit),
    }, opts.signal);
  }

  // Address miss is already free-form; nothing else to try.
  if ((!Array.isArray(raw) || raw.length === 0) && parsed.kind === 'address') {
    /* keep empty */
  }

  // ZIP structured miss → free-form ZIP.
  if ((!Array.isArray(raw) || raw.length === 0) && parsed.kind === 'zip') {
    raw = await nominatimFetch({
      q: parsed.params.postalcode,
      format: 'json',
      addressdetails: '1',
      countrycodes: 'us',
      limit: String(limit),
    }, opts.signal);
  }

  return mapNominatimResults(raw, { preferPostcode: parsed.preferPostcode });
}

/**
 * Normalize Nominatim state to 2-letter US code when possible.
 * @param {string|null|undefined} state
 * @returns {string|null}
 */
export function normalizeUsStateCode(state) {
  if (state == null || state === '') return null;
  const raw = String(state).trim();
  if (raw.length === 2 && US_STATE_CODES.has(raw.toUpperCase())) return raw.toUpperCase();
  const code = US_STATE_ALIASES[raw.toLowerCase()];
  return code || null;
}

/**
 * Map a Nominatim reverse/search hit to structured court address fields.
 * @param {object} hit
 * @returns {{ address_line1: string|null, city: string|null, state: string|null, postal_code: string|null, country: string }}
 */
export function structuredAddressFromNominatimHit(hit) {
  const a = hit?.address && typeof hit.address === 'object' ? hit.address : {};
  const street = [a.house_number, a.road || a.pedestrian || a.path || a.cycleway]
    .filter(Boolean)
    .join(' ')
    .trim();
  const address_line1 = (a.address_line || street || null);
  const city = settlementName(a);
  const state = normalizeUsStateCode(a.state);
  let postal_code = a.postcode ? String(a.postcode).trim() : null;
  if (postal_code && !/^\d{5}(-\d{4})?$/.test(postal_code)) {
    const m = postal_code.match(/\d{5}(-\d{4})?/);
    postal_code = m ? m[0] : null;
  }
  return {
    address_line1: address_line1 ? String(address_line1).slice(0, 255) : null,
    city: city ? String(city).slice(0, 100) : null,
    state,
    postal_code,
    country: 'US',
  };
}

/**
 * Reverse-geocode coordinates to a structured US address (Nominatim).
 * Respects the shared ≤1 req/sec Nominatim rate limit.
 *
 * Returns the Nominatim hit's own lat/lng so callers can verify the resolved
 * address pin is geographically close to the queried court coordinates
 * (park entrances a few hundred feet away are fine; multi-mile mismatches are not).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ address_line1: string|null, city: string|null, state: string|null, postal_code: string|null, country: string, label: string, latitude: number|null, longitude: number|null }|null>}
 */
export async function reverseGeocode(lat, lng, opts = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  await respectNominatimRateLimit();
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'json',
    addressdetails: '1',
    zoom: '18',
  });
  const url = `${NOMINATIM_REVERSE_URL}?${params.toString()}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: opts.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    logger.warn('Reverse geocode network error:', err.message);
    return null;
  }

  if (!res.ok) {
    logger.warn('Reverse geocode HTTP %s', res.status);
    return null;
  }

  const hit = await res.json();
  if (!hit || typeof hit !== 'object' || hit.error) return null;

  const structured = structuredAddressFromNominatimHit(hit);
  const label = formatGeocodeLabel(hit) || hit.display_name || null;
  const hitLat = hit.lat != null ? Number(hit.lat) : null;
  const hitLng = hit.lon != null ? Number(hit.lon) : null;
  return {
    ...structured,
    label,
    latitude: Number.isFinite(hitLat) ? hitLat : null,
    longitude: Number.isFinite(hitLng) ? hitLng : null,
  };
}
