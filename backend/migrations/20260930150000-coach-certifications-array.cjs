'use strict';

/**
 * coach_profiles.certifications: one free-text string → JSON array of names (NULL = none).
 *
 * Legacy strings were typed as comma/semicolon/line-separated lists, so this one-time conversion
 * splits on those delimiters, trims, drops blanks and case-insensitive duplicates.
 * Blank strings and empty arrays become NULL. Rows that are already arrays are normalized in place.
 */

function legacyToList(value) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;\n]+/) : [];
  const seen = new Set();
  const out = [];
  for (const raw of source) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().slice(0, 500);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out.length ? out : null;
}

function parseStored(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      'SELECT id, certifications FROM coach_profiles WHERE certifications IS NOT NULL',
    );
    for (const row of rows) {
      const list = legacyToList(parseStored(row.certifications));
      await queryInterface.sequelize.query('UPDATE coach_profiles SET certifications = ? WHERE id = ?', {
        replacements: [list ? JSON.stringify(list) : null, row.id],
      });
    }
  },

  /** Joins lists back into a comma-separated string (names containing commas cannot round-trip). */
  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      'SELECT id, certifications FROM coach_profiles WHERE certifications IS NOT NULL',
    );
    for (const row of rows) {
      const value = parseStored(row.certifications);
      const text = Array.isArray(value) ? value.join(', ') : value;
      await queryInterface.sequelize.query('UPDATE coach_profiles SET certifications = ? WHERE id = ?', {
        replacements: [text ? JSON.stringify(text) : null, row.id],
      });
    }
  },
};
