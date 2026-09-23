/**
 * Admin Reviews inventory organization.
 *
 * No moderation/deleted states are exposed by the admin list API.
 * Chronological: most recent created_at first.
 *
 * tabs/groups: none (optional coach_id / student_id query only)
 * primary hierarchy: newest first
 * secondary sort: id DESC as tiebreaker
 * relevant timestamp: created_at
 */

function ms(value) {
  if (value == null || value === '') return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function createdAtMs(review) {
  const t = ms(review?.created_at);
  return Number.isFinite(t) ? t : 0;
}

export function sortAdminReviewsForList(reviews) {
  if (!Array.isArray(reviews) || reviews.length < 2) return reviews || [];

  return [...reviews].sort((a, b) => {
    const byDate = createdAtMs(b) - createdAtMs(a);
    if (byDate !== 0) return byDate;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

export function adminReviewsListHint(reviews) {
  const n = Array.isArray(reviews) ? reviews.length : 0;
  if (n === 0) return '';
  return `${n} review${n === 1 ? '' : 's'} · most recent first · delete available per row`;
}
