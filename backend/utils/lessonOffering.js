/**
 * Lesson offering rules shared by validation and the lesson controller.
 *
 * `lesson_type` / `max_players` describe the offering only. A group lesson is still
 * booked and paid by one student (booking.primary_student_id), who may bring friends;
 * it never adds participants or booking capacity.
 */

export const LESSON_TYPES = Object.freeze(['private', 'group']);
export const GROUP_MAX_PLAYERS_MIN = 2;
export const GROUP_MAX_PLAYERS_MAX = 12;

export const LESSON_TITLE_MIN = 3;
export const LESSON_TITLE_MAX = 255;
export const LESSON_DESCRIPTION_MAX = 1000;
export const LESSON_DURATION_MIN = 15;
export const LESSON_DURATION_MAX = 480;
export const LESSON_PRICE_MAX_USD = 1000;

/** True when `value` has at most two decimal places (cents). */
export function hasCentsPrecision(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

/**
 * Resolve the stored lesson_type / max_players after a create or partial update.
 * Private always stores max_players = null. Group requires a max_players value.
 *
 * @param {{ lesson_type?: string, max_players?: number|null }} input validated body
 * @param {{ lesson_type?: string, max_players?: number|null } | null} existing current row (updates)
 * @returns {{ ok: true, lesson_type: string, max_players: number|null }
 *   | { ok: false, field: 'max_players', message: string }}
 */
export function resolveLessonOffering(input = {}, existing = null) {
  const lessonType = input.lesson_type ?? existing?.lesson_type ?? 'private';
  if (lessonType === 'private') {
    return { ok: true, lesson_type: 'private', max_players: null };
  }
  const maxPlayers = input.max_players !== undefined
    ? input.max_players
    : (existing?.lesson_type === 'group' ? existing.max_players : null);
  if (maxPlayers == null) {
    return {
      ok: false,
      field: 'max_players',
      message: `Enter the maximum number of players for a group lesson (${GROUP_MAX_PLAYERS_MIN}–${GROUP_MAX_PLAYERS_MAX}).`,
    };
  }
  return { ok: true, lesson_type: 'group', max_players: maxPlayers };
}
