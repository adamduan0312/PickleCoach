/**
 * Marketplace listing eligibility — "can students realistically book this coach?"
 *
 * Separate from coach dashboard readiness (role + profile + Stripe started).
 * Separate from booking-intent validation (transactional checks for a specific slot —
 * do NOT call getCoachMarketplaceEligibility from booking flows; discovery criteria
 * may grow tighter without breaking deep-link bookings).
 *
 * Discovery surfaces that MUST share this definition:
 * - GET /api/coaches (incl. geo)
 * - GET /api/coaches/:id/lessons (coach-scoped public offerings)
 * - future featured / recommended / homepage rails
 * (GET /api/lessons catalog removed — returns 410)
 *
 * Discovery (`GET /api/coaches`) stays database-only: use
 * `stripe_ready` on coach_profiles, never live Stripe API calls in list queries.
 */

import {
  User,
  UserRole,
  CoachProfile,
  CoachCourtLocation,
  CourtLocation,
  Lesson,
  CoachAvailability,
} from '../models/index.js';
import { PUBLIC_ACTIVE_USER_WHERE, isPubliclyActiveUser } from '../utils/userLifecycle.js';
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';

/** Step keys — Stripe is required for listing but not the first onboarding step UX. */
export const MARKETPLACE_STEP_KEYS = Object.freeze([
  'profile',
  'stripe',
  'lesson',
  'court',
  'availability',
]);

/**
 * Stripe Connect "ready to receive funds" — matches frontend
 * `isStripeConnectOnboardingComplete` (payouts_enabled + details_submitted).
 * @param {{ payouts_enabled?: boolean, details_submitted?: boolean } | null | undefined} account
 */
export function isStripeAccountReady(account) {
  if (account == null || typeof account !== 'object') return false;
  return Boolean(account.payouts_enabled && account.details_submitted);
}

/**
 * Persist local stripe_ready from a Stripe Account object.
 * @param {import('sequelize').Model} coachProfile
 * @param {object} account — Stripe Account
 * @returns {Promise<boolean>} new stripe_ready value
 */
export async function syncCoachStripeReadyFromAccount(coachProfile, account) {
  const ready = isStripeAccountReady(account);
  const patch = { stripe_ready: ready };
  if (ready) {
    if (!coachProfile.stripe_onboarding_completed_at) {
      patch.stripe_onboarding_completed_at = new Date();
    }
  } else {
    patch.stripe_onboarding_completed_at = null;
  }
  await coachProfile.update(patch);
  return ready;
}

/**
 * Pure checklist from boolean facts (unit-testable; no I/O).
 * @param {{
 *   profile?: boolean,
 *   stripe?: boolean,
 *   lesson?: boolean,
 *   court?: boolean,
 *   availability?: boolean,
 * }} flags
 */
export function computeMarketplaceEligibilityFromSteps(flags = {}) {
  const steps = {
    profile: Boolean(flags.profile),
    stripe: Boolean(flags.stripe),
    lesson: Boolean(flags.lesson),
    court: Boolean(flags.court),
    availability: Boolean(flags.availability),
  };
  const missing = MARKETPLACE_STEP_KEYS.filter((key) => !steps[key]);
  return {
    listed: missing.length === 0,
    missing,
    steps,
  };
}

/**
 * Coach-facing / internal eligibility from DB only (no Stripe HTTP).
 * @param {number} coachId — user id
 * @returns {Promise<{ listed: boolean, missing: string[], steps: Record<string, boolean> }>}
 */
export async function getCoachMarketplaceEligibility(coachId) {
  const id = Number(coachId);
  if (!Number.isFinite(id)) {
    return computeMarketplaceEligibilityFromSteps({});
  }

  const user = await User.findByPk(id, {
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  const roles = getEffectiveRolesForUserRecord(user);
  const activeCoach = Boolean(user && isPubliclyActiveUser(user) && roles.includes('coach'));

  const profile = await CoachProfile.findOne({
    where: { user_id: id, deleted_at: null },
  });
  const hasProfile = Boolean(profile) && activeCoach;

  // Court step: any non-deleted linked court counts — do NOT filter is_private.
  // is_private only hides courts from GET /api/courts; coaches who teach only at
  // discovery-hidden courts must still be marketplace-eligible / bookable.
  const [lessonCount, courtCount, availabilityCount] = await Promise.all([
    Lesson.count({ where: { coach_id: id, is_active: true, deleted_at: null } }),
    CoachCourtLocation.count({
      where: { coach_id: id },
      include: [
        {
          model: CourtLocation,
          as: 'court',
          where: { deleted_at: null },
          required: true,
        },
      ],
    }),
    CoachAvailability.count({ where: { coach_id: id } }),
  ]);

  return computeMarketplaceEligibilityFromSteps({
    profile: hasProfile,
    stripe: Boolean(profile?.stripe_ready),
    lesson: lessonCount > 0,
    court: courtCount > 0,
    availability: availabilityCount > 0,
  });
}

/**
 * Sequelize profile `where` fragment for marketplace discovery (DB-only).
 * Merge with skill/rating filters as needed.
 */
export function marketplaceDiscoveryProfileWhereBase() {
  return {
    deleted_at: null,
    stripe_ready: true,
  };
}

/**
 * Required includes so list query matches {@link getCoachMarketplaceEligibility}.
 * Caller may deepen `coachCourts.court.where` for geo bounding box.
 *
 * @param {{ courtWhere?: object, omitLessons?: boolean, filterOnly?: boolean }} [opts]
 *   - `omitLessons`: when listing from Lesson rows, skip nested lessons include
 *     (the outer active lesson already proves the lesson step).
 *   - `filterOnly`: empty `attributes` on join rows (eligibility gate without bloating payload).
 */
export function marketplaceDiscoveryIncludes(opts = {}) {
  // Default: any non-deleted court (public or discovery-hidden). Callers may add
  // geo bbox keys; must not require is_private: false or private-only coaches vanish.
  const courtWhere = opts.courtWhere || { deleted_at: null };
  const filterAttrs = opts.filterOnly ? { attributes: [] } : {};
  const includes = [
    {
      model: CoachCourtLocation,
      as: 'coachCourts',
      required: true,
      ...filterAttrs,
      include: [
        {
          model: CourtLocation,
          as: 'court',
          where: courtWhere,
          required: true,
          ...(opts.filterOnly ? { attributes: [] } : {}),
        },
      ],
    },
    {
      model: CoachAvailability,
      as: 'availabilities',
      required: true,
      attributes: [],
    },
  ];
  if (!opts.omitLessons) {
    includes.splice(1, 0, {
      model: Lesson,
      as: 'lessons',
      where: { is_active: true, deleted_at: null },
      required: true,
      attributes: [],
    });
  }
  return includes;
}

/**
 * Nested coach include for eligibility joins when listing from Lesson rows.
 * Prefer GET /api/coaches/:id/lessons for marketplace discovery (coach-first).
 * Nested join rows use empty attributes so the API coach payload stays id/name/avatar.
 */
export function marketplaceEligibleCoachIncludeForLessonBrowse() {
  return {
    model: User,
    as: 'coach',
    attributes: ['id', 'full_name', 'avatar_url'],
    where: { ...PUBLIC_ACTIVE_USER_WHERE },
    required: true,
    include: [
      {
        model: UserRole,
        as: 'userRoles',
        where: { role: 'coach' },
        required: true,
        attributes: [],
      },
      {
        model: CoachProfile,
        as: 'coachProfile',
        where: marketplaceDiscoveryProfileWhereBase(),
        required: true,
        attributes: [],
      },
      ...marketplaceDiscoveryIncludes({ omitLessons: true, filterOnly: true }),
    ],
  };
}

/** Re-export for callers that already import PUBLIC_ACTIVE_USER_WHERE from lifeicycle. */
export { PUBLIC_ACTIVE_USER_WHERE };
