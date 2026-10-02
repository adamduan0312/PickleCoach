/**
 * Coach profile completeness — mirrors backend/utils/coachProfileCompleteness.js (parity is tested).
 *
 * Profile exists ≠ profile complete ≠ marketplace eligible. A draft profile can be saved with
 * these fields blank; it just doesn't satisfy the "Coach profile" setup step until they're filled in.
 */

export const COACH_HEADLINE_MIN = 10;
export const COACH_BIO_MIN = 50;

export const COACH_PROFILE_REQUIRED_FIELDS = Object.freeze(['headline', 'bio', 'location']);

function trimmedLength(value) {
  return typeof value === 'string' ? value.trim().length : 0;
}

/** @returns {string[]} required fields still missing or too short, in COACH_PROFILE_REQUIRED_FIELDS order */
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

/** Per-field requirement hint shown under the form inputs. */
export const COACH_PROFILE_REQUIREMENT_HINTS = Object.freeze({
  headline: `At least ${COACH_HEADLINE_MIN} characters.`,
  bio: `At least ${COACH_BIO_MIN} characters.`,
});

/** ["bio"] → "a bio"; ["headline", "bio"] → "a headline and bio"; all three → "a headline, bio, and location". */
export function missingFieldsPhrase(fields) {
  const names = COACH_PROFILE_REQUIRED_FIELDS.filter((f) => (fields || []).includes(f));
  if (names.length === 0) return '';
  if (names.length === 1) return `a ${names[0]}`;
  if (names.length === 2) return `a ${names[0]} and ${names[1]}`;
  return `a ${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

/** Coach-facing sentence for an incomplete profile, or null when complete. */
export function incompleteProfileMessage(fields) {
  const phrase = missingFieldsPhrase(fields);
  return phrase ? `Add ${phrase} to make your profile ready for students.` : null;
}
