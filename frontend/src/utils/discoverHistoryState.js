/**
 * Discover's search, saved per browser-history entry, so Back / Forward to a Discover entry shows the
 * same results — and scroll restoration has the same page to land on. A new visit starts clean.
 *
 * Entries are tagged with our own id in `history.state`: React Router keys the first entry of every
 * page load "default", so its key can't tell a typed-in /discover apart from Back to the first entry.
 */
const STORAGE_KEY = 'pc.discover.entries';
const MAX_ENTRIES = 20;
const ENTRY_FIELD = 'discoverEntry';

/** Id of the current history entry, if Discover tagged it. */
export function currentDiscoverEntryId(historyState = window.history.state) {
  const id = historyState?.[ENTRY_FIELD];
  return typeof id === 'string' && id ? id : null;
}

/** Tag the current history entry (keeping React Router's own fields) and return its id. */
export function ensureDiscoverEntryId() {
  const existing = currentDiscoverEntryId();
  if (existing) return existing;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    window.history.replaceState({ ...(window.history.state || {}), [ENTRY_FIELD]: id }, '');
  } catch {
    return null;
  }
  return id;
}

const FILTER_KEYS = ['rating_system', 'min_skill_rating', 'max_skill_rating', 'radius'];

function readAll() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    label: typeof loc.label === 'string' ? loc.label : 'Selected location',
    source: loc.source === 'geolocation' ? 'geolocation' : 'search',
  };
}

function cleanFilters(f) {
  const out = {};
  for (const k of FILTER_KEYS) out[k] = typeof f?.[k] === 'string' ? f[k] : '';
  return out;
}

/** @returns {null | { filters: object, applied: object, location: object|null, locationQuery: string }} */
export function readDiscoverEntry(entryKey) {
  if (!entryKey) return null;
  const hit = readAll().find(([k]) => k === entryKey);
  const saved = hit?.[1];
  if (!saved || typeof saved !== 'object') return null;
  const appliedLocation = cleanLocation(saved.applied?.location);
  // Nothing was searched yet — let the page run its normal first-visit setup.
  if (!appliedLocation) return null;
  return {
    filters: cleanFilters(saved.filters),
    applied: { ...cleanFilters(saved.applied), location: appliedLocation },
    location: cleanLocation(saved.location),
    locationQuery: typeof saved.locationQuery === 'string' ? saved.locationQuery : '',
  };
}

export function writeDiscoverEntry(entryKey, snapshot) {
  if (!entryKey) return;
  try {
    const rest = readAll().filter(([k]) => k !== entryKey);
    const next = [...rest, [entryKey, snapshot]].slice(-MAX_ENTRIES);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — Back just starts a fresh search */
  }
}
