import { Op } from 'sequelize';
import { User, UserRole } from '../models/index.js';

// NOTE: invariant uses persisted user_roles (not effective roles)
// because effective_roles can be filtered by governance and must not
// be used for system-level safety guarantees.

/**
 * Count of *other* users (not `excludeUserId`) who are **live** (`deleted_at` null, `is_active` true)
 * and still have an `admin` row in `user_roles`. Soft-deleted users keep `user_roles` rows — they must
 * **not** count toward “another admin exists” (fixes last-admin lockout / accidental wipe).
 *
 * @param {number} excludeUserId
 * @returns {Promise<number>}
 */
export async function countOtherLiveAdmins(excludeUserId) {
  return User.count({
    where: {
      deleted_at: null,
      is_active: true,
      id: { [Op.ne]: excludeUserId },
    },
    include: [
      {
        model: UserRole,
        as: 'userRoles',
        where: { role: 'admin' },
        required: true,
        attributes: [],
      },
    ],
  });
}

/**
 * Validates admin role removal on `PUT /api/users/:id` before mutating `user_roles`.
 * @param {{ actorUserId: number, targetUserId: number, previousRoles: string[], nextRoles: string[], otherAdminUserCount: number }} p
 * `otherAdminUserCount` — must be **`await countOtherLiveAdmins(targetUserId)`** (live admins only, not raw `user_roles` count).
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
export function validateAdminRoleRemovalSafeguards(p) {
  const { actorUserId, targetUserId, previousRoles, nextRoles, otherAdminUserCount } = p;
  const hadAdmin = previousRoles.includes('admin');
  const willHaveAdmin = nextRoles.includes('admin');
  if (!hadAdmin || willHaveAdmin) {
    return { ok: true };
  }
  if (actorUserId === targetUserId) {
    return {
      ok: false,
      status: 400,
      message: 'You cannot remove your own admin role.',
    };
  }
  if (otherAdminUserCount < 1) {
    return {
      ok: false,
      status: 409,
      message: 'At least one admin must remain in the system.',
    };
  }
  return { ok: true };
}

/**
 * Validates suspending a user (`is_active: false`) so the last live admin cannot be locked out.
 * Soft-deleted / already-inactive admins are not "live" — suspending them is a no-op for this guard.
 *
 * @param {{
 *   actorUserId: number,
 *   targetUserId: number,
 *   targetIsLiveAdmin: boolean,
 *   otherAdminUserCount: number,
 * }} p
 * `otherAdminUserCount` — must be **`await countOtherLiveAdmins(targetUserId)`**.
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
export function validateAdminSuspendSafeguards(p) {
  const { actorUserId, targetUserId, targetIsLiveAdmin, otherAdminUserCount } = p;
  if (!targetIsLiveAdmin) {
    return { ok: true };
  }
  if (otherAdminUserCount < 1) {
    const self = Number(actorUserId) === Number(targetUserId);
    return {
      ok: false,
      status: 409,
      message: self
        ? 'You cannot suspend yourself while you are the only live admin.'
        : 'At least one admin must remain in the system.',
    };
  }
  return { ok: true };
}
