/**
 * Shared WHERE builders for lesson list endpoints.
 */
import { Op } from 'sequelize';

/**
 * Admin lesson inventory — no marketplace gate.
 * Default = **complete inventory** (includes soft-deleted). Pass `include_deleted=false`
 * or `deleted=false` to exclude soft-deleted; `deleted=true` for deleted-only.
 *
 * @param {{
 *   coach_id?: number,
 *   is_active?: boolean | 'true' | 'false',
 *   include_deleted?: boolean | 'true' | 'false',
 *   deleted?: boolean | 'true' | 'false',
 * }} opts
 */
export function buildAdminLessonsWhere({
  coach_id,
  is_active,
  include_deleted,
  deleted,
} = {}) {
  const where = {};
  if (coach_id != null) where.coach_id = coach_id;

  if (is_active === true || is_active === 'true') where.is_active = true;
  else if (is_active === false || is_active === 'false') where.is_active = false;

  if (deleted === true || deleted === 'true') {
    where.deleted_at = { [Op.ne]: null };
  } else if (
    deleted === false
    || deleted === 'false'
    || include_deleted === false
    || include_deleted === 'false'
  ) {
    where.deleted_at = null;
  }
  // else: omit deleted_at → include active + soft-deleted (complete inventory)

  return where;
}

/**
 * Optional price bounds for admin or public lists.
 * @param {{ min_price?: number, max_price?: number }} opts
 * @returns {Record<string, unknown>|null} Sequelize `price` where fragment or null
 */
export function buildLessonPriceWhere({ min_price, max_price } = {}) {
  if (min_price == null && max_price == null) return null;
  const price = {};
  if (min_price != null) price[Op.gte] = Number(min_price);
  if (max_price != null) price[Op.lte] = Number(max_price);
  return price;
}
