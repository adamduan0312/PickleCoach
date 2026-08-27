/**
 * Browser geolocation helpers for Discover / student dashboard.
 * Never call getCurrentPosition unless permission is already granted
 * or the user explicitly clicked "Use my location".
 */

export const GEO_SESSION_KEY = 'pc_discover_geo';

/** Shown when the browser reports geolocation permission is blocked. */
export const LOCATION_ACCESS_OFF_TITLE = 'Location access is turned off';
export const LOCATION_ACCESS_OFF_DETAIL =
  'Enable location access for PickleCoach in your browser settings to find coaches near you, then try again.';

/** Helper under Use my location when permission has not been decided yet. */
export const LOCATION_ALLOW_HINT = 'Allow location access to find coaches near you.';

export function geolocationErrorMessage(err) {
  if (!err) return 'Could not get your location. Try searching a ZIP, city, or address instead.';
  switch (err.code) {
    case 1: // PERMISSION_DENIED
      return `${LOCATION_ACCESS_OFF_TITLE}. ${LOCATION_ACCESS_OFF_DETAIL}`;
    case 2: // POSITION_UNAVAILABLE
      return 'Your device could not determine a location. Try searching by ZIP, city, or address.';
    case 3: // TIMEOUT
      return 'Location request timed out. Try again, or search by ZIP, city, or address.';
    default:
      return 'Could not get your location. Try searching a ZIP, city, or address instead.';
  }
}

/** True when getCurrentPosition failed because the user/browser blocked location. */
export function isGeolocationPermissionDenied(err) {
  return Boolean(err && Number(err.code) === 1);
}

/**
 * @returns {Promise<'granted'|'prompt'|'denied'|'unsupported'>}
 */
export async function queryGeolocationPermission() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  if (!navigator.permissions?.query) {
    // Safari often lacks Permissions API for geolocation — treat as prompt (don't auto-request).
    return 'prompt';
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

/**
 * @param {{ timeout?: number, maximumAge?: number }} [opts]
 * @returns {Promise<{ lat: number, lng: number, label: string, source: 'geolocation' }>}
 */
export function getBrowserPosition(opts = {}) {
  const { timeout = 15000, maximumAge = 60_000 } = opts;
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('unsupported'), { code: 0 }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: 'Your current location',
          source: 'geolocation',
        });
      },
      reject,
      { enableHighAccuracy: false, timeout, maximumAge },
    );
  });
}

/** @returns {{ lat: number, lng: number, label: string, source: string } | null} */
export function readSessionGeo() {
  try {
    const raw = sessionStorage.getItem(GEO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.lat == null || parsed?.lng == null) return null;
    const lat = Number(parsed.lat);
    const lng = Number(parsed.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      label: parsed.label || 'Your current location',
      source: parsed.source || 'geolocation',
    };
  } catch {
    return null;
  }
}

/** @param {{ lat: number, lng: number, label?: string, source?: string } | null} loc */
export function writeSessionGeo(loc) {
  try {
    if (!loc || loc.lat == null || loc.lng == null) {
      sessionStorage.removeItem(GEO_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(
      GEO_SESSION_KEY,
      JSON.stringify({
        lat: loc.lat,
        lng: loc.lng,
        label: loc.label || 'Your current location',
        source: loc.source || 'geolocation',
        savedAt: Date.now(),
      }),
    );
  } catch {
    // private mode / quota — ignore
  }
}

/**
 * If permission is already granted, fetch coordinates (no prompt).
 * Otherwise return null without prompting.
 */
export async function tryGetGrantedGeolocation() {
  const permission = await queryGeolocationPermission();
  if (permission !== 'granted') return null;
  try {
    const loc = await getBrowserPosition();
    writeSessionGeo(loc);
    return loc;
  } catch {
    return readSessionGeo();
  }
}
