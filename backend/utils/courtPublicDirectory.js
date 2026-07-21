/**
 * Sequelize `where` fragment for **public court discovery** only:
 * `GET /api/courts` and `GET /api/courts/:id`.
 *
 * `is_private` is a discovery flag, not a permissions flag. Courts with
 * `is_private: true` are hidden from this shared directory only — they remain
 * usable on coach profiles, marketplace eligibility, and booking.
 * Coach-profile court lists, bookings, and admin tools must **not** use this helper.
 *
 * @param {Record<string, unknown>} [extra] - Additional where keys (e.g. `id`, geo bbox on `latitude` / `longitude`).
 * @returns {{ deleted_at: null, is_private: false } & Record<string, unknown>}
 */
export function publicCourtDirectoryWhere(extra = {}) {
  return { ...extra, deleted_at: null, is_private: false };
}
