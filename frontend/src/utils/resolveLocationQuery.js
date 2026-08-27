/**
 * Shared place lookup for Discover (Search button + dashboard ?q= handoff).
 * Returns a structured outcome — callers own React busy/error state.
 */
import { geoApi } from '../api/index.js';

/**
 * @param {string} q
 * @returns {Promise<
 *   | { status: 'resolved', location: { lat: number, lng: number, label: string, source: 'search' } }
 *   | { status: 'ambiguous', candidates: { lat: number, lng: number, label: string }[] }
 *   | { status: 'empty', message: string }
 *   | { status: 'invalid', message: string }
 * >}
 */
export async function resolveLocationQuery(q) {
  const trimmed = String(q || '').trim();
  if (trimmed.length < 2) {
    return {
      status: 'invalid',
      message: 'Enter a ZIP code, city and state (e.g. Davie, FL), or a street address.',
    };
  }

  const res = await geoApi.search({ q: trimmed, limit: 5 });
  const results = Array.isArray(res.data?.results) ? res.data.results : [];

  if (!results.length) {
    return {
      status: 'empty',
      message:
        res.message
        || 'No matching locations found. Try a ZIP, city with state (e.g. Weston, FL), or a full street address.',
    };
  }

  if (results.length === 1) {
    const result = results[0];
    return {
      status: 'resolved',
      location: {
        lat: result.lat,
        lng: result.lng,
        label: result.label,
        source: 'search',
      },
    };
  }

  return {
    status: 'ambiguous',
    candidates: results.map((r) => ({
      lat: r.lat,
      lng: r.lng,
      label: r.label,
    })),
  };
}
