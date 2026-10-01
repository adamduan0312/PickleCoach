/**
 * Coach skill-rating rules — single source of truth for the backend.
 * Mirrored in frontend/src/domain/coachRating.js (parity is tested).
 *
 * DUPR and UTR-P are separate scales: never compare, convert, or rank their
 * numeric values against each other.
 */

export const COACH_RATING_SYSTEMS = Object.freeze({
  DUPR: Object.freeze({ value: 'DUPR', label: 'DUPR', min: 2, max: 8, decimals: 3 }),
  'UTR-P': Object.freeze({ value: 'UTR-P', label: 'UTR-P', min: 1, max: 10, decimals: 1 }),
});

export const COACH_RATING_SYSTEM_VALUES = Object.freeze(Object.keys(COACH_RATING_SYSTEMS));

export const RATING_SYSTEM_REQUIRED_MESSAGE = 'Select a rating system (DUPR or UTR-P) for your skill rating.';

export function ratingRules(ratingSystem) {
  return COACH_RATING_SYSTEMS[ratingSystem] || null;
}

/** Number of decimal places in the value as written (no rounding). */
export function ratingDecimalPlaces(value) {
  const s = String(value ?? '').trim();
  const m = /^\d+(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  return m[1] ? m[1].length : 0;
}

function formatBound(n, decimals) {
  return Number(n).toFixed(decimals);
}

/** e.g. "DUPR ratings must be between 2.000 and 8.000, with up to 3 decimal places." */
export function ratingRuleMessage(ratingSystem) {
  const r = ratingRules(ratingSystem);
  if (!r) return RATING_SYSTEM_REQUIRED_MESSAGE;
  const places = r.decimals === 1 ? '1 decimal place' : `${r.decimals} decimal places`;
  return `${r.label} ratings must be between ${formatBound(r.min, r.decimals)} and ${formatBound(r.max, r.decimals)}, with up to ${places}.`;
}

/**
 * @param {string|null|undefined} ratingSystem
 * @param {number|string} rating non-null rating
 * @returns {string|null} error message, or null when valid
 */
export function validateSkillRatingForSystem(ratingSystem, rating) {
  const r = ratingRules(ratingSystem);
  if (!r) return RATING_SYSTEM_REQUIRED_MESSAGE;
  const places = ratingDecimalPlaces(rating);
  const n = Number(rating);
  if (places == null || !Number.isFinite(n)) return ratingRuleMessage(ratingSystem);
  if (n < r.min || n > r.max || places > r.decimals) return ratingRuleMessage(ratingSystem);
  return null;
}

/**
 * Effective rating after a (possibly partial) create/update, validated as a pair.
 *
 * @param {{ rating_system?: string|null, skill_rating?: number|string|null }} input validated body
 * @param {{ rating_system?: string|null, skill_rating?: number|string|null }|null} [existing] stored profile
 * @returns {{ ok: true, rating_system: string|null, skill_rating: number|null }
 *   | { ok: false, field: 'rating_system'|'skill_rating', message: string }}
 */
export function resolveCoachRating(input = {}, existing = null) {
  const system = input.rating_system !== undefined ? input.rating_system : (existing?.rating_system ?? null);
  // Stored DECIMAL(5,3) reads back padded ("9.500"); compare by numeric value, not column scale.
  const storedRating = existing?.skill_rating != null ? Number(existing.skill_rating) : null;
  const rawRating = input.skill_rating !== undefined ? input.skill_rating : storedRating;
  const rating = rawRating == null || rawRating === '' ? null : rawRating;

  if (system != null && !ratingRules(system)) {
    return { ok: false, field: 'rating_system', message: 'Rating system must be DUPR or UTR-P.' };
  }
  if (rating == null) {
    return { ok: true, rating_system: system, skill_rating: null };
  }
  if (system == null) {
    return { ok: false, field: 'rating_system', message: RATING_SYSTEM_REQUIRED_MESSAGE };
  }

  const error = validateSkillRatingForSystem(system, rating);
  if (error) {
    const ratingFromExisting = input.skill_rating === undefined;
    return {
      ok: false,
      field: 'skill_rating',
      message: ratingFromExisting
        ? `Your current rating (${Number(rating)}) isn't a valid ${system} rating. ${error}`
        : error,
    };
  }
  return { ok: true, rating_system: system, skill_rating: Number(rating) };
}

/**
 * Skill distance for Discover ranking — only between the same rating system.
 * Coaches on another system (or unrated) are never numerically compared.
 */
export function sameSystemSkillDistance(coach, { ratingSystem, minSkill = null, maxSkill = null } = {}) {
  if (!ratingSystem || coach?.rating_system !== ratingSystem) return Number.POSITIVE_INFINITY;
  const skill = Number(coach?.skill_rating);
  if (coach?.skill_rating == null || !Number.isFinite(skill)) return Number.POSITIVE_INFINITY;
  const hasMin = minSkill != null && Number.isFinite(Number(minSkill));
  const hasMax = maxSkill != null && Number.isFinite(Number(maxSkill));
  if (!hasMin && !hasMax) return 0;
  let target;
  if (hasMin && hasMax) target = (Number(minSkill) + Number(maxSkill)) / 2;
  else if (hasMin) target = Number(minSkill);
  else target = Number(maxSkill);
  return Math.abs(skill - target);
}
