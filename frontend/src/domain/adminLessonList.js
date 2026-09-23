/**
 * Admin Lessons inventory organization.
 *
 * Lessons are offerings, not bookings — no booking lifecycle states.
 *
 * tabs/groups: All active states / Active / Inactive (+ optional Include deleted)
 * primary hierarchy (All): Active → Inactive → Deleted (when included)
 * secondary sort: created_at DESC
 * relevant timestamp: created_at
 */

function ms(value) {
  if (value == null || value === '') return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function createdAtMs(lesson) {
  const t = ms(lesson?.created_at);
  return Number.isFinite(t) ? t : 0;
}

/**
 * @returns {0|1|2}
 */
export function adminLessonInventoryGroup(lesson) {
  if (lesson?.deleted_at) return 2;
  if (lesson?.is_active === false || lesson?.is_active === 0) return 1;
  return 0;
}

export function sortAdminLessonsForList(lessons) {
  if (!Array.isArray(lessons) || lessons.length < 2) return lessons || [];

  return [...lessons].sort((a, b) => {
    const ga = adminLessonInventoryGroup(a);
    const gb = adminLessonInventoryGroup(b);
    if (ga !== gb) return ga - gb;
    return createdAtMs(b) - createdAtMs(a);
  });
}

export function adminLessonsListHint(lessons, { isActive = '', includeDeleted = false } = {}) {
  const rows = Array.isArray(lessons) ? lessons : [];
  const n = rows.length;
  if (n === 0) return '';

  if (isActive === 'true') {
    return `${n} active lesson${n === 1 ? '' : 's'} · newest created first`;
  }
  if (isActive === 'false') {
    return `${n} inactive lesson${n === 1 ? '' : 's'} · newest created first`;
  }
  if (includeDeleted) {
    return `${n} lesson${n === 1 ? '' : 's'} · active → inactive → deleted · newest created first`;
  }
  return `${n} lesson${n === 1 ? '' : 's'} · active → inactive · newest created first`;
}
