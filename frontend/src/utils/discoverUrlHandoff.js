/**
 * Module-level handoff so React Strict Mode remounts do not lose dashboard ?q= / ?lat=
 * after the first effect clears the URL, and do not fall through to "Near you".
 * Cleared when processing finishes or when visiting /discover with no URL intent.
 * @type {null | {
 *   q: string | null,
 *   lat: number | null,
 *   lng: number | null,
 *   label: string | null,
 *   done: boolean,
 *   resolvePromise: Promise<unknown> | null,
 * }}
 */
let discoverUrlHandoff = null;

/**
 * Capture URL params into a one-shot handoff (idempotent across Strict Mode remounts).
 * @param {URLSearchParams} searchParams
 */
export function captureDiscoverUrlHandoff(searchParams) {
  const qRaw = searchParams.get('q');
  const latRaw = searchParams.get('lat');
  const lngRaw = searchParams.get('lng');
  const label = searchParams.get('label');
  const lat = latRaw != null ? Number(latRaw) : NaN;
  const lng = lngRaw != null ? Number(lngRaw) : NaN;
  const q = qRaw && qRaw.trim().length >= 2 ? qRaw.trim() : null;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const hasUrlIntent = Boolean(q || hasCoords);

  if (hasUrlIntent) {
    // In-flight handoff from a remount after URL was already cleared — keep it.
    if (discoverUrlHandoff && !discoverUrlHandoff.done) return discoverUrlHandoff;
    discoverUrlHandoff = {
      q,
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      label: label && label.trim() ? label.trim() : null,
      done: false,
      resolvePromise: null,
    };
    return discoverUrlHandoff;
  }

  // No URL params: if a handoff is still in flight (URL cleared on first mount), keep it.
  if (discoverUrlHandoff && !discoverUrlHandoff.done) return discoverUrlHandoff;

  // Clean visit to /discover — allow Near you bootstrap.
  discoverUrlHandoff = null;
  return null;
}

/**
 * Run the q-resolution once; Strict Mode remounts share the same promise
 * so Nominatim /geo/search is not called twice.
 * @param {() => Promise<unknown>} runner
 */
export async function runDiscoverQHandoffOnce(runner) {
  if (!discoverUrlHandoff?.q) return null;
  if (!discoverUrlHandoff.resolvePromise) {
    discoverUrlHandoff.resolvePromise = Promise.resolve().then(runner);
  }
  return discoverUrlHandoff.resolvePromise;
}

export function markDiscoverUrlHandoffDone() {
  discoverUrlHandoff = null;
}

export function peekDiscoverUrlHandoff() {
  return discoverUrlHandoff;
}

/** Test helper */
export function resetDiscoverUrlHandoff() {
  discoverUrlHandoff = null;
}
