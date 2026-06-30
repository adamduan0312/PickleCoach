/**
 * Sequelize `where` fragment for **public court discovery** only:
 * `GET /api/courts` and `GET /api/courts/:id`.
 *
 * Private courts (`is_private: true`) are not discoverable through these routes.
 * Coach-profile court lists, bookings, and admin tools must **not** use this helper.
 *
 * @param {Record<string, unknown>} [extra] - Additional where keys (e.g. `id`, geo bbox on `latitude` / `longitude`).
 * @returns {{ deleted_at: null, is_private: false } & Record<string, unknown>}
 */
export function publicCourtDirectoryWhere(extra = {}) {
  return { ...extra, deleted_at: null, is_private: false };
}
