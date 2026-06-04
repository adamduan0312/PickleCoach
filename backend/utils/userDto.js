/**
 * User DTO layer — all user-shaped HTTP responses MUST go through these serializers.
 * Never return Sequelize models, `user.toJSON()`, or DB-shaped blobs to clients.
 *
 * **Roles vs `role_state` (admin + auth):**
 * - **`roles` in auth/session/profile serializers** = **effective** permissions (governance-filtered); same values as `authorize()` for that user.
 * - **`roles` in admin list/detail** = persisted **`user_roles`** (assignment / audit); pair with **`role_state`**, whose `effective_roles` is what gates runtime access.
 *
 * @see serializeAuthProfileUser — GET /api/auth/profile
 * @see serializeAuthSessionUser — login / register / refresh / change-password session user
 * @see serializeCoachReliabilityDetail — GET /api/coaches/me/reliability
 * @see serializeAdminUserList / serializeAdminUserDetail — GET /api/users, GET /api/users/:id
 */

import {
  effectiveRolesFromGovernance,
  serializeRoleState,
} from './roleGovernance.js';

const int = (v) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? x : 0;
};

const dec = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
};

function mapUserRoles(user, plain) {
  const rows = user.userRoles || plain.userRoles || [];
  return rows.map((r) => (r && typeof r.get === 'function' ? r.get('role') : r?.role)).filter(Boolean);
}

/**
 * Minimal reliability surface for auth + admin user APIs (no scoring-engine parameters).
 * Coach-facing detail (more fields, still no engine internals): **`GET /api/coaches/me/reliability`**
 * via **`serializeCoachReliabilityDetail`**. Full audit payload: **`GET /api/admin/users/:id/reliability`**.
 * @param {object} row — UserReliability instance or plain row
 */
export function serializeReliabilitySummary(row) {
  if (!row) return null;
  const r = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
  return {
    reliability_score: dec(r.reliability_score) ?? 100,
    total_bookings: int(r.total_bookings_recent),
    late_cancels: int(r.late_cancels_recent),
    no_shows: int(r.no_shows_recent),
    misconduct_penalties: int(r.misconduct_penalties_recent),
    late_arrival_penalties: int(r.late_arrival_penalties_recent),
  };
}

/**
 * GET /api/coaches/me/reliability — coach-facing reliability detail (no DB/engine internals).
 * @param {object} payload — coach `user_reliability` plain object after `attachLegacyReliabilityAliases` (recent-window counters on aliased keys).
 */
export function serializeCoachReliabilityDetail(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload;
  const lastUpdated =
    p.last_updated != null && p.last_updated !== ''
      ? new Date(p.last_updated).toISOString()
      : null;
  const scoreSrc =
    typeof p.score_source === 'string' && p.score_source.trim() !== ''
      ? p.score_source
      : 'computed';
  return {
    reliability_score: dec(p.reliability_score) ?? 100,
    score_source: scoreSrc,
    total_bookings: int(p.total_bookings),
    reschedules: int(p.reschedules),
    late_cancels: int(p.late_cancels),
    no_shows: int(p.no_shows),
    late_arrival_penalties: int(p.late_arrival_penalties),
    misconduct_penalties: int(p.misconduct_penalties),
    lesson_not_completed_penalties: int(p.lesson_not_completed_penalties),
    coach_cancels: int(p.coach_cancels),
    student_cancels_non_late: int(p.student_cancels_non_late),
    last_updated: lastUpdated,
  };
}

/** Whitelisted coach_profiles fields for API consumers */
export function serializeCoachProfilePublic(profile) {
  if (!profile) return null;
  const p = profile.get ? profile.get({ plain: true }) : { ...profile };
  return {
    id: p.id,
    user_id: p.user_id,
    headline: p.headline ?? null,
    bio: p.bio ?? null,
    experience_years: p.experience_years ?? null,
    skill_rating: p.skill_rating != null ? Number(p.skill_rating) : null,
    rating_system: p.rating_system ?? null,
    certifications: p.certifications ?? null,
    location: p.location ?? null,
    rating_average: p.rating_average != null ? Number(p.rating_average) : null,
    rating_count: p.rating_count ?? null,
    coach_commission_percent: p.coach_commission_percent != null ? Number(p.coach_commission_percent) : null,
    stripe_account_id: p.stripe_account_id ?? null,
    deleted_at: p.deleted_at ?? null,
    created_at: p.created_at ?? null,
  };
}

/**
 * GET /api/auth/profile — self-service profile (no auth tokens, no recovery fields).
 * @param {import('sequelize').Model} user — User with userRoles, optional coachProfile & reliabilities
 */
export function serializeAuthProfileUser(user) {
  const u = user.get ? user.get({ plain: true }) : { ...user };
  const rolesRaw = mapUserRoles(user, u);
  const roles = effectiveRolesFromGovernance(rolesRaw, user);

  const out = {
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    avatar_url: u.avatar_url ?? null,
    phone: u.phone ?? null,
    phone_verified: Boolean(u.phone_verified),
    timezone: u.timezone ?? null,
    is_active: Boolean(u.is_active),
    email_verified_at: u.email_verified_at ?? null,
    created_at: u.created_at ?? null,
    last_login: u.last_login ?? null,
    roles,
    role_state: serializeRoleState(user, roles),
    coachProfile: serializeCoachProfilePublic(user.coachProfile),
  };

  const relRows = user.reliabilities || [];
  const coachRel = relRows.find((r) => (r.get ? r.get('role') : r.role) === 'coach');
  const studentRel = relRows.find((r) => (r.get ? r.get('role') : r.role) === 'student');
  if (roles.includes('coach') && coachRel) {
    out.reliability = serializeReliabilitySummary(coachRel);
  }
  if (roles.includes('student') && studentRel) {
    out.reliability_student = serializeReliabilitySummary(studentRel);
  }

  return out;
}

/**
 * Embedded `user` in login / register / refresh / change-password / email-change responses.
 * @param {import('sequelize').Model} user
 */
export function serializeAuthSessionUser(user) {
  const u = user.get ? user.get({ plain: true }) : { ...user };
  const rolesRaw = mapUserRoles(user, u);
  const roles = effectiveRolesFromGovernance(rolesRaw, user);
  return {
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    roles,
    role_state: serializeRoleState(user, roles),
    phone: u.phone ?? null,
    phone_verified: Boolean(u.phone_verified),
    timezone: u.timezone ?? null,
    avatar_url: u.avatar_url ?? null,
    email_verified_at: u.email_verified_at ?? null,
    is_active: Boolean(u.is_active),
  };
}

/** @param {import('sequelize').Model} user */
export function serializeAdminUserList(user) {
  const u = user.get ? user.get({ plain: true }) : { ...user };
  const roles = mapUserRoles(user, u);
  const effective = effectiveRolesFromGovernance(roles, user);
  return {
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    avatar_url: u.avatar_url ?? null,
    phone: u.phone ?? null,
    phone_verified: Boolean(u.phone_verified),
    timezone: u.timezone ?? null,
    roles,
    role_state: serializeRoleState(user, effective),
    is_active: Boolean(u.is_active),
    deleted_at: u.deleted_at ?? null,
    email_verified_at: u.email_verified_at ?? null,
    created_at: u.created_at ?? null,
    last_login: u.last_login ?? null,
  };
}

/** Back-compat alias */
export const serializeAdminUserListItem = serializeAdminUserList;

/**
 * GET /api/users/:id — admin detail; stripe_customer_id for payment/support ops.
 * @param {import('sequelize').Model} user
 */
export function serializeAdminUserDetail(user) {
  const u = user.get ? user.get({ plain: true }) : { ...user };
  const roles = mapUserRoles(user, u);
  const effective = effectiveRolesFromGovernance(roles, user);

  const relRows = user.reliabilities || [];
  const coachRel = relRows.find((r) => (r.get ? r.get('role') : r.role) === 'coach');
  const studentRel = relRows.find((r) => (r.get ? r.get('role') : r.role) === 'student');

  const payload = {
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    avatar_url: u.avatar_url ?? null,
    phone: u.phone ?? null,
    phone_verified: Boolean(u.phone_verified),
    timezone: u.timezone ?? null,
    is_active: Boolean(u.is_active),
    deleted_at: u.deleted_at ?? null,
    email_verified_at: u.email_verified_at ?? null,
    created_at: u.created_at ?? null,
    last_login: u.last_login ?? null,
    stripe_customer_id: u.stripe_customer_id ?? null,
    roles,
    role_state: serializeRoleState(user, effective),
    coachProfile: serializeCoachProfilePublic(user.coachProfile),
  };

  if (effective.includes('coach') && coachRel) {
    payload.reliability = serializeReliabilitySummary(coachRel);
  }
  if (effective.includes('student') && studentRel) {
    payload.reliability_student = serializeReliabilitySummary(studentRel);
  }

  return payload;
}
