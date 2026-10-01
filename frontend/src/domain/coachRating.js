/**
 * Coach skill-rating rules — mirrors backend/utils/coachRating.js (parity is tested).
 *
 * DUPR and UTR-P are separate scales: never compare, convert, or rank their
 * numeric values against each other.
 */
import { CHAR_LIMITS } from '../utils/charLimits.js';

export const COACH_RATING_SYSTEMS = Object.freeze({
  DUPR: Object.freeze({ value: 'DUPR', label: 'DUPR', min: 2, max: 8, decimals: 3 }),
  'UTR-P': Object.freeze({ value: 'UTR-P', label: 'UTR-P', min: 1, max: 10, decimals: 1 }),
});

export const COACH_RATING_SYSTEM_VALUES = Object.freeze(Object.keys(COACH_RATING_SYSTEMS));

export const DEFAULT_RATING_SYSTEM = 'DUPR';

export const RATING_SYSTEM_REQUIRED_MESSAGE = 'Select a rating system (DUPR or UTR-P) for your skill rating.';

export function ratingRules(ratingSystem) {
  return COACH_RATING_SYSTEMS[ratingSystem] || null;
}

function formatBound(n, decimals) {
  return Number(n).toFixed(decimals);
}

/** "2.000–8.000" / "1.0–10.0" */
export function ratingRangeLabel(ratingSystem) {
  const r = ratingRules(ratingSystem);
  return r ? `${formatBound(r.min, r.decimals)}–${formatBound(r.max, r.decimals)}` : '';
}

/** Profile form copy per system. */
export function ratingFieldCopy(ratingSystem) {
  const r = ratingRules(ratingSystem) || COACH_RATING_SYSTEMS[DEFAULT_RATING_SYSTEM];
  return {
    label: `${r.label} rating (${ratingRangeLabel(r.value)})`,
    hint: `Enter your current ${r.label} rating.`,
    placeholder: r.value === 'DUPR' ? 'e.g. 4.217' : 'e.g. 9.5',
  };
}

/** Number of decimal places in the value as written (no rounding). */
export function ratingDecimalPlaces(value) {
  const s = String(value ?? '').trim();
  const m = /^\d+(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  return m[1] ? m[1].length : 0;
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
 * @param {number|string} rating non-empty rating
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

/** Shown when switching systems leaves a value that doesn't fit the new scale. */
export function ratingSwitchMessage(rating, ratingSystem) {
  const r = ratingRules(ratingSystem);
  if (!r) return RATING_SYSTEM_REQUIRED_MESSAGE;
  return `${String(rating).trim()} isn't a valid ${r.label} rating. Replace it with your ${r.label} rating. ${ratingRuleMessage(ratingSystem)}`;
}

/** Keep digits and a single dot. Never truncates decimals — extra precision is rejected, not rounded. */
export function sanitizeRatingInput(value) {
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
}

/** Whole numbers only (no decimals, signs, or exponent notation). */
export function sanitizeWholeNumberInput(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** "4.217" for DUPR (always 3 dp), "9.5" for UTR-P (1 dp). Null without a valid system. */
export function formatSkillRating(skillRating, ratingSystem) {
  const r = ratingRules(ratingSystem);
  if (!r || skillRating == null || skillRating === '') return null;
  const n = Number(skillRating);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(r.decimals);
}

/** Compact skill line with the system always visible, e.g. "DUPR 4.217", "UTR-P 9.5". */
export function formatSkillRatingLine(skillRating, ratingSystem) {
  const value = formatSkillRating(skillRating, ratingSystem);
  return value ? `${ratingRules(ratingSystem).label} ${value}` : null;
}

/** Discover skill-filter options (whole/half points) on the chosen system's own scale. */
export function skillFilterOptions(ratingSystem) {
  const r = ratingRules(ratingSystem);
  if (!r) return [];
  const out = [];
  for (let v = r.min; v <= r.max + 1e-9; v += 0.5) out.push(v.toFixed(1));
  return out;
}

// --- Coach profile form -------------------------------------------------

/** Mirrors backend Joi limits. */
export const COACH_PROFILE_LIMITS = Object.freeze({
  headline: CHAR_LIMITS.coachHeadline,
  bio: CHAR_LIMITS.coachBio,
  certification: CHAR_LIMITS.coachCertification,
  certificationsMaxCount: 20,
  location: 255,
  experienceYearsMax: 100,
});

export const COACH_PROFILE_FORM_FIELDS = new Set([
  'headline', 'bio', 'experience_years', 'rating_system', 'skill_rating', 'certifications', 'location',
]);

export function coachProfileToForm(profile) {
  const system = ratingRules(profile?.rating_system) ? profile.rating_system : DEFAULT_RATING_SYSTEM;
  const rating = profile?.skill_rating != null && ratingRules(profile?.rating_system)
    ? String(Number(profile.skill_rating))
    : '';
  return {
    headline: profile?.headline || '',
    bio: profile?.bio || '',
    experience_years: profile?.experience_years != null ? String(profile.experience_years) : '',
    rating_system: system,
    skill_rating: rating,
    certifications: certificationRowsFromProfile(profile?.certifications),
    location: profile?.location || '',
  };
}

/** Edit rows: saved names, or a single empty row so the field is ready to type into. */
function certificationRowsFromProfile(value) {
  const names = certificationList(value);
  return names.length ? names : [''];
}

/** @returns {Record<string, string>} field → message (empty when valid) */
export function validateCoachProfileForm(form) {
  const errors = {};
  if (form.headline.trim().length > COACH_PROFILE_LIMITS.headline) {
    errors.headline = `Headline must be ${COACH_PROFILE_LIMITS.headline} characters or fewer.`;
  }
  if (form.bio.trim().length > COACH_PROFILE_LIMITS.bio) {
    errors.bio = `Bio must be ${COACH_PROFILE_LIMITS.bio.toLocaleString('en-US')} characters or fewer.`;
  }
  form.certifications.forEach((name, i) => {
    if (name.trim().length > COACH_PROFILE_LIMITS.certification) {
      errors[`certifications.${i}`] = `Each certification must be ${COACH_PROFILE_LIMITS.certification} characters or fewer.`;
    }
  });
  if (certificationList(form.certifications).length > COACH_PROFILE_LIMITS.certificationsMaxCount) {
    errors.certifications = `You can list up to ${COACH_PROFILE_LIMITS.certificationsMaxCount} certifications.`;
  }
  if (form.location.trim().length > COACH_PROFILE_LIMITS.location) {
    errors.location = `Location must be ${COACH_PROFILE_LIMITS.location} characters or fewer.`;
  }
  const years = String(form.experience_years ?? '').trim();
  if (years !== '' && (!/^\d+$/.test(years) || Number(years) > COACH_PROFILE_LIMITS.experienceYearsMax)) {
    errors.experience_years = `Experience must be a whole number from 0 to ${COACH_PROFILE_LIMITS.experienceYearsMax}.`;
  }
  const rating = String(form.skill_rating ?? '').trim();
  if (rating !== '') {
    if (!ratingRules(form.rating_system)) errors.rating_system = RATING_SYSTEM_REQUIRED_MESSAGE;
    else {
      const bad = validateSkillRatingForSystem(form.rating_system, rating);
      if (bad) errors.skill_rating = bad;
    }
  }
  return errors;
}

/**
 * Trimmed payload; rating keeps its exact precision (Number("4.217") → 4.217).
 * The DUPR default is form-only: with no rating entered, no rating system is saved.
 */
export function coachProfileFormToPayload(form) {
  const rating = String(form.skill_rating ?? '').trim();
  const years = String(form.experience_years ?? '').trim();
  const body = {
    headline: form.headline.trim(),
    bio: form.bio.trim(),
    certifications: certificationList(form.certifications),
    location: form.location.trim(),
    rating_system: rating === '' ? null : form.rating_system,
    skill_rating: rating === '' ? null : Number(rating),
  };
  if (years !== '') body.experience_years = Number(years);
  return body;
}

/** Trimmed, non-blank names with case-insensitive duplicates removed (matches the backend). */
export function certificationList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

export function coachProfileApiFieldErrors(err) {
  const details = Array.isArray(err?.details) ? err.details : [];
  const fields = {};
  const general = [];
  for (const d of details) {
    const field = String(d?.field || '');
    const message = d?.message || 'Invalid value.';
    if (COACH_PROFILE_FORM_FIELDS.has(field) || /^certifications\.\d+$/.test(field)) {
      if (!fields[field]) fields[field] = message;
    } else general.push(message);
  }
  return { fields, general: general.length ? general.join(' ') : null };
}
