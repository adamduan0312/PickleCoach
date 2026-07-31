/**
 * Lesson API response DTOs — purpose-driven shapes per audience.
 *
 * Do not reuse one broad serializer across marketplace, owner, admin, and detail.
 * Booking embeds continue to use {@link serializeLessonSummary} in bookingDto.js.
 *
 * Note: Lesson model has `updatedAt: false` — never expose `updated_at`.
 */

export const PUBLIC_MARKETPLACE_LESSON_FIELDS = [
  'id',
  'coach_id',
  'title',
  'description',
  'duration_minutes',
  'price',
  'effective_hourly_rate',
  'max_students',
];

export const COACH_OWNER_LESSON_FIELDS = [
  'id',
  'coach_id',
  'title',
  'description',
  'duration_minutes',
  'price',
  'effective_hourly_rate',
  'max_students',
  'is_active',
  'created_at',
];

export const ADMIN_LESSON_FIELDS = [
  'id',
  'coach_id',
  'title',
  'description',
  'duration_minutes',
  'price',
  'effective_hourly_rate',
  'max_students',
  'is_active',
  'deleted_at',
  'created_at',
];

export const LESSON_DETAIL_FIELDS = [
  'id',
  'coach_id',
  'title',
  'description',
  'duration_minutes',
  'price',
  'effective_hourly_rate',
  'max_students',
  'is_active',
  'deleted_at',
  'created_at',
];

/** Nested coach on admin list / admin lesson detail. */
export const ADMIN_LESSON_COACH_FIELDS = [
  'id',
  'full_name',
  'email',
  'is_active',
  'deleted_at',
];

function toPlain(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  if (typeof row.toJSON === 'function') return row.toJSON();
  return { ...row };
}

function pickFields(plain, fieldNames) {
  const dto = {};
  for (const key of fieldNames) {
    if (plain[key] !== undefined) dto[key] = plain[key];
  }
  return dto;
}

function serializeAdminLessonCoach(coach) {
  if (!coach) return null;
  return pickFields(toPlain(coach), ADMIN_LESSON_COACH_FIELDS);
}

/**
 * Student marketplace card — bookable offering only.
 * Used by GET /api/coaches/:id/lessons and GET /api/coaches/:id lesson embed.
 * No lifecycle fields (`is_active`, `deleted_at`, timestamps). No nested coach
 * (parent coach resource already identifies ownership; list includes `coach_id`).
 */
export function serializePublicMarketplaceLesson(lesson) {
  if (!lesson) return null;
  return pickFields(toPlain(lesson), PUBLIC_MARKETPLACE_LESSON_FIELDS);
}

/**
 * Coach dashboard inventory — GET /api/coaches/me/lessons, POST/PUT /api/lessons.
 * Includes inactive; no nested coach (caller is the owner).
 */
export function serializeCoachOwnerLesson(lesson) {
  if (!lesson) return null;
  return pickFields(toPlain(lesson), COACH_OWNER_LESSON_FIELDS);
}

/**
 * Admin inventory row — GET /api/admin/lessons.
 * Nested coach includes email + account status for ownership context.
 */
export function serializeAdminLesson(lesson) {
  if (!lesson) return null;
  const plain = toPlain(lesson);
  const dto = pickFields(plain, ADMIN_LESSON_FIELDS);
  if (plain.coach !== undefined) {
    dto.coach = serializeAdminLessonCoach(plain.coach);
  }
  return dto;
}

/**
 * GET /api/lessons/:id — owner coach or admin.
 * Owner: management fields only (no nested coach).
 * Admin: same fields + nested coach (email + account status). No bookings embed.
 *
 * @param {object} lesson
 * @param {{ viewerIsAdmin?: boolean }} [opts]
 */
export function serializeLessonDetail(lesson, { viewerIsAdmin = false } = {}) {
  if (!lesson) return null;
  const plain = toPlain(lesson);
  const dto = pickFields(plain, LESSON_DETAIL_FIELDS);
  if (viewerIsAdmin) {
    dto.coach = serializeAdminLessonCoach(plain.coach);
  }
  return dto;
}
