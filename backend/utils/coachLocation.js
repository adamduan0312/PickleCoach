/**
 * Coach "Based in" location (`coach_profiles.location`).
 *
 * A real place at city level ("Davie, FL"), normalized from the geocoder. Independent of
 * teaching courts: not used for Discover, radius, or distance, and not required to be near a court.
 */
import { resolveCityLevelPlace } from '../services/geocodeService.js';

export const LOCATION_NOT_FOUND_MESSAGE =
  "We couldn't find that place. Enter a city and state (e.g. Davie, FL) or a ZIP code.";

/**
 * @param {{ location?: string|null }} input validated body
 * @param {{ location?: string|null }|null} [existing] stored profile
 * @param {{ resolvePlace?: (q: string) => Promise<string|null> }} [deps]
 * @returns {Promise<
 *   { ok: true, location: string|null, changed: boolean }
 *   | { ok: false, field: 'location', message: string }
 * >}
 * Geocoder outages throw (code GEOCODE_UNAVAILABLE / GEOCODE_PROVIDER_ERROR).
 */
export async function resolveCoachLocation(input = {}, existing = null, deps = {}) {
  const current = existing?.location ?? null;
  if (input.location === undefined) return { ok: true, location: current, changed: false };

  const text = String(input.location ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { ok: true, location: null, changed: current != null };
  if (current != null && text === String(current).trim()) {
    return { ok: true, location: current, changed: false };
  }

  const resolvePlace = deps.resolvePlace || resolveCityLevelPlace;
  const label = await resolvePlace(text);
  if (!label) return { ok: false, field: 'location', message: LOCATION_NOT_FOUND_MESSAGE };
  return { ok: true, location: label, changed: label !== current };
}
