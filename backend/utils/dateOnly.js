/**
 * Plain calendar dates (YYYY-MM-DD) for coach availability and similar DATEONLY fields.
 * Avoid `Date` → `toISOString().slice(0, 10)` for user-supplied calendar days (timezone off-by-one).
 */

/** @param {unknown} v @returns {string | null} */
export function normalizeYmdString(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return null;
}

/**
 * Calendar date for an instant in an IANA timezone (for comparing to DATEONLY strings).
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {string} YYYY-MM-DD
 */
export function calendarDateInTimezone(date, timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Serialize a DATEONLY value from Sequelize/MySQL for JSON (stable YYYY-MM-DD).
 * @param {unknown} v
 * @returns {string | null}
 */
export function toYmdApi(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}
