import { CourtLocation } from '../models/index.js';
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
 * - Different OSM ids → never collapse solely due to proximity (distinct mapped features).
 * - Proximity / same-name near a court with no OSM id (manual) → still treated as duplicate.
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

    // Distinct OSM features stay distinct even when mapped close together.
    if (
      osmType != null &&
      osmId != null &&
      court.osm_type != null &&
      court.osm_id != null &&
      !(String(court.osm_type) === String(osmType) && String(court.osm_id) === String(osmId))
    ) {
      continue;
    }

    const distance = calculateDistance(latitude, longitude, court.latitude, court.longitude);
    if (distance < 0.1) return true;
    if (
      name &&
      court.name &&
      distance < 0.25 &&
      String(court.name).toLowerCase() === String(name).toLowerCase()
    ) {
      return true;
    }
  }

  return false;
}

function displayNameFromOsmTags(tags = {}, element = {}) {
  const tagged = tags.name || tags['name:en'] || tags.operator || tags.brand;
  if (tagged) return String(tagged).slice(0, 255);
  const ref = element.id != null ? `${element.type || 'osm'}/${element.id}` : `${Date.now()}`;
  return `Pickleball Court (${ref})`.slice(0, 255);
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
      reverseBudget,
    };
  }

  let reverse = null;
  let reverseRejectedDistant = false;
  let budget = reverseBudget;
  if (budget > 0 && latitude != null && longitude != null) {
    try {
      const raw = await reverseGeocodeFn(latitude, longitude);
      budget -= 1;
      if (raw) {
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
      logger.warn(`Reverse geocode failed for ${latitude},${longitude}: ${err.message}`);
    }
  }

  const merged = mergeCourtAddress(fromOsm, reverse);
  return {
    address: merged,
    complete: isHumanReadableCourtAddress(merged),
    usedReverse: Boolean(reverse),
    reverseRejectedDistant,
    reverseBudget: budget,
  };
}

function normalizeOsmElement(element) {
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
    element,
  };
}

export async function fetchOverpass(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'PickleCoach/1.0 (court-discover-nearby; https://picklecoach.local)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      const text = await response.text();
      if (!response.ok) {
        lastError = new Error(`Overpass ${endpoint} HTTP ${response.status}`);
        continue;
      }
      if (text.trim().startsWith('<')) {
        lastError = new Error(`Overpass ${endpoint} returned HTML (rate-limited or blocked)`);
        continue;
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      logger.warn(`Overpass endpoint failed (${endpoint}): ${error.message}`);
    }
  }
  throw lastError || new Error('All Overpass endpoints failed');
}

/**
 * Build Overpass query for pickleball features within radiusMiles of center.
 * Does not invent sample courts. Result size is constrained after fetch by
 * distance-sorted DISCOVER_MAX_IMPORTS (not arbitrary Overpass order).
 */
export function buildPickleballOverpassQuery(latitude, longitude, radiusMiles) {
  const radiusMeters = Math.round(radiusMiles * 1609.34);
  return `
    [out:json][timeout:25];
    (
      nwr["sport"="pickleball"](around:${radiusMeters},${latitude},${longitude});
    );
    out center tags;
  `;
}

/**
 * Import pickleball courts from OpenStreetMap via Overpass for one geographic search.
 *
 * Hard invariant: never create (or leave unaddressed) OSM rows with placeholder addresses.
 * Incomplete OSM tags → reverse geocode → if still incomplete → SKIP import.
 * Existing incomplete OSM rows are enriched on rediscovery when a valid address can be resolved.
 *
 * @returns {{ imported: object[], enriched: object[], skippedIncomplete: number }}
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
  } = {},
) {
  const data = await fetchOverpassFn(buildPickleballOverpassQuery(latitude, longitude, radiusMiles));
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  const candidates = [];
  for (const element of elements) {
    const normalized = normalizeOsmElement(element);
    if (!normalized) continue;
    const dist = calculateDistance(
      latitude,
      longitude,
      normalized.latitude,
      normalized.longitude,
    );
    candidates.push({ ...normalized, distanceMiles: dist });
  }

  candidates.sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
  const toImport = candidates.slice(0, maxImports);

  let reverseBudget = maxReverseGeocodes;
  const importedCourts = [];
  const enrichedCourts = [];
  let skippedIncomplete = 0;

  for (const candidate of toImport) {
    const name = displayNameFromOsmTags(candidate.tags, candidate.element);

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

    const resolved = await resolveImportAddress({
      tags: candidate.tags,
      element: candidate.element,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      reverseBudget,
      reverseGeocodeFn,
    });
    reverseBudget = resolved.reverseBudget;

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

    const skipProximity = await shouldSkipOsmCandidate({
      name,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      osmType: candidate.osmType,
      osmId: candidate.osmId,
    });
    if (skipProximity) continue;

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
    } catch (error) {
      logger.warn(`Failed to import court ${name}: ${error.message}`);
    }
  }

  return { imported: importedCourts, enriched: enrichedCourts, skippedIncomplete };
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
 * Called for every geographic GET /api/courts without `q` (local courts do not block this).
 *
 * @returns {Promise<object[]>} newly created rows only (enriched existing rows are applied in-place)
 */
export async function discoverCourtsNearby(latitude, longitude, radiusMiles = 10, opts = {}) {
  logger.info(
    `Discovering nearby courts via OSM: ${latitude}, ${longitude}, radius: ${radiusMiles} miles`,
  );
  const result = await importFromOpenStreetMap(latitude, longitude, radiusMiles, opts);
  logger.info(
    `OSM discovery: imported=${result.imported.length} enriched=${result.enriched.length} skippedIncomplete=${result.skippedIncomplete}`,
  );
  return result.imported;
}

/** @deprecated Use discoverCourtsNearby — kept as alias during transition. */
export const lazyImportCourts = discoverCourtsNearby;
