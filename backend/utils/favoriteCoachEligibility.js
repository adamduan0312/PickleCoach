import { getEffectiveRolesForUserRecord } from './roleGovernance.js';
import { isPubliclyActiveUser } from './userLifecycle.js';

function profileOf(coach) {
  const profile = coach?.coachProfile;
  if (!profile) return null;
  return profile.get ? profile.get({ plain: true }) : profile;
}

/**
 * A coach can be saved only while their account is active, they still have the coach role,
 * and their profile hasn't been removed. Saving never requires them to be listed on Discover.
 * @param {object|null|undefined} coach
 */
export function coachIsFavoritable(coach) {
  if (!isPubliclyActiveUser(coach)) return false;
  if (!getEffectiveRolesForUserRecord(coach).includes('coach')) return false;
  const profile = profileOf(coach);
  return Boolean(profile) && profile.deleted_at == null;
}
