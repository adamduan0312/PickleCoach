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

/** The "Coach profile" setup step: the profile photo (users.avatar_url) plus the required fields. */
export const COACH_PROFILE_STEP_FIELDS = Object.freeze(['photo', ...COACH_PROFILE_REQUIRED_FIELDS]);

/** @returns {string[]} what the profile step still needs, in COACH_PROFILE_STEP_FIELDS order */
export function coachProfileStepMissing(profile, avatarUrl) {
  const photo = trimmedLength(avatarUrl) > 0 ? [] : ['photo'];
  return [...photo, ...coachProfileMissingFields(profile)];
}

const FIELD_NAMES = { photo: 'profile photo', headline: 'headline', bio: 'bio', location: 'location' };

/** Per-field requirement hint shown under the form inputs. */
export const COACH_PROFILE_REQUIREMENT_HINTS = Object.freeze({
  headline: `At least ${COACH_HEADLINE_MIN} characters.`,
  bio: `At least ${COACH_BIO_MIN} characters.`,
});

/** ["bio"] → "a bio"; ["photo", "bio"] → "a profile photo and bio"; three → "a headline, bio, and location". */
export function missingFieldsPhrase(fields) {
  const names = COACH_PROFILE_STEP_FIELDS
    .filter((f) => (fields || []).includes(f))
    .map((f) => FIELD_NAMES[f]);
  if (names.length === 0) return '';
  if (names.length === 1) return `a ${names[0]}`;
  if (names.length === 2) return `a ${names[0]} and ${names[1]}`;
  return `a ${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

const LENGTH_MINIMUMS = { headline: COACH_HEADLINE_MIN, bio: COACH_BIO_MIN };

/**
 * Coach-facing sentence for an incomplete profile, or null when complete. With the saved `profile`,
 * a headline or bio that's filled in but too short is asked to be lengthened rather than added.
 */
export function incompleteProfileMessage(fields, profile = null) {
  const list = fields || [];
  const tooShort = profile
    ? list.filter((f) => LENGTH_MINIMUMS[f] && trimmedLength(profile[f]) > 0)
    : [];
  const toAdd = list.filter((f) => !tooShort.includes(f));
  if (!tooShort.length) {
    const phrase = missingFieldsPhrase(toAdd);
    return phrase ? `Add ${phrase} to make your profile ready for students.` : null;
  }
  const lengthen = tooShort.length === 2
    ? `lengthen your headline (at least ${COACH_HEADLINE_MIN} characters) and bio (at least ${COACH_BIO_MIN} characters)`
    : `lengthen your ${tooShort[0]} to at least ${LENGTH_MINIMUMS[tooShort[0]]} characters`;
  const add = missingFieldsPhrase(toAdd);
  return `To make your profile ready for students, ${add ? `add ${add}, and ` : ''}${lengthen}.`;
}
