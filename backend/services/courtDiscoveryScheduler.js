/**
 * Background OSM court discovery for geographic GET /api/courts.
 *
 * The request returns local court_locations immediately; discovery (Overpass + rate-limited
 * Nominatim enrichment, potentially 20s+) runs afterwards so later searches see the imports.
 * An area is not rediscovered while a recent or running discovery already covers it.
 * State is per process (in memory); a restart simply allows the next search to rediscover.
 */
import { logger } from '../config/logger.js';
import { calculateDistance, discoverCourtsNearby } from './courtImportService.js';

const minutesEnv = (name, fallback) =>
  Math.max(0, Number.parseFloat(process.env[name] ?? String(fallback)) || 0) * 60000;

/** How long a successful discovery covers its area. */
export const DISCOVERY_COOLDOWN_MS = minutesEnv('COURT_DISCOVERY_COOLDOWN_MINUTES', 360);
/** How long to wait before retrying an area whose discovery failed (e.g. Overpass down). */
export const DISCOVERY_FAILURE_COOLDOWN_MS = minutesEnv('COURT_DISCOVERY_FAILURE_COOLDOWN_MINUTES', 10);

/**
 * Largest radius one background discovery covers, whatever radius the user searched. Overpass
 * names each court via a per-court facility lookup, so a 100-mile circle around a metro times out.
 */
export const DISCOVERY_MAX_RADIUS_MILES = Math.max(
  1,
  Number.parseFloat(process.env.COURT_DISCOVERY_MAX_RADIUS_MILES || '25') || 25,
);

/** GPS jitter between searches from the same spot should not trigger a new discovery. */
const COVERAGE_TOLERANCE_MILES = 0.5;
const MAX_REMEMBERED_AREAS = 500;

const covers = (area, lat, lng, radius) =>
  calculateDistance(area.lat, area.lng, lat, lng) + radius <= area.radius + COVERAGE_TOLERANCE_MILES;

/**
 * @param {{ discoverFn: Function, now?: () => number, cooldownMs?: number, failureCooldownMs?: number }} opts
 */
export function createCourtDiscoveryScheduler({
  discoverFn,
  now = () => Date.now(),
  cooldownMs = DISCOVERY_COOLDOWN_MS,
  failureCooldownMs = DISCOVERY_FAILURE_COOLDOWN_MS,
}) {
  let recent = [];
  const running = new Set();

  const remember = (area, ms, outcome) => {
    recent.push({ ...area, outcome, until: now() + ms });
    if (recent.length > MAX_REMEMBERED_AREAS) recent = recent.slice(-MAX_REMEMBERED_AREAS);
  };

  /**
   * `recent` = this area was checked successfully (even if nothing was found); `failed` = the last
   * attempt covering it failed and it is waiting out the failure cooldown before a retry.
   * @returns {{ status: 'started'|'running'|'recent'|'failed', promise?: Promise<void> }}
   *   `promise` (only when started) settles when discovery finishes; it never rejects.
   */
  function schedule(lat, lng, radius) {
    const t = now();
    recent = recent.filter((a) => a.until > t);
    const remembered = recent.filter((a) => covers(a, lat, lng, radius));
    if (remembered.some((a) => a.outcome === 'ok')) return { status: 'recent' };
    for (const a of running) {
      if (covers(a, lat, lng, radius)) return { status: 'running' };
    }
    if (remembered.length) return { status: 'failed' };

    const area = { lat, lng, radius };
    running.add(area);
    const promise = Promise.resolve()
      .then(() => discoverFn(lat, lng, radius))
      .then(() => remember(area, cooldownMs, 'ok'))
      .catch((err) => {
        remember(area, failureCooldownMs, 'failed');
        logger.warn(`Background court discovery failed for ${lat},${lng} r=${radius}: ${err?.message || err}`);
      })
      .finally(() => running.delete(area));
    return { status: 'started', promise };
  }

  return {
    schedule,
    reset() {
      recent = [];
      running.clear();
    },
  };
}

/** Process-wide scheduler used by the courts controller (tests may replace `schedule`). */
export const courtDiscovery = createCourtDiscoveryScheduler({
  discoverFn: (lat, lng, radius) => discoverCourtsNearby(lat, lng, radius),
});
