/**
 * Helpers for coach ↔ court_locations link state in the Coach Courts UI.
 */

/**
 * Collect court_locations ids already linked via coach_court_locations.
 * @param {Array<{ court_id?: number, court?: { id?: number }, id?: number }>} links
 * @returns {Set<number>}
 */
export function linkedCourtIdSet(links) {
  const ids = new Set();
  for (const link of links || []) {
    const id = link?.court_id ?? link?.court?.id;
    if (id == null || id === '') continue;
    const n = Number(id);
    if (Number.isFinite(n)) ids.add(n);
  }
  return ids;
}

/**
 * @param {Set<number>} linkedIds
 * @param {{ id?: number } | null | undefined} court
 */
export function isCourtAlreadyLinked(linkedIds, court) {
  if (!linkedIds || court?.id == null) return false;
  const n = Number(court.id);
  return Number.isFinite(n) && linkedIds.has(n);
}

const US_STATE_CODES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '),
);

/** Google Plus Code, full or short (e.g. "3PGM+5JF"); geocoders cannot read them. */
const PLUS_CODE_RE = /(^|[\s,])[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}(?=$|[\s,])/gi;
const COUNTRY_RE = /^(us|usa|united states( of america)?)$/i;
const STREET_SUFFIX_RE = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|way|hwy|highway|pkwy|parkway|ter|terrace|pl|place|cir|circle|trl|trail)\.?$/i;
const VENUE_WORD_RE = /\b(park|courts?|center|centre|club|complex|rec|recreation|ymca|school|academy|facility|pickleball)\b/i;

function stripPlusCodes(text) {
  return String(text || '').replace(PLUS_CODE_RE, '$1').replace(/^[\s,]+|[\s,]+$/g, '');
}

/** Drop comma parts that repeat an earlier part ("Davie, FL 33328, Davie, FL, 33328"). */
function dedupeAddressParts(parts) {
  const kept = [];
  for (const part of parts) {
    const words = part.toLowerCase().split(' ');
    const repeats = kept.some((prev) => {
      const prevWords = new Set(prev.toLowerCase().split(' '));
      return words.every((w) => prevWords.has(w));
    });
    if (!repeats) kept.push(part);
  }
  return kept;
}

/** Readable label for a location query: no Plus Codes or repeated address parts. */
export function cleanLocationQuery(text) {
  const parts = stripPlusCodes(text).split(',').map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean);
  return dedupeAddressParts(parts).join(', ');
}

/**
 * Split a whole address pasted into the street field ("3PGM+5JF, 3801 S Pine Island Rd, Davie,
 * FL 33328") into form fields. Returns null when there is nothing to split.
 * @param {string} text
 * @returns {{ address_line1: string, city: string, state: string, postal_code: string } | null}
 */
export function splitPastedCourtAddress(text) {
  const raw = String(text || '');
  const stripped = stripPlusCodes(raw);
  const parts = stripped.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (parts.length < 2 && stripped === raw.trim()) return null;

  const [street = '', ...rest] = parts;
  const words = dedupeAddressParts(rest.filter((p) => !COUNTRY_RE.test(p)))
    .join(' ')
    .split(' ')
    .filter(Boolean);

  const zipIdx = words.findIndex((w) => /^\d{5}(-\d{4})?$/.test(w));
  let stateIdx = -1;
  words.forEach((w, i) => {
    if (US_STATE_CODES.has(w.replace(/\.$/, '').toUpperCase())) stateIdx = i;
  });
  const firstMarker = [zipIdx, stateIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const cityWords = firstMarker == null ? words : words.slice(0, firstMarker);

  return {
    address_line1: street,
    city: cityWords.join(' '),
    state: stateIdx >= 0 ? words[stateIdx].replace(/\.$/, '').toUpperCase() : '',
    postal_code: zipIdx >= 0 ? words[zipIdx].slice(0, 5) : '',
  };
}

/**
 * How to run Find a court text. Pattern-only, so court-name searches never wait on geocoding.
 * - 'location': ZIP, "City, ST", or street address → radius search around it.
 * - 'court': clearly a court/facility (venue words, digits, punctuation) → directory text search.
 * - 'place_or_court': a bare name like "Weston" or "Pine Island" → directory text search, then
 *   treated as a place only if directory courts have that city (see placeFromDirectoryMatches).
 * @param {string} query
 * @returns {'location' | 'court' | 'place_or_court'}
 */
export function classifyCourtSearch(query) {
  const q = stripPlusCodes(query).replace(/\s+/g, ' ');
  if (!q) return 'court';
  if (/^\d{5}(-\d{4})?$/.test(q)) return 'location';

  const [first, ...rest] = q.split(',').map((s) => s.trim());
  if (/^\d+\s+\S/.test(first) && (STREET_SUFFIX_RE.test(first) || rest.length > 0)) return 'location';

  const cityState = q.match(/^([A-Za-z][A-Za-z .'-]*?)(?:,\s*|\s+)([A-Za-z]{2})\.?(?:,?\s+\d{5}(?:-\d{4})?)?$/);
  if (cityState && US_STATE_CODES.has(cityState[2].toUpperCase()) && !VENUE_WORD_RE.test(cityState[1])) {
    return 'location';
  }
  if (/^[A-Za-z][A-Za-z .'-]*$/.test(q) && q.split(' ').length <= 3 && !VENUE_WORD_RE.test(q)) {
    return 'place_or_court';
  }
  return 'court';
}

/**
 * A bare query ("weston") is a place when directory courts list it as their city. Returns the
 * city as stored plus its most common state, or null.
 * @param {string} query
 * @param {Array<{ city?: string, state?: string }>} courts directory text-search results
 * @returns {{ city: string, state: string } | null}
 */
export function placeFromDirectoryMatches(query, courts) {
  const want = String(query || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!want) return null;
  const byState = new Map();
  let city = null;
  for (const c of courts || []) {
    if (String(c?.city || '').trim().replace(/\s+/g, ' ').toLowerCase() !== want) continue;
    const state = String(c.state || '').trim().toUpperCase();
    if (!US_STATE_CODES.has(state)) continue;
    city = city || String(c.city).trim();
    byState.set(state, (byState.get(state) || 0) + 1);
  }
  if (!city) return null;
  const [state] = [...byState.entries()].sort((a, b) => b[1] - a[1])[0];
  return { city, state };
}

/**
 * The geocode hit that is the city/town the user typed ("austin" → Austin, TX), or null.
 * Hits whose city-level `place` names a different town ("Tropical" → Alton, TX) don't count.
 * @param {string} query
 * @param {{ lat: number, lng: number, place?: string|null }[]} results geocode results, best first
 */
export function recognizedPlaceFromGeocode(query, results) {
  const want = String(query || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!want || !Array.isArray(results)) return null;
  return results.find((r) => r?.place && r.place.split(',')[0].trim().toLowerCase() === want) || null;
}

export const COURT_DISCOVERY_PENDING_EMPTY =
  'We’re checking this area for additional courts. Try searching again shortly.';

export const COURT_DISCOVERY_PENDING_NOTE =
  'Still checking OpenStreetMap for more courts in this area — search again in a minute to see any new ones.';

/**
 * Nearby search responses carry `discovery.status` while background OSM import runs. `apiRequest`
 * puts top-level fields other than `data` under `raw`.
 * @param {{ raw?: { discovery?: { status?: string } }, discovery?: { status?: string } } | null | undefined} res
 */
export function isCourtDiscoveryPending(res) {
  const status = (res?.raw?.discovery || res?.discovery)?.status;
  return status === 'started' || status === 'running';
}
