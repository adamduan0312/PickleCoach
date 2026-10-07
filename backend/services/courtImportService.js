import { CourtLocation, OsmCourtImportAttempt } from '../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { reverseGeocode } from './geocodeService.js';

const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Max OSM elements to import per geographic discovery request.
 * Prefer closest-to-center when Overpass returns more than this (not arbitrary response order).
 * Override with COURT_DISCOVER_MAX_IMPORTS.
 */
export const DISCOVER_MAX_IMPORTS = Math.max(
  1,
  Number.parseInt(process.env.COURT_DISCOVER_MAX_IMPORTS || '100', 10) || 100,
);

/**
 * Max Nominatim reverse-geocode calls per discovery (rate-limited ~1/sec).
 * Incomplete OSM addresses are enriched for the closest candidates first.
 */
export const DISCOVER_MAX_REVERSE_GEOCODES = Math.max(
  0,
  Number.parseInt(process.env.COURT_DISCOVER_MAX_REVERSE_GEOCODES || '20', 10) || 20,
);

/**
 * Max miles between OSM court coordinates and the Nominatim reverse-hit pin.
 * Park entrances a few hundred feet away are fine; multi-mile mismatches are rejected.
 * Override with COURT_IMPORT_REVERSE_MAX_DISTANCE_MILES.
 */
export const REVERSE_GEOCODE_MAX_DISTANCE_MILES = Math.max(
  0.1,
  Number.parseFloat(process.env.COURT_IMPORT_REVERSE_MAX_DISTANCE_MILES || '1') || 1,
);

/**
 * Per-endpoint Overpass request timeout (the query itself allows the server 60s).
 * Discovery runs in the background, and the per-court facility lookup can take ~25s.
 */
export const OVERPASS_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.COURT_OVERPASS_TIMEOUT_MS || '60000', 10) || 60000,
);

/** Per-lookup Nominatim reverse-geocode timeout, excluding the shared rate-limit wait. */
export const REVERSE_GEOCODE_TIMEOUT_MS = Math.max(
  500,
  Number.parseInt(process.env.COURT_REVERSE_GEOCODE_TIMEOUT_MS || '8000', 10) || 8000,
);

/** Days before an OSM feature that could not be imported is looked up again. */
export const OSM_IMPORT_RETRY_AFTER_DAYS = Math.max(
  1,
  Number.parseInt(process.env.COURT_OSM_RETRY_AFTER_DAYS || '30', 10) || 30,
);

const osmKey = (osmType, osmId) => `${osmType}/${osmId}`;

/**
 * DB-backed record of OSM features that could not be imported. Failures to read or write are
 * logged and ignored — discovery must keep working without it.
 */
export const dbOsmImportAttemptStore = {
  async recentlyFailedKeys(candidates, now = new Date()) {
    if (!candidates.length) return new Set();
    const since = new Date(now.getTime() - OSM_IMPORT_RETRY_AFTER_DAYS * 86400000);
    try {
      const rows = await OsmCourtImportAttempt.findAll({
        where: {
          attempted_at: { [Op.gte]: since },
          [Op.or]: candidates.map((c) => ({ osm_type: c.osmType, osm_id: c.osmId })),
        },
        attributes: ['osm_type', 'osm_id'],
        raw: true,
      });
      return new Set(rows.map((r) => osmKey(r.osm_type, r.osm_id)));
    } catch (err) {
      logger.warn(`OSM import attempt lookup failed: ${err.message}`);
      return new Set();
    }
  },
  async recordFailure(candidate, outcome, now = new Date()) {
    try {
      await OsmCourtImportAttempt.upsert({
        osm_type: candidate.osmType,
        osm_id: candidate.osmId,
        outcome,
        attempted_at: now,
      });
    } catch (err) {
      logger.warn(`OSM import attempt record failed for ${osmKey(candidate.osmType, candidate.osmId)}: ${err.message}`);
    }
  },
};

/**
 * Calculate distance between two lat/lng points using Haversine formula
 * Returns distance in miles
 */
export const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Whether an OSM candidate should be skipped as a duplicate of an existing court.
 *
 * Rules:
 * - Same osm_type + osm_id → duplicate (primary identity for OSM imports).
 * - Same name within 0.25 mi → duplicate, whatever the OSM ids.
 * - Different OSM ids → otherwise never collapse solely due to proximity (distinct mapped features).
 *   Courts inside the same OSM facility are grouped separately, by facility identity
 *   (see importFromOpenStreetMap), not here.
 * - Proximity near a court with no OSM id (manual) → still treated as duplicate.
 */
export async function shouldSkipOsmCandidate({
  name,
  latitude,
  longitude,
  osmType,
  osmId,
}) {
  if (osmType != null && osmId != null) {
    const byOsm = await CourtLocation.findOne({
      where: {
        deleted_at: null,
        osm_type: osmType,
        osm_id: osmId,
      },
    });
    if (byOsm) return true;
  }

  if (latitude == null || longitude == null) return false;

  const nearbyCourts = await CourtLocation.findAll({
    where: {
      deleted_at: null,
      latitude: { [Op.between]: [latitude - 0.002, latitude + 0.002] },
      longitude: { [Op.between]: [longitude - 0.002, longitude + 0.002] },
    },
  });

  for (const court of nearbyCourts) {
    if (court.latitude == null || court.longitude == null) continue;
    const distance = calculateDistance(latitude, longitude, court.latitude, court.longitude);

    // Same name close by is the same listing to a coach, whatever the OSM ids.
    if (
      name &&
      court.name &&
      distance < 0.25 &&
      String(court.name).toLowerCase() === String(name).toLowerCase()
    ) {
      return true;
    }

    // Otherwise distinct OSM features stay distinct even when mapped close together.
    if (
      osmType != null &&
      osmId != null &&
      court.osm_type != null &&
      court.osm_id != null &&
      !(String(court.osm_type) === String(osmType) && String(court.osm_id) === String(osmId))
    ) {
      continue;
    }

    if (distance < 0.1) return true;
  }

  return false;
}

/** Names older imports generated for unnamed OSM features, e.g. "Pickleball Court (way/123)". */
const PLACEHOLDER_OSM_NAME = /^Pickleball Court \((node|way|relation|osm)\/\d+\)$/i;

/** "Pickleball Courts", "Court 3", "Pickleball" — names that can't tell one listing from another. */
const GENERIC_COURT_NAME = /^\s*(pickle\s*ball)?\s*(courts?|pitch(es)?)?\s*#?\d*\s*$/i;

export function isPlaceholderOsmCourtName(name) {
  return PLACEHOLDER_OSM_NAME.test(String(name ?? '').trim());
}

function meaningfulName(value) {
  const s = value == null ? '' : String(value).trim();
  if (!s || GENERIC_COURT_NAME.test(s) || isPlaceholderOsmCourtName(s)) return null;
  return s.slice(0, 255);
}

/**
 * Enclosing-facility kinds used to name an unnamed OSM court, most specific first.
 * Each entry is [tag key, values].
 */
const FACILITY_KINDS = [
  ['leisure', ['sports_centre']],
  ['leisure', ['recreation_ground', 'stadium']],
  ['leisure', ['park']],
  ['landuse', ['recreation_ground']],
  ['amenity', ['community_centre']],
  ['club', null],
  ['amenity', ['school', 'college', 'university']],
];

function facilityRank(tags = {}) {
  const i = FACILITY_KINDS.findIndex(([key, values]) => tags[key] != null && (!values || values.includes(tags[key])));
  return i === -1 ? null : i;
}

/**
 * Named facilities (parks, sports centres…) among a court's enclosing OSM areas, most specific first.
 * @param {{ key: string, tags: object }[]} areas
 * @returns {{ key: string, name: string }[]}
 */
export function enclosingFacilities(areas = []) {
  return areas
    .filter((a) => !a?.key?.startsWith('node/'))
    .map((a) => ({ key: a?.key, name: meaningfulName(a?.tags?.name), rank: facilityRank(a?.tags) }))
    .filter((a) => a.key && a.name && a.rank != null)
    .sort((a, b) => a.rank - b.rank)
    .filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i)
    .map(({ key, name }) => ({ key, name }));
}

/** Max distance from a court to a park mapped only as a point (no outline) for the park to name it. */
export const POINT_FACILITY_MAX_METERS = 120;

/**
 * Many parks (e.g. GNIS imports) are mapped as a single named node, which `is_in` can never match.
 * Such a park names a court with no enclosing facility only if it is the one named park point within
 * POINT_FACILITY_MAX_METERS and the court is not private. Parks with an outline are never used this
 * way: a court outside a mapped outline is outside that park.
 * @returns {{ key: string, name: string }|null}
 */
function pointFacility(tags = {}, areas = []) {
  if (['private', 'no'].includes(tags.access)) return null;
  const points = areas
    .filter((a) => a?.key?.startsWith('node/') && facilityRank(a.tags) != null)
    .map((a) => ({ key: a.key, name: meaningfulName(a.tags.name) }))
    .filter((a) => a.name);
  return new Set(points.map((p) => p.name)).size === 1 ? points[0] : null;
}

/** OSM facilities a court belongs to: enclosing areas, else a qualifying park point. */
export function courtFacilities(tags = {}, areas = []) {
  const enclosing = enclosingFacilities(areas);
  if (enclosing.length) return enclosing;
  const point = pointFacility(tags, areas);
  return point ? [point] : [];
}

/**
 * Listing name for an OSM court: its own name tag, else the enclosing park/facility name (or a
 * qualifying park point, see pointFacility).
 * Null when neither is meaningful — such courts are withheld from the directory, never given
 * a placeholder like "Pickleball Court (way/123)" or a generic "Pickleball Court".
 * `facilityKey` identifies the OSM facility a derived name came from.
 * @returns {{ name: string, source: 'osm'|'facility', facilityKey: string|null }|null}
 */
export function osmCourtName(tags = {}, facilityAreas = []) {
  const own = meaningfulName(tags.name) || meaningfulName(tags['name:en']);
  if (own) return { name: own, source: 'osm', facilityKey: null };
  const [facility] = courtFacilities(tags, facilityAreas);
  return facility ? { name: facility.name, source: 'facility', facilityKey: facility.key } : null;
}

/** Overpass area ids encode the source way/relation (2400000000 + way id, 3600000000 + relation id). */
export function osmFeatureKey(type, id) {
  const n = Number(id);
  if (type === 'area' && n >= 3600000000) return `relation/${n - 3600000000}`;
  if (type === 'area' && n >= 2400000000) return `way/${n - 2400000000}`;
  return `${type === 'rel' ? 'relation' : type}/${n}`;
}

/**
 * Best-effort structured address from OSM tags alone (may be incomplete).
 * Placeholders like Unknown / XX / 00000 / "OSM way/…" are NOT suitable for UI display.
 */
export function structuredAddressFromOsmTags(tags = {}, element = {}) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ').trim();
  const hasStreet = Boolean(tags['addr:full'] || street);
  const address_line1 = hasStreet
    ? String(tags['addr:full'] || street).slice(0, 255)
    : null;
  const city = (tags['addr:city'] || tags['addr:suburb'] || tags['addr:town'] || null);
  let state = tags['addr:state']
    ? String(tags['addr:state']).trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
    : null;
  if (state && state.length !== 2) state = null;
  let postal_code = tags['addr:postcode'] ? String(tags['addr:postcode']).trim() : null;
  if (postal_code && !/^\d{5}(-\d{4})?$/.test(postal_code)) postal_code = null;
  return {
    address_line1,
    city: city ? String(city).slice(0, 100) : null,
    state,
    postal_code,
    country: 'US',
  };
}

/** True when address is good enough to persist in court_locations / show to users. */
export function isHumanReadableCourtAddress(addr) {
  if (!addr) return false;
  const line = addr.address_line1 && String(addr.address_line1).trim();
  const city = addr.city && String(addr.city).trim();
  const state = addr.state && String(addr.state).trim();
  const zip = addr.postal_code && String(addr.postal_code).trim();
  if (
    !line
    || /^OSM\s/i.test(line)
    || line === 'Imported from OpenStreetMap'
    || line === 'Address pending verification'
  ) {
    return false;
  }
  if (!city || city === 'Unknown') return false;
  if (!state || state === 'XX' || state.length !== 2) return false;
  if (!zip || zip === '00000' || !/^\d{5}(-\d{4})?$/.test(zip)) return false;
  return true;
}

/**
 * Merge OSM tags with optional reverse-geocode fill for missing pieces.
 * OSM tag values win when present; reverse fills gaps only.
 * Does NOT invent placeholder values — incomplete fields stay null.
 */
export function mergeCourtAddress(osmAddress, reverseAddress) {
  return {
    address_line1: osmAddress?.address_line1 || reverseAddress?.address_line1 || null,
    city: osmAddress?.city || reverseAddress?.city || null,
    state: osmAddress?.state || reverseAddress?.state || null,
    postal_code: osmAddress?.postal_code || reverseAddress?.postal_code || null,
    country: 'US',
  };
}

/**
 * Whether a Nominatim reverse hit's pin is close enough to the OSM court
 * to trust as the same facility/area (entrance offset OK; multi-mile mismatch not).
 *
 * @param {number} courtLat
 * @param {number} courtLng
 * @param {{ latitude?: number|null, longitude?: number|null, lat?: number|null, lng?: number|null, lon?: number|null }} reverse
 * @param {number} [maxMiles]
 * @returns {boolean}
 */
export function isReverseGeocodePlausible(
  courtLat,
  courtLng,
  reverse,
  maxMiles = REVERSE_GEOCODE_MAX_DISTANCE_MILES,
) {
  if (courtLat == null || courtLng == null || !reverse) return false;
  const revLat = reverse.latitude ?? reverse.lat;
  const revLng = reverse.longitude ?? reverse.lng ?? reverse.lon;
  const lat = Number(revLat);
  const lng = Number(revLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const dist = calculateDistance(Number(courtLat), Number(courtLng), lat, lng);
  return dist <= maxMiles;
}

/**
 * Resolve a structured address for an OSM candidate.
 * Returns `complete: true` only when the merged address passes validation.
 * Never invents Unknown / XX / 00000 placeholders.
 *
 * Reverse-geocode results are discarded when their pin is materially distant
 * from the OSM court coordinates (see REVERSE_GEOCODE_MAX_DISTANCE_MILES).
 */
export async function resolveImportAddress({
  tags,
  element,
  latitude,
  longitude,
  reverseBudget,
  reverseGeocodeFn = reverseGeocode,
  reverseMaxDistanceMiles = REVERSE_GEOCODE_MAX_DISTANCE_MILES,
}) {
  const fromOsm = structuredAddressFromOsmTags(tags, element);
  if (isHumanReadableCourtAddress(fromOsm)) {
    return {
      address: mergeCourtAddress(fromOsm, null),
      complete: true,
      usedReverse: false,
      reverseRejectedDistant: false,
      reverseAnswered: false,
      reverseBudget,
    };
  }

  let reverse = null;
  let reverseRejectedDistant = false;
  let reverseAnswered = false;
  let reverseError = null;
  let budget = reverseBudget;
  if (budget > 0 && latitude != null && longitude != null) {
    try {
      budget -= 1;
      const raw = await reverseGeocodeFn(latitude, longitude, { timeoutMs: REVERSE_GEOCODE_TIMEOUT_MS });
      if (raw) {
        reverseAnswered = true;
        if (isReverseGeocodePlausible(latitude, longitude, raw, reverseMaxDistanceMiles)) {
          reverse = raw;
        } else {
          reverseRejectedDistant = true;
          const revLat = raw.latitude ?? raw.lat;
          const revLng = raw.longitude ?? raw.lng ?? raw.lon;
          const dist = (revLat != null && revLng != null)
            ? calculateDistance(latitude, longitude, Number(revLat), Number(revLng))
            : null;
          logger.info(
            `Discarding reverse geocode for ${latitude},${longitude}: pin too far`
            + (dist != null && Number.isFinite(dist) ? ` (${dist.toFixed(2)} mi)` : ' (missing coords)'),
          );
        }
      }
    } catch (err) {
      reverseError = err.code || 'GEOCODE_UNAVAILABLE';
      logger.warn(`Reverse geocode failed for ${latitude},${longitude}: ${err.message}`);
    }
  }

  const merged = mergeCourtAddress(fromOsm, reverse);
  return {
    address: merged,
    complete: isHumanReadableCourtAddress(merged),
    usedReverse: Boolean(reverse),
    reverseRejectedDistant,
    reverseAnswered,
    reverseError,
    reverseBudget: budget,
  };
}

function normalizeOsmElement(element, facilityAreas = []) {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat == null || lon == null) return null;
  if (element.id == null || !element.type) return null;
  return {
    osmType: String(element.type),
    osmId: Number(element.id),
    latitude: parseFloat(lat),
    longitude: parseFloat(lon),
    tags: element.tags || {},
    facilityAreas,
    element,
  };
}

/**
 * Overpass output from buildOsmFeaturesFacilityQuery is a stream of court elements (which carry
 * coordinates: `center` or `lat`), each followed by the tag-only facilities that enclose it.
 * Pair each court with those facilities (OSM key + tags).
 * @returns {{ element: object, facilityAreas: { key: string, tags: object }[] }[]}
 */
export function groupCourtsWithFacilities(elements = []) {
  const courts = [];
  for (const el of elements) {
    if (!el) continue;
    if (el.center || el.lat != null) {
      courts.push({ element: el, facilityAreas: [] });
    } else {
      courts.at(-1)?.facilityAreas.push({ key: osmFeatureKey(el.type, el.id), tags: el.tags || {} });
    }
  }
  return courts;
}

/**
 * POST an Overpass query, trying the next mirror only on connection errors, 5xx, or HTML error
 * pages. A timeout means the query is too heavy and a 429 means we are being throttled; another
 * mirror would just repeat the wait and add load, so both fail immediately.
 * @param {string} query
 * @param {{ fetchFn?: typeof fetch, endpoints?: string[] }} [opts]
 */
export function fetchOverpass(query, opts) {
  const request = overpassQueue.then(() => fetchOverpassNow(query, opts));
  overpassQueue = request.catch(() => {});
  return request;
}

/**
 * One Overpass request at a time per process: public servers give each IP only 2 query slots, and
 * concurrent discovery runs (different users, different areas) otherwise starve each other.
 */
let overpassQueue = Promise.resolve();

async function fetchOverpassNow(query, { fetchFn = fetch, endpoints = OVERPASS_ENDPOINTS } = {}) {
  let lastError;
  for (const endpoint of endpoints) {
    let response;
    try {
      response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'PickleCoach/1.0 (court-discover-nearby; https://picklecoach.local)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
    } catch (error) {
      logger.warn(`Overpass endpoint failed (${endpoint}): ${error.message}`);
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
      lastError = error;
      continue;
    }
    if (response.status === 429) {
      const error = Object.assign(
        new Error(`Overpass ${endpoint} HTTP 429 (rate-limited)`),
        { code: 'OVERPASS_RATE_LIMITED' },
      );
      logger.warn(error.message);
      throw error;
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      logger.warn(`Overpass endpoint failed (${endpoint}): ${error.message}`);
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
      lastError = error;
      continue;
    }
    if (!response.ok) {
      lastError = new Error(`Overpass ${endpoint} HTTP ${response.status}`);
      logger.warn(lastError.message);
      if (response.status < 500) throw lastError;
      continue;
    }
    if (text.trim().startsWith('<')) {
      lastError = new Error(`Overpass ${endpoint} returned HTML (rate-limited or blocked)`);
      logger.warn(lastError.message);
      continue;
    }
    return JSON.parse(text);
  }
  throw lastError || new Error('All Overpass endpoints failed');
}

/**
 * Overpass filters for named areas that can name an unnamed court (see FACILITY_KINDS).
 * Depending on the server version, `is_in` yields areas or the closed ways/relations themselves.
 */
const FACILITY_AREA_FILTERS = [
  '["leisure"~"^(sports_centre|recreation_ground|stadium|park)$"]',
  '["landuse"="recreation_ground"]',
  '["amenity"~"^(community_centre|school|college|university)$"]',
  '["club"]',
].flatMap((f) => ['area', 'way', 'rel'].map((t) => `${t}.a["name"]${f};`)).join(' ');

/**
 * Overpass body that outputs each court (with center) followed by the named facilities
 * (parks, sports centres, schools…) its nodes fall inside, and named park points nearby
 * (see pointFacility). Parse with groupCourtsWithFacilities.
 */
function courtsWithFacilitiesQuery(courtsStatement) {
  return `
    [out:json][timeout:60];
    ${courtsStatement}->.courts;
    foreach.courts->.c(
      .c out center tags;
      (node.c; node(w.c);)->.n;
      .n is_in->.a;
      (${FACILITY_AREA_FILTERS} node(around.c:${POINT_FACILITY_MAX_METERS})["name"]["leisure"~"^(sports_centre|recreation_ground|park)$"];);
      out tags;
    );
  `;
}

/** Courts per facility-lookup request; `is_in` costs roughly half a second per court on Overpass. */
export const FACILITY_LOOKUP_CHUNK_SIZE = 25;
/**
 * Overpass allows 2 query slots per IP, each cooling down for about as long as its query ran, so
 * back-to-back chunks get HTTP 429; busy servers also answer 504 for a while. Wait and retry the
 * chunk (at most this many times per run) instead of failing the run.
 */
const FACILITY_LOOKUP_RETRY_WAIT_MS = 30000;
const FACILITY_LOOKUP_MAX_RETRIES = 3;

/**
 * Step 1 of discovery: pickleball features (with center + tags only) in the bounding box of the
 * search circle. A bbox filter is far cheaper than `around:` at city scale (Seattle, 25 mi: ~5s vs
 * HTTP 504); callers drop features outside the circle. Facilities are looked up separately for
 * the nearest candidates only (buildOsmFeaturesFacilityQuery).
 */
export function buildPickleballOverpassQuery(latitude, longitude, radiusMiles) {
  const dLat = radiusMiles / 69;
  const dLng = radiusMiles / (69 * Math.max(Math.cos(latitude * Math.PI / 180), 0.01));
  const bbox = [latitude - dLat, longitude - dLng, latitude + dLat, longitude + dLng]
    .map((v) => v.toFixed(5))
    .join(',');
  return `[out:json][timeout:60];nwr["sport"="pickleball"](${bbox});out center tags;`;
}

/**
 * Step 2 of discovery: enclosing named facilities for the given candidates, FACILITY_LOOKUP_CHUNK_SIZE
 * courts per request, nearest first. Stops at the first failed request.
 * @returns {Promise<{ areasByKey: Map<string, object[]>, lookedUp: number, failed: boolean }>}
 */
async function lookUpFacilities(candidates, fetchOverpassFn, retryWaitMs = FACILITY_LOOKUP_RETRY_WAIT_MS) {
  const areasByKey = new Map();
  let lookedUp = 0;
  let waits = 0;
  for (let i = 0; i < candidates.length; i += FACILITY_LOOKUP_CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + FACILITY_LOOKUP_CHUNK_SIZE);
    const idsByType = {};
    for (const c of chunk) (idsByType[c.osmType] ||= []).push(c.osmId);
    try {
      const data = await fetchOverpassFn(buildOsmFeaturesFacilityQuery(idsByType));
      for (const { element, facilityAreas } of groupCourtsWithFacilities(data?.elements || [])) {
        areasByKey.set(osmKey(element.type, element.id), facilityAreas);
      }
      lookedUp += chunk.length;
    } catch (err) {
      if (waits < FACILITY_LOOKUP_MAX_RETRIES) {
        waits += 1;
        logger.warn(`OSM facility lookup retrying after ${lookedUp} of ${candidates.length} courts: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, retryWaitMs));
        i -= FACILITY_LOOKUP_CHUNK_SIZE;
        continue;
      }
      logger.warn(`OSM facility lookup failed after ${lookedUp} of ${candidates.length} courts: ${err.message}`);
      return { areasByKey, lookedUp, failed: true };
    }
  }
  return { areasByKey, lookedUp, failed: false };
}

/** Same output shape for specific OSM features, e.g. `{ way: [1, 2], node: [3] }`. */
export function buildOsmFeaturesFacilityQuery(idsByType) {
  const parts = Object.entries(idsByType)
    .filter(([, ids]) => ids?.length)
    .map(([type, ids]) => `${type}(id:${ids.join(',')});`);
  return courtsWithFacilitiesQuery(`(${parts.join(' ')})`);
}

/**
 * Import pickleball courts from OpenStreetMap via Overpass for one geographic search.
 *
 * Hard invariant: never create (or leave unaddressed) OSM rows with placeholder addresses.
 * Incomplete OSM tags → reverse geocode → if still incomplete → SKIP import.
 * Existing incomplete OSM rows are enriched on rediscovery when a valid address can be resolved.
 * Features whose reverse geocode answered but still gave no usable address are recorded and
 * skipped for OSM_IMPORT_RETRY_AFTER_DAYS; other courts at the same facility are skipped without
 * another lookup. A rate-limited or unavailable geocoder stops lookups for the run, and courts
 * not checked (that, or the lookup budget ran out) are `deferred` — not recorded.
 * Features with no meaningful name of their own or from an enclosing facility are not imported
 * (see osmCourtName); coaches can still add those courts manually. Unnamed courts inside an OSM
 * facility that already has a listing are grouped into it (groupedSameFacility).
 *
 * @returns {{ imported: object[], enriched: object[], skippedIncomplete: number, skippedRecentlyFailed: number, skippedUnnamed: number, groupedSameFacility: number, deferred: number, candidatesInRadius: number, facilityLookupFailed: boolean, geocoderError: string|null }}
 */
export async function importFromOpenStreetMap(
  latitude,
  longitude,
  radiusMiles,
  {
    fetchOverpassFn = fetchOverpass,
    maxImports = DISCOVER_MAX_IMPORTS,
    maxReverseGeocodes = DISCOVER_MAX_REVERSE_GEOCODES,
    reverseGeocodeFn = reverseGeocode,
    attemptStore = dbOsmImportAttemptStore,
    overpassRetryWaitMs,
  } = {},
) {
  const data = await fetchOverpassFn(buildPickleballOverpassQuery(latitude, longitude, radiusMiles));
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  const candidates = [];
  for (const element of elements) {
    const normalized = element && normalizeOsmElement(element);
    if (!normalized) continue;
    const dist = calculateDistance(
      latitude,
      longitude,
      normalized.latitude,
      normalized.longitude,
    );
    if (!(dist <= radiusMiles)) continue;
    candidates.push({ ...normalized, distanceMiles: dist });
  }

  candidates.sort((a, b) => a.distanceMiles - b.distanceMiles);
  const nearest = candidates.slice(0, maxImports);
  const facilities = await lookUpFacilities(nearest, fetchOverpassFn, overpassRetryWaitMs);
  // Courts whose facility lookup did not run are left for the next discovery run.
  const lookedUp = nearest.slice(0, facilities.lookedUp);
  for (const c of lookedUp) {
    c.facilityAreas = facilities.areasByKey.get(osmKey(c.osmType, c.osmId)) || [];
    c.named = osmCourtName(c.tags, c.facilityAreas);
  }
  // Courts with their own name first, so a facility's unnamed pitches group under that listing.
  const toImport = [
    ...lookedUp.filter((c) => c.named?.source === 'osm'),
    ...lookedUp.filter((c) => c.named?.source !== 'osm'),
  ];

  let reverseBudget = maxReverseGeocodes;
  const importedCourts = [];
  const enrichedCourts = [];
  let skippedIncomplete = 0;
  let skippedRecentlyFailed = 0;
  let skippedUnnamed = 0;
  let groupedSameFacility = 0;
  let deferred = nearest.length - lookedUp.length;
  // Set when Nominatim is rate-limiting or unavailable: no more lookups this run.
  let geocoderError = null;
  // Facilities whose reverse geocode answered without a usable address; their other courts share it.
  const facilitiesWithoutAddress = new Set();
  const recentlyFailed = await attemptStore.recentlyFailedKeys(toImport);

  // OSM facilities (park, sports centre…) that already have a listing. An unnamed court named
  // after one of these is another pitch at that facility, so it joins the listing instead of
  // becoming a second "<Park name>". Grouping is by OSM facility identity, never by distance.
  const listedFacilities = new Set();
  const markListed = (c) => courtFacilities(c.tags, c.facilityAreas).forEach((f) => listedFacilities.add(f.key));
  if (toImport.length) {
    const existingRows = await CourtLocation.findAll({
      where: {
        deleted_at: null,
        [Op.or]: toImport.map((c) => ({ osm_type: c.osmType, osm_id: c.osmId })),
      },
      attributes: ['osm_type', 'osm_id'],
    });
    const existingKeys = new Set(existingRows
      .filter((r) => r.osm_type != null && r.osm_id != null)
      .map((r) => osmKey(r.osm_type, r.osm_id)));
    toImport.filter((c) => existingKeys.has(osmKey(c.osmType, c.osmId))).forEach(markListed);
  }

  for (const candidate of toImport) {
    const { named } = candidate;
    const name = named?.name ?? null;

    const existingByOsm = await CourtLocation.findOne({
      where: {
        deleted_at: null,
        osm_type: candidate.osmType,
        osm_id: candidate.osmId,
      },
    });

    // Already complete — do not burn reverse-geocode budget.
    if (existingByOsm && isHumanReadableCourtAddress(existingByOsm)) {
      continue;
    }

    if (recentlyFailed.has(osmKey(candidate.osmType, candidate.osmId))) {
      skippedRecentlyFailed += 1;
      continue;
    }

    if (!existingByOsm) {
      // Unnamed and not inside a named facility: withhold rather than list an indistinguishable court.
      if (!name) {
        skippedUnnamed += 1;
        continue;
      }
      if (named.source === 'facility' && listedFacilities.has(named.facilityKey)) {
        groupedSameFacility += 1;
        continue;
      }
      const skipProximity = await shouldSkipOsmCandidate({
        name,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        osmType: candidate.osmType,
        osmId: candidate.osmId,
      });
      if (skipProximity) {
        markListed(candidate);
        continue;
      }
    }

    const facilityKey = named?.source === 'facility' ? named.facilityKey : null;
    const knownNoAddress = facilityKey && facilitiesWithoutAddress.has(facilityKey);
    const budgetBefore = geocoderError || knownNoAddress ? 0 : reverseBudget;
    const resolved = await resolveImportAddress({
      tags: candidate.tags,
      element: candidate.element,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      reverseBudget: budgetBefore,
      reverseGeocodeFn,
    });
    if (!geocoderError && !knownNoAddress) reverseBudget = resolved.reverseBudget;
    if (resolved.reverseError) geocoderError = resolved.reverseError;
    const lookupAnswered = !resolved.reverseError && resolved.reverseBudget < budgetBefore;
    if (!resolved.complete && resolved.reverseAnswered) {
      await attemptStore.recordFailure(candidate, 'incomplete_address');
      if (facilityKey) facilitiesWithoutAddress.add(facilityKey);
    }
    // Not checked this run (lookup budget spent, or geocoder rate-limited/unavailable): retry next run.
    if (!resolved.complete && !lookupAnswered && !knownNoAddress) {
      deferred += 1;
      continue;
    }

    if (existingByOsm) {
      // Incomplete existing OSM row: fill missing fields only when we now have a valid address.
      if (resolved.complete) {
        const patch = enrichmentPatchForExisting(existingByOsm, resolved.address);
        const plain = existingByOsm.get ? existingByOsm.get({ plain: true }) : existingByOsm;
        if (
          Object.keys(patch).length > 0
          && isHumanReadableCourtAddress({ ...plain, ...patch })
        ) {
          await existingByOsm.update(patch);
          enrichedCourts.push(existingByOsm);
        }
      }
      continue;
    }

    if (!resolved.complete) {
      skippedIncomplete += 1;
      logger.info(
        `Skipping OSM ${candidate.osmType}/${candidate.osmId}: incomplete address after reverse geocode`,
      );
      continue;
    }

    try {
      const court = await CourtLocation.create({
        name,
        ...resolved.address,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        is_private: false,
        created_by_user_id: null,
        source: 'api',
        osm_type: candidate.osmType,
        osm_id: candidate.osmId,
      });
      importedCourts.push(court);
      markListed(candidate);
    } catch (error) {
      logger.warn(`Failed to import court ${name}: ${error.message}`);
    }
  }

  return {
    imported: importedCourts,
    enriched: enrichedCourts,
    skippedIncomplete,
    skippedRecentlyFailed,
    skippedUnnamed,
    groupedSameFacility,
    deferred,
    candidatesInRadius: candidates.length,
    facilityLookupFailed: facilities.failed,
    geocoderError,
  };
}

/** Fill only placeholder/missing address fields on an existing row. */
export function enrichmentPatchForExisting(existing, resolvedAddress) {
  const patch = {};
  const cur = existing.get ? existing.get({ plain: true }) : existing;
  if (!isGoodAddressLine(cur.address_line1) && resolvedAddress.address_line1) {
    patch.address_line1 = resolvedAddress.address_line1;
  }
  if (!isGoodCity(cur.city) && resolvedAddress.city) {
    patch.city = resolvedAddress.city;
  }
  if (!isGoodState(cur.state) && resolvedAddress.state) {
    patch.state = resolvedAddress.state;
  }
  if (!isGoodPostal(cur.postal_code) && resolvedAddress.postal_code) {
    patch.postal_code = resolvedAddress.postal_code;
  }
  return patch;
}

function isGoodAddressLine(line) {
  const s = line && String(line).trim();
  return Boolean(
    s
    && !/^OSM\s/i.test(s)
    && s !== 'Imported from OpenStreetMap'
    && s !== 'Address pending verification',
  );
}
function isGoodCity(city) {
  const s = city && String(city).trim();
  return Boolean(s && s !== 'Unknown');
}
function isGoodState(state) {
  const s = state && String(state).trim();
  return Boolean(s && s !== 'XX' && s.length === 2);
}
function isGoodPostal(zip) {
  const s = zip && String(zip).trim();
  return Boolean(s && s !== '00000' && /^\d{5}(-\d{4})?$/.test(s));
}

/**
 * Discover OSM pickleball courts near a point and import any not already in court_locations.
 * Runs in the background for geographic GET /api/courts without `q` (see courtDiscoveryScheduler).
 *
 * Throws after importing what it could when the run was partial (facility lookup failed, or the
 * geocoder was rate-limited/unavailable), so the scheduler retries the area soon.
 *
 * @returns {Promise<object[]>} newly created rows only (enriched existing rows are applied in-place)
 */
export async function discoverCourtsNearby(latitude, longitude, radiusMiles = 10, opts = {}) {
  const area = `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)} r=${radiusMiles}mi`;
  logger.info(`Discovering nearby courts via OSM: ${area}`);
  const result = await importFromOpenStreetMap(latitude, longitude, radiusMiles, opts);
  logger.info(
    `OSM discovery ${area}: candidates=${result.candidatesInRadius} imported=${result.imported.length} `
    + `enriched=${result.enriched.length} grouped=${result.groupedSameFacility} `
    + `withheldUnnamed=${result.skippedUnnamed} withheldIncompleteAddress=${result.skippedIncomplete} `
    + `recentlyFailed=${result.skippedRecentlyFailed} deferred=${result.deferred}`
    + (result.facilityLookupFailed ? ' facilityLookup=failed' : '')
    + (result.geocoderError ? ` geocoder=${result.geocoderError}` : ''),
  );
  if (result.facilityLookupFailed || result.geocoderError) {
    throw new Error(
      `OSM discovery ${area} incomplete: `
      + (result.facilityLookupFailed ? 'facility lookup failed' : `geocoder ${result.geocoderError}`),
    );
  }
  return result.imported;
}

/** @deprecated Use discoverCourtsNearby — kept as alias during transition. */
export const lazyImportCourts = discoverCourtsNearby;
