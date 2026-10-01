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
 * Skill fit is only computed within the requested rating system (DUPR vs UTR-P are
 * separate scales and are never compared). Without a rating system there is no skill ranking.
 *
 * Trust is a composite of reliability + review rating/volume — not reliability alone.
 */
import { sameSystemSkillDistance } from './coachRating.js';

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
 * @param {object} a coach list DTO
 * @param {object} b coach list DTO
 * @param {{
 *   hasLocation?: boolean,
 *   ratingSystem?: 'DUPR'|'UTR-P'|null,
 *   minSkill?: number|null,
 *   maxSkill?: number|null,
 * }} [opts]
 */
export function compareMarketplaceCoaches(a, b, opts = {}) {
  const hasLocation = Boolean(opts.hasLocation);
  const hasSkill = Boolean(opts.ratingSystem) && (
    (opts.minSkill != null && Number.isFinite(Number(opts.minSkill)))
    || (opts.maxSkill != null && Number.isFinite(Number(opts.maxSkill)))
  );

  if (hasLocation) {
    const da = num(a?.distance_miles, Number.POSITIVE_INFINITY);
    const db = num(b?.distance_miles, Number.POSITIVE_INFINITY);
    if (da !== db) return da - db;
  }

  if (hasSkill) {
    const skillOpts = {
      ratingSystem: opts.ratingSystem,
      minSkill: opts.minSkill,
      maxSkill: opts.maxSkill,
    };
    const fa = sameSystemSkillDistance(a, skillOpts);
    const fb = sameSystemSkillDistance(b, skillOpts);
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
 *   ratingSystem?: 'DUPR'|'UTR-P'|null,
 *   minSkill?: number|null,
 *   maxSkill?: number|null,
 * }} [opts]
 */
export function sortMarketplaceCoaches(coaches, opts = {}) {
  if (!Array.isArray(coaches) || coaches.length < 2) return coaches || [];
  return [...coaches].sort((a, b) => compareMarketplaceCoaches(a, b, opts));
}
