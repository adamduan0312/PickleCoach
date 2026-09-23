/**
 * Admin Users list order (server-side — preserves pagination).
 *
 * Account state and role stay separate filters.
 * Deleted is never mixed into All/Active/Suspended (controller excludes deleted_at).
 *
 * | Tab        | Order                                      |
 * | ---------- | ------------------------------------------ |
 * | All status | Suspended → Active, then created_at DESC   |
 * | Active     | created_at DESC (newest join first)        |
 * | Suspended  | created_at DESC                            |
 * | Deleted    | deleted_at DESC (most recently deleted)    |
 */

/**
 * @param {{ deleted?: string, is_active?: string }} q
 * @returns {Array<[string, 'ASC'|'DESC']>}
 */
export function buildAdminUsersListOrder({ deleted, is_active } = {}) {
  if (deleted === 'true') {
    return [
      ['deleted_at', 'DESC'],
      ['id', 'DESC'],
    ];
  }
  if (is_active === 'true' || is_active === 'false') {
    return [
      ['created_at', 'DESC'],
      ['id', 'DESC'],
    ];
  }
  // All non-deleted: suspended (is_active=false) before active, then newest join.
  return [
    ['is_active', 'ASC'],
    ['created_at', 'DESC'],
    ['id', 'DESC'],
  ];
}
