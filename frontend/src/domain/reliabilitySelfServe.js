/**
 * Self-serve reliability copy + activity lines for Settings.
 * Uses curated /me/reliability DTOs only — no formula, decay, or point deductions.
 *
 * Education copy is identical for student and coach. Only visibility differs by role.
 */

/** Matches default RELIABILITY_WINDOW_DAYS — curated /me DTO does not expose the window. */
export const RELIABILITY_ACTIVITY_WINDOW_DAYS = 90;

export const RECENT_BOOKING_ACTIVITY_DETAIL =
  `Bookings with lesson times in the last ${RELIABILITY_ACTIVITY_WINDOW_DAYS} days. Includes completed, cancelled, and no-show bookings. This activity helps determine your reliability score.`;

export const RELIABILITY_BASED_ON_SUMMARY =
  'Based on your recent booking behavior on PickleCoach.';

export const RELIABILITY_AFFECTS_COPY =
  'Your reliability reflects your recent booking behavior on PickleCoach. No-shows and late cancellations can lower your score. Older issues have less impact over time.';

export const RELIABILITY_IMPROVE_COPY =
  'Complete your lessons as scheduled and avoid late cancellations and no-shows. Clean completed lessons help your score recover.';

function asCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

/** Display percent string from reliability_score (0–100). */
export function formatSelfReliabilityPercent(score) {
  if (score == null || score === '') return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const display = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${display}%`;
}

/**
 * Plain-language recent activity rows for the current role.
 * Same categories for both roles; only the non-late cancel counter source differs.
 * Omits zero-count rows (except recent booking activity, which always shows).
 * @param {object|null|undefined} reliability — /me/reliability DTO
 * @param {'student'|'coach'} role
 * @returns {Array<{ key: string, label: string, count: number, detail?: string }>}
 */
export function reliabilityActivityRows(reliability, role) {
  if (!reliability || typeof reliability !== 'object') return [];

  const total = asCount(reliability.total_bookings);
  const late = asCount(reliability.late_cancels);
  const noShows = asCount(reliability.no_shows);
  const misconduct = asCount(reliability.misconduct_penalties);
  const incomplete = asCount(reliability.lesson_not_completed_penalties);
  const otherCancels = role === 'student'
    ? asCount(reliability.student_cancels_non_late)
    : asCount(reliability.coach_cancels);

  /** @type {Array<{ key: string, label: string, count: number, detail?: string }>} */
  const rows = [
    {
      key: 'total_bookings',
      label: 'Recent booking activity',
      count: total,
      detail: RECENT_BOOKING_ACTIVITY_DETAIL,
    },
    { key: 'late_cancels', label: 'Late cancellations', count: late },
    {
      key: role === 'student' ? 'student_cancels_non_late' : 'coach_cancels',
      label: 'Other cancellations',
      count: otherCancels,
    },
    { key: 'no_shows', label: 'No-shows', count: noShows },
    { key: 'misconduct_penalties', label: 'Conduct issues', count: misconduct },
    { key: 'lesson_not_completed_penalties', label: 'Lessons not completed', count: incomplete },
  ];

  // Always keep total_bookings; hide other zeros.
  return rows.filter((row) => row.key === 'total_bookings' || row.count > 0);
}

/** Shared “Based on…” line under the score (same for student and coach). */
export function reliabilityBasedOnSummary(_role) {
  return RELIABILITY_BASED_ON_SUMMARY;
}

/** Shared “How it works” body (same for student and coach). */
export function reliabilityAffectsCopy(_role) {
  return RELIABILITY_AFFECTS_COPY;
}

export function reliabilityImproveCopy() {
  return RELIABILITY_IMPROVE_COPY;
}

/** Role-specific visibility only — education copy stays shared. */
export function reliabilityVisibilityCopy(role) {
  if (role === 'student') {
    return 'Only you and PickleCoach can see your reliability score. Coaches don’t see it when you book.';
  }
  return 'Students can see your reliability score on Discover and your public coach profile. Use this page to understand how your score works.';
}

/** Public marketplace gloss (Discover / coach profile) — concise trust signal. */
export const PUBLIC_COACH_RELIABILITY_HINT =
  'Based on recent attendance, cancellations, and completed lessons.';
