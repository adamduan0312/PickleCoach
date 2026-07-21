/**
 * User account lifecycle helpers.
 *
 * States:
 * - Active:    is_active=true,  deleted_at=null
 * - Suspended: is_active=false, deleted_at=null
 * - Deleted:   is_active=false, deleted_at!=null
 *
 * Through the current application, the only operation that soft-deletes a coach
 * profile is soft-deleting the entire user account (`coach_profiles.deleted_at`).
 * Lessons, availability, reviews, bookings, and courts are intentionally left alone
 * on delete/restore (lessons remain for booking history; suspension never touches them).
 */

import { CoachProfile, User, UserRole } from '../models/index.js';

/** Sequelize `where` for publicly discoverable / bookable accounts (Active only). */
export const PUBLIC_ACTIVE_USER_WHERE = Object.freeze({
  is_active: true,
  deleted_at: null,
});

/**
 * @param {{ is_active?: boolean, deleted_at?: Date|string|null }|null|undefined} user
 * @returns {boolean}
 */
export function isPubliclyActiveUser(user) {
  if (!user) return false;
  const active = user.is_active === true || user.is_active === 1;
  return active && user.deleted_at == null;
}

/**
 * Load a coach user only if Active (not suspended/deleted) and has coach role + live profile.
 * Used by public discovery side-doors (availability, courts, reliability).
 *
 * @param {number} coachId
 * @returns {Promise<import('sequelize').Model|null>}
 */
export async function findPublicActiveCoach(coachId) {
  if (!Number.isFinite(coachId) || coachId < 1) return null;
  return User.findOne({
    where: { id: coachId, ...PUBLIC_ACTIVE_USER_WHERE },
    include: [
      { model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true, attributes: ['role'] },
      {
        model: CoachProfile,
        as: 'coachProfile',
        where: { deleted_at: null },
        required: true,
      },
    ],
  });
}

/**
 * Soft-delete a user and, if present, their coach profile.
 * Sets users.deleted_at + is_active=false; coach_profiles.deleted_at when a profile exists.
 *
 * @param {import('sequelize').Model} user
 * @param {{ transaction?: import('sequelize').Transaction }} [opts]
 */
export async function softDeleteUserAccount(user, { transaction } = {}) {
  await user.update(
    {
      deleted_at: new Date(),
      is_active: false,
    },
    { transaction },
  );

  const coachProfile = await CoachProfile.findOne({
    where: { user_id: user.id },
    transaction,
  });
  if (coachProfile && !coachProfile.deleted_at) {
    await coachProfile.update({ deleted_at: new Date() }, { transaction });
  }

  return { coachProfile };
}

/**
 * Restore a soft-deleted user and any soft-deleted coach profile in one transaction step.
 * Sets users.deleted_at=null, users.is_active=true, and clears coach_profiles.deleted_at.
 *
 * @param {import('sequelize').Model} user
 * @param {{ transaction?: import('sequelize').Transaction }} [opts]
 */
export async function restoreUserAccount(user, { transaction } = {}) {
  await user.update(
    {
      deleted_at: null,
      is_active: true,
    },
    { transaction },
  );

  const coachProfile = await CoachProfile.findOne({
    where: { user_id: user.id },
    transaction,
  });
  if (coachProfile?.deleted_at) {
    await coachProfile.update({ deleted_at: null }, { transaction });
  }

  return { coachProfile };
}
