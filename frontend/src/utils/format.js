export function formatMoney(amount, currency = 'USD') {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(n);
}

export function formatMiles(miles) {
  if (miles == null || miles === '') return null;
  const n = Number(miles);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(1)} mi`;
}

/** Student-facing distance suffix, e.g. "7.4 mi away". */
export function formatMilesAway(miles) {
  const formatted = formatMiles(miles);
  return formatted ? `${formatted} away` : null;
}

/**
 * Coarse teaching area from a court DTO (public browse / list cards).
 * Prefers `area`, then city/state — never profile.location.
 */
export function teachingLocationLabel(court) {
  if (!court) return null;
  if (court.area) return court.area;
  const city = court.city && String(court.city).trim();
  const state = court.state && String(court.state).trim();
  if (city && state && state.length === 2 && city !== 'Unknown') return `${city}, ${state}`;
  if (court.name) return court.name;
  return null;
}

/**
 * Nearest teaching location for Discover list cards.
 * API sorts `courts[]` by distance when geo search is active.
 */
export function nearestTeachingLocationLabel(coach) {
  const courts = Array.isArray(coach?.courts) ? coach.courts : [];
  return teachingLocationLabel(courts[0]) || null;
}

/**
 * Discover card place line.
 * - With search location: nearest teaching court (distance shown separately).
 * - Without location, 1 court: that court's area.
 * - Without location, multiple courts: coverage count (avoid implying one primary court).
 */
export function discoverTeachingPlaceLabel(coach, { hasLocation = false } = {}) {
  const courts = Array.isArray(coach?.courts) ? coach.courts : [];
  if (courts.length === 0) return null;
  if (hasLocation) return nearestTeachingLocationLabel(coach);
  if (courts.length === 1) return teachingLocationLabel(courts[0]);
  return `${courts.length} teaching locations`;
}

/**
 * Human-readable source for coach_profiles.rating_system.
 * Backend values stay: self | DUPR | UTR-P — do not imply external verification.
 */
export function formatRatingSystemLabel(ratingSystem) {
  if (ratingSystem == null || ratingSystem === '') return null;
  switch (String(ratingSystem)) {
    case 'self':
      return 'Self-reported rating';
    case 'DUPR':
      return 'DUPR rating';
    case 'UTR-P':
      return 'UTR-P rating';
    default:
      return `${ratingSystem} rating`;
  }
}

/** Compact student-facing skill line, e.g. "Skill 4.0 · DUPR rating". */
export function formatSkillRatingLine(skillRating, ratingSystem) {
  if (skillRating == null || skillRating === '') return null;
  const n = Number(skillRating);
  if (!Number.isFinite(n)) return null;
  const skill = `Skill ${n.toFixed(1)}`;
  const source = formatRatingSystemLabel(ratingSystem);
  return source ? `${skill} · ${source}` : skill;
}

/**
 * Student-facing reliability label (matches coach profile wording).
 * Score is 0–100; displayed as a percentage. Omits when missing/invalid.
 */
export function formatReliabilityLabel(score) {
  if (score == null || score === '') return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const display = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `Reliability: ${display}%`;
}

/** Short Discover gloss — no formula dump. */
export function formatReliabilityHint() {
  return 'Based on cancels and no-shows';
}

/**
 * Normalized coach review aggregate from API fields (does not recompute averages).
 * @returns {{ hasReviews: boolean, ratingAverage: number | null, reviewCount: number }}
 */
export function coachReviewSummary(ratingAverage, ratingCount) {
  const reviewCount = Number(ratingCount) || 0;
  const avg = ratingAverage != null ? Number(ratingAverage) : null;
  const hasReviews = reviewCount > 0 && avg != null && Number.isFinite(avg);
  return {
    hasReviews,
    ratingAverage: hasReviews ? avg : null,
    reviewCount,
  };
}

/** Compact card line, e.g. "4.7 ★ · 23 reviews" or "No reviews yet". */
export function formatCoachRatingCompact(ratingAverage, ratingCount) {
  const parts = coachRatingCompactParts(ratingAverage, ratingCount);
  if (!parts.hasReviews) return 'No reviews yet';
  return `${parts.value} ★ · ${parts.reviewLabel}`;
}

/**
 * Structured compact rating for UI — value and review count in normal text; star styled separately.
 * @returns {{ hasReviews: false } | { hasReviews: true, value: string, reviewLabel: string }}
 */
export function coachRatingCompactParts(ratingAverage, ratingCount) {
  const { hasReviews, ratingAverage: avg, reviewCount } = coachReviewSummary(ratingAverage, ratingCount);
  if (!hasReviews) return { hasReviews: false };
  return {
    hasReviews: true,
    value: avg.toFixed(1),
    reviewLabel: `${reviewCount} review${reviewCount === 1 ? '' : 's'}`,
  };
}

/** Visual star row rounded to nearest half, e.g. "★★★★½" for 4.7. */
export function visualStarRatingParts(rating, maxStars = 5) {
  const avg = Number(rating);
  if (!Number.isFinite(avg) || avg <= 0) return null;
  const clamped = Math.max(0, Math.min(maxStars, avg));
  const roundedHalf = Math.round(clamped * 2) / 2;
  const full = Math.floor(roundedHalf);
  const hasHalf = roundedHalf % 1 === 0.5;
  const empty = maxStars - full - (hasHalf ? 1 : 0);
  return { full, hasHalf, empty, maxStars };
}

/** String helper for non-React contexts. Prefer `<StarRating />` in UI. */
export function formatVisualStarRating(ratingAverage, maxStars = 5) {
  const parts = visualStarRatingParts(ratingAverage, maxStars);
  if (!parts) return '';
  return `${'★'.repeat(parts.full)}${parts.hasHalf ? '½' : ''}${'☆'.repeat(Math.max(0, parts.empty))}`;
}

export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

export function courtLabel(court) {
  if (!court) return 'Court TBD';
  const name = court.name || 'Court';
  const lines = formatCourtAddressLines(court);
  if (lines.length) return `${name} — ${lines.join(', ')}`;
  return name;
}

/**
 * Human-readable address lines for court cards (skips OSM placeholders).
 * @returns {string[]}
 */
export function formatCourtAddressLines(court) {
  if (!court) return [];
  const lines = [];
  const street = court.address_line1 && String(court.address_line1).trim();
  if (
    street
    && !/^OSM\s/i.test(street)
    && street !== 'Imported from OpenStreetMap'
    && street !== 'Address pending verification'
  ) {
    lines.push(street);
  }

  const city = court.city && String(court.city).trim();
  const state = court.state && String(court.state).trim();
  const zip = court.postal_code && String(court.postal_code).trim();
  const cityOk = city && city !== 'Unknown';
  const stateOk = state && state !== 'XX' && state.length === 2;
  const zipOk = zip && zip !== '00000' && /^\d{5}(-\d{4})?$/.test(zip);

  const locality = [
    cityOk ? city : null,
    stateOk ? state : null,
    zipOk ? zip : null,
  ].filter(Boolean);
  if (locality.length) {
    // "Fort Lauderdale, FL 33304"
    if (cityOk && stateOk) {
      lines.push(`${city}, ${state}${zipOk ? ` ${zip}` : ''}`);
    } else {
      lines.push(locality.join(', '));
    }
  }
  return lines;
}

export function passwordHint() {
  return 'At least 10 characters, with uppercase, lowercase, and a number.';
}

export function validatePassword(password) {
  const errors = [];
  if (!password || password.length < 10) errors.push('Password must be at least 10 characters.');
  if (password && password.length > 128) errors.push('Password must be at most 128 characters.');
  if (password && !/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter.');
  if (password && !/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter.');
  if (password && !/\d/.test(password)) errors.push('Password must contain at least one number.');
  return errors;
}

export function fieldError(apiError, field) {
  const details = apiError?.details;
  if (!Array.isArray(details)) return null;
  const hit = details.find((d) => d.field === field);
  return hit?.message || null;
}
