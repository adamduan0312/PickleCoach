/**
 * PickleCoach: roles vs coach readiness vs Stripe (frontend contract).
 *
 * - `user.roles` = permission intent only (may include "coach" before profile/Stripe exist).
 * - Coach "full product" UI = derived from role + coachProfile + Stripe state — never `roles.includes('coach')` alone.
 * - If `coach` is removed from roles, coach-area UI must hide immediately (backend 403 anyway); profile/Stripe may still exist.
 */

/** @param {unknown} roles */
export function hasCoachRole(roles) {
  return Array.isArray(roles) && roles.includes('coach');
}

/** @param {unknown} roles */
export function hasStudentRole(roles) {
  return Array.isArray(roles) && roles.includes('student');
}

/** @param {unknown} roles */
export function hasAdminRole(roles) {
  return Array.isArray(roles) && roles.includes('admin');
}

/**
 * @param {{ coachProfile?: object | null } | null | undefined} user
 * @returns {object | null}
 */
export function getCoachProfile(user) {
  const p = user?.coachProfile;
  if (p == null || typeof p !== 'object') return null;
  if (p.deleted_at != null && p.deleted_at !== '') return null;
  return p;
}

/**
 * @param {{ coachProfile?: object | null } | null | undefined} user
 */
export function hasCoachProfile(user) {
  return getCoachProfile(user) != null;
}

/**
 * @param {{ stripe_account_id?: string | null } | null} profile
 */
export function hasStripeAccountId(profile) {
  const id = profile?.stripe_account_id;
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Optional: response shape from GET /api/coaches/me/stripe-connect/status (or similar).
 * @param {{
 *   onboarded?: boolean,
 *   payouts_enabled?: boolean,
 *   details_submitted?: boolean,
 *   charges_enabled?: boolean,
 * } | null | undefined} status
 */
export function isStripeConnectOnboardingComplete(status) {
  if (status == null || typeof status !== 'object') return false;
  if (status.onboarded === false) return false;
  return Boolean(status.payouts_enabled && status.details_submitted);
}

/**
 * Full coach dashboard / earnings-type features (strict).
 * Requires coach role + non-deleted profile + Stripe account id + optional Connect completion when `stripeConnectStatus` is passed.
 *
 * @param {{ roles?: string[], coachProfile?: object | null } | null | undefined} user
 * @param {Parameters<typeof isStripeConnectOnboardingComplete>[0]} [stripeConnectStatus] — omit to skip Connect completion gate (only checks account id exists).
 * @param {{ requireStripeOnboardingComplete?: boolean }} [options] — if true and status omitted, onboarding not complete → false.
 */
export function isCoachReady(user, stripeConnectStatus = undefined, options = {}) {
  const { requireStripeOnboardingComplete = false } = options;
  if (!hasCoachRole(user?.roles)) return false;
  const profile = getCoachProfile(user);
  if (!profile) return false;
  if (!hasStripeAccountId(profile)) return false;
  if (stripeConnectStatus != null && typeof stripeConnectStatus === 'object') {
    return isStripeConnectOnboardingComplete(stripeConnectStatus);
  }
  if (requireStripeOnboardingComplete) return false;
  return true;
}

/**
 * Which coach-facing shell to show (never use role alone for "full" coach app).
 *
 * - `hidden` — no `coach` role (do not show coach dashboard even if `coachProfile` exists).
 * - `start_setup` — has role, no usable profile.
 * - `connect_stripe` — profile exists, no `stripe_account_id`.
 * - `complete_stripe` — account linked but Connect onboarding not finished (when `stripeConnectStatus` provided).
 * - `ready` — role + profile + stripe id + (status gate when provided).
 *
 * @param {{ roles?: string[], coachProfile?: object | null } | null | undefined} user
 * @param {Parameters<typeof isStripeConnectOnboardingComplete>[0]} [stripeConnectStatus]
 */
export function getCoachUiPhase(user, stripeConnectStatus = undefined) {
  if (!hasCoachRole(user?.roles)) return 'hidden';
  const profile = getCoachProfile(user);
  if (!profile) return 'start_setup';
  if (!hasStripeAccountId(profile)) return 'connect_stripe';
  if (stripeConnectStatus != null && !isStripeConnectOnboardingComplete(stripeConnectStatus)) {
    return 'complete_stripe';
  }
  return 'ready';
}

/** Student: role alone is enough for student flows (no separate profile required). */
export function isStudentReady(user) {
  return hasStudentRole(user?.roles);
}

/**
 * Single object for components / hooks.
 * @param {{ roles?: string[], coachProfile?: object | null } | null | undefined} user
 * @param {Parameters<typeof isStripeConnectOnboardingComplete>[0]} [stripeConnectStatus]
 */
export function computeCoachReadiness(user, stripeConnectStatus = undefined) {
  const profile = getCoachProfile(user);
  const isCoachRole = hasCoachRole(user?.roles);
  const hasProfile = profile != null;
  const stripeConnected = hasStripeAccountId(profile);
  const stripeOnboardingComplete = isStripeConnectOnboardingComplete(stripeConnectStatus);

  return {
    isCoachRole,
    hasCoachProfile: hasProfile,
    hasStripeConnected: stripeConnected,
    isStripeOnboardingComplete: stripeConnectStatus != null ? stripeOnboardingComplete : null,
    /** Strict: role + profile + stripe id + Connect complete when status provided; if status omitted, same as `isCoachReady(user)` relaxed. */
    isCoachReady: isCoachReady(user, stripeConnectStatus, {
      requireStripeOnboardingComplete: false,
    }),
    coachUiPhase: getCoachUiPhase(user, stripeConnectStatus),
    isStudentReady: isStudentReady(user),
    hasAdminRole: hasAdminRole(user?.roles),
  };
}
