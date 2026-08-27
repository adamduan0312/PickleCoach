/**
 * Admin-controlled role governance (users.role_governance_locked + users.admin_allowed_roles).
 *
 * ## Three layers (do not conflate)
 * 1. **`user_roles` rows / `user.userRoles`** — persisted **assignments** (audit + admin tooling). Not the HTTP permission source by itself.
 * 2. **Governance columns** on `users` — allow-list when `role_governance_locked` is true.
 * 3. **Effective roles** — **the only values that must drive access control** for a loaded `User` row: `effectiveRolesFromGovernance(dbAssignments, user)`.
 *
 * After `authenticate`, **`req.user.roles`** is **already** the effective list (alias: **`req.user.effectiveRoles`**). Do **not** use `req.user.userRoles.map(...)` for permission checks on the authenticated subject.
 *
 * For **other** users loaded by id in controllers/workers, use **`getEffectiveRolesForUserRecord(user)`** (requires governance fields + `userRoles` on the instance).
 */


/** Raw `user_roles` keys from an associated `userRoles` include (admin audit / persistence only). */
export function getDbRoleAssignments(user) {
  if (!user) return [];
  const rows = user.userRoles ?? [];
  return rows.map((r) => (r.get ? r.get('role') : r.role)).filter(Boolean);
}

/**
 * Effective roles for any `User` instance that has governance columns + `userRoles` loaded.
 * Use for permission checks on users other than `req.user`.
 */
export function getEffectiveRolesForUserRecord(user) {
  if (!user) return [];
  return effectiveRolesFromGovernance(getDbRoleAssignments(user), user);
}

export function isRoleGovernanceLocked(user) {
  const u = user?.get ? user.get({ plain: true }) : user ?? {};
  return Boolean(u.role_governance_locked);
}

/**
 * @param {import('sequelize').Model | object} user
 * @returns {string[] | null} null = unrestricted (legacy / open mode)
 */
export function parseAdminAllowedRoles(user) {
  const u = user?.get ? user.get({ plain: true }) : user ?? {};
  const raw = u.admin_allowed_roles;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return raw.filter((r) => typeof r === 'string' && r.length > 0);
  }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.filter((r) => typeof r === 'string' && r.length > 0) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Effective permission list from persisted assignments + governance (same formula as `authenticate` for `req.user.roles`).
 * @param {string[]} dbRoles from `user_roles` only
 * @param {import('sequelize').Model | object} user
 */
export function effectiveRolesFromGovernance(dbRoles, user) {
  const list = Array.isArray(dbRoles) ? [...dbRoles] : [];
  if (!isRoleGovernanceLocked(user)) return list;
  const allowed = parseAdminAllowedRoles(user);
  if (!allowed || allowed.length === 0) return list;
  const allow = new Set(allowed);
  return list.filter((r) => allow.has(r));
}

/**
 * Self-service may add `student` or `coach` only if governance allows it.
 * @param {import('sequelize').Model | object} user
 * @param {'student' | 'coach'} roleToAdd
 * @param {string[]} currentDbRoles roles currently in DB (before add)
 */
export function canSelfServiceAddRole(user, roleToAdd, currentDbRoles) {
  if (roleToAdd !== 'student' && roleToAdd !== 'coach') return false;
  if (!isRoleGovernanceLocked(user)) return true;
  const allowed = parseAdminAllowedRoles(user);
  if (!allowed || allowed.length === 0) return false;
  if (!allowed.includes(roleToAdd)) return false;
  const next = new Set([...(currentDbRoles || []), roleToAdd]);
  for (const r of next) {
    if (!allowed.includes(r)) return false;
  }
  return true;
}

/**
 * Self-service may remove `student` or `coach` when at least one of those remains.
 * Does not delete historical coach/student data — only the `user_roles` assignment.
 * Admin role is never removable here (self-service schema excludes it).
 * @param {import('sequelize').Model | object} _user reserved for future governance floors
 * @param {'student' | 'coach'} roleToRemove
 * @param {string[]} currentDbRoles roles currently in DB (before remove)
 */
export function canSelfServiceRemoveRole(_user, roleToRemove, currentDbRoles) {
  if (roleToRemove !== 'student' && roleToRemove !== 'coach') return false;
  const roles = Array.isArray(currentDbRoles) ? currentDbRoles : [];
  if (!roles.includes(roleToRemove)) return true; // noop; handler returns unchanged
  const marketplaceLeft = roles.filter(
    (r) => (r === 'student' || r === 'coach') && r !== roleToRemove,
  );
  return marketplaceLeft.length >= 1;
}

/**
 * @param {import('sequelize').Model | object} user
 * @param {string[]} effectiveRoles
 */
export function serializeRoleState(user, effectiveRoles) {
  const locked = isRoleGovernanceLocked(user);
  const allowed = parseAdminAllowedRoles(user);
  return {
    locked,
    allowed_roles: allowed,
    effective_roles: Array.isArray(effectiveRoles) ? [...effectiveRoles].sort() : [],
    source: locked ? 'admin' : 'open',
  };
}
