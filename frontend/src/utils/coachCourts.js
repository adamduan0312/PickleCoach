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

export const COURT_DISCOVERY_PENDING_NOTE =
  'Still checking OpenStreetMap for more courts in this area — search again in a minute to see any new ones.';

/**
 * Nearby search responses carry `discovery.status` while background OSM import runs.
 * @param {{ discovery?: { status?: string } } | null | undefined} res
 */
export function isCourtDiscoveryPending(res) {
  const status = res?.discovery?.status;
  return status === 'started' || status === 'running';
}
