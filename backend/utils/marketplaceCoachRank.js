/**
 * Marketplace Discover ranking for GET /api/coaches.
 *
 * Filters already exclude non-matching skill/radius coaches.
 * Ranking depends on which search inputs the student supplied:
 *
 * | Input              | Primary            | Then                          |
 * | ------------------ | ------------------ | ----------------------------- |
 * | No location/skill  | Marketplace trust   | stable id                     |
 * | Location only      | Distance           | trust → id                    |
 * | Skill only         | Skill fit          | trust → id                    |
 * | Location + skill   | Distance           | skill fit → trust → id        |
 *
 * Trust is a composite of reliability + review rating/volume — not reliability alone.
 */

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Explainable trust score — higher is better.
 * Reliability (0–100) plus review strength (rating × log volume).
 */
export function marketplaceTrustScore(coach) {
  const reliability = num(coach?.reliability_score, 0);
  const rating = num(coach?.rating_average, 0);
  const count = Math.max(0, num(coach?.rating_count, 0) || 0);
  const reviewStrength = rating * Math.log10(10 + count);
  return reliability * 0.5 + reviewStrength * 10;
}

/**
 * Skill distance from preferred midpoint (0 = perfect fit).
 * Midpoint = average of min/max when both set; else the single bound.
 */
export function skillFitDistance(skillRating, { minSkill = null, maxSkill = null } = {}) {
  const skill = num(skillRating, null);
  if (skill == null) return Number.POSITIVE_INFINITY;

  const hasMin = minSkill != null && Number.isFinite(Number(minSkill));
  const hasMax = maxSkill != null && Number.isFinite(Number(maxSkill));
  if (!hasMin && !hasMax) return 0;

  let target;
  if (hasMin && hasMax) target = (Number(minSkill) + Number(maxSkill)) / 2;
  else if (hasMin) target = Number(minSkill);
  else target = Number(maxSkill);

  return Math.abs(skill - target);
}

/**
 * @param {object} a coach list DTO
 * @param {object} b coach list DTO
 * @param {{
 *   hasLocation?: boolean,
 *   minSkill?: number|null,
 *   maxSkill?: number|null,
 * }} [opts]
 */
export function compareMarketplaceCoaches(a, b, opts = {}) {
  const hasLocation = Boolean(opts.hasLocation);
  const hasSkill =
    (opts.minSkill != null && Number.isFinite(Number(opts.minSkill)))
    || (opts.maxSkill != null && Number.isFinite(Number(opts.maxSkill)));

  if (hasLocation) {
    const da = num(a?.distance_miles, Number.POSITIVE_INFINITY);
    const db = num(b?.distance_miles, Number.POSITIVE_INFINITY);
    if (da !== db) return da - db;
  }

  if (hasSkill) {
    const fa = skillFitDistance(a?.skill_rating, {
      minSkill: opts.minSkill,
      maxSkill: opts.maxSkill,
    });
    const fb = skillFitDistance(b?.skill_rating, {
      minSkill: opts.minSkill,
      maxSkill: opts.maxSkill,
    });
    if (fa !== fb) return fa - fb;
  }

  const ta = marketplaceTrustScore(a);
  const tb = marketplaceTrustScore(b);
  if (ta !== tb) return tb - ta;

  // Prefer profiles that expose skill when trust ties (no-location/no-skill browse).
  const aSkill = a?.skill_rating != null ? 1 : 0;
  const bSkill = b?.skill_rating != null ? 1 : 0;
  if (aSkill !== bSkill) return bSkill - aSkill;

  return Number(a?.id || 0) - Number(b?.id || 0);
}

/**
 * @param {Array<object>} coaches serialized list DTOs
 * @param {{
 *   hasLocation?: boolean,
 *   minSkill?: number|null,
 *   maxSkill?: number|null,
 * }} [opts]
 */
export function sortMarketplaceCoaches(coaches, opts = {}) {
  if (!Array.isArray(coaches) || coaches.length < 2) return coaches || [];
  return [...coaches].sort((a, b) => compareMarketplaceCoaches(a, b, opts));
}
