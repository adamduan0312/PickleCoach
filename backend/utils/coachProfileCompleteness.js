/**
 * Coach profile completeness — mirrors frontend/src/domain/coachProfileCompleteness.js (parity is tested).
 *
 * A profile row can exist as a draft. It only satisfies the marketplace "profile" step once
 * headline, bio, and "Based in" location are filled in. Location is geocoder-validated on save,
 * so any stored value counts.
 */

export const COACH_HEADLINE_MIN = 10;
export const COACH_BIO_MIN = 50;

/** Order matters: it is the order fields are listed in coach-facing copy. */
export const COACH_PROFILE_REQUIRED_FIELDS = Object.freeze(['headline', 'bio', 'location']);

function trimmedLength(value) {
  return typeof value === 'string' ? value.trim().length : 0;
}

/**
 * @param {{ headline?: string|null, bio?: string|null, location?: string|null }|null|undefined} profile
 * @returns {string[]} required fields that are still missing or too short, in COACH_PROFILE_REQUIRED_FIELDS order
 */
export function coachProfileMissingFields(profile) {
  const p = profile || {};
  const missing = [];
  if (trimmedLength(p.headline) < COACH_HEADLINE_MIN) missing.push('headline');
  if (trimmedLength(p.bio) < COACH_BIO_MIN) missing.push('bio');
  if (trimmedLength(p.location) === 0) missing.push('location');
  return missing;
}

export function isCoachProfileComplete(profile) {
  return Boolean(profile) && coachProfileMissingFields(profile).length === 0;
}
