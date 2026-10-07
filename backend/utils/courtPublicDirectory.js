/**
 * Sequelize `where` fragment for the shared court directory:
 * `GET /api/courts` and `GET /api/courts/:id`.
 *
 * @param {Record<string, unknown>} [extra] - Additional where keys (e.g. `id`, geo bbox on `latitude` / `longitude`).
 * @returns {{ deleted_at: null } & Record<string, unknown>}
 */
export function publicCourtDirectoryWhere(extra = {}) {
  return { ...extra, deleted_at: null };
}
