/**
 * Availability response DTO — explicit fields only (no Sequelize spread).
 */

const AVAILABILITY_FIELD_NAMES = [
  'id',
  'coach_id',
  'weekday',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'created_at',
];

function toYmdApi(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function toPlain(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  if (typeof row.toJSON === 'function') return row.toJSON();
  return { ...row };
}

/**
 * Stable availability row for coach/student availability APIs.
 */
export function serializeAvailability(row) {
  if (!row) return null;
  const plain = toPlain(row);
  const dto = {};
  for (const key of AVAILABILITY_FIELD_NAMES) {
    if (plain[key] !== undefined) dto[key] = plain[key];
  }
  dto.start_date = toYmdApi(plain.start_date);
  dto.end_date = toYmdApi(plain.end_date);
  return dto;
}
