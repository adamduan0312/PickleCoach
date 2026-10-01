/**
 * Coach certifications: a plain list of names (no issuer, dates, or verification).
 * Stored as a JSON array of strings, or NULL when the coach lists none.
 */

export const COACH_CERTIFICATION_MAX_LENGTH = 500;
export const COACH_CERTIFICATIONS_MAX_COUNT = 20;

/**
 * Trims names, drops blank rows, and removes case-insensitive duplicates (first spelling wins).
 * @param {unknown[]} list
 * @returns {string[]}
 */
export function normalizeCertificationList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** Value to persist: normalized array, or null for "no certifications". */
export function certificationsForStorage(list) {
  const names = normalizeCertificationList(list);
  return names.length ? names : null;
}

/**
 * API shape: always an array. A non-array legacy string (pre-migration row) becomes a single
 * entry as-is — it is never split on delimiters.
 * @returns {string[]}
 */
export function certificationsFromStored(value) {
  if (Array.isArray(value)) return normalizeCertificationList(value);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}
