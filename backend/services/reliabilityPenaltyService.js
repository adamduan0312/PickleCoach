/**
 * Reliability Penalty Service
 *
 * Classifies cancellation reasons as excused or unexcused. The excused categories are published
 * in product copy (frontend/src/domain/cancellationPolicy.js mirrors NON_PENALIZED_REASONS);
 * per-row `affects_reliability` flags stay out of list/detail payloads (see sanitizeResponse).
 */

/** Excused — no reliability impact (uncontrollable circumstances). */
const NON_PENALIZED_REASONS = [
  'weather',
  'emergency',
  'sickness',
];

/** Unexcused — reliability impact (controllable circumstances). */
const PENALIZED_REASONS = [
  'travel_delay',
  'schedule_conflict',
  'forgot',
  'other',
];

export const affectsReliability = (reason) => {
  if (!reason) {
    return true;
  }

  if (NON_PENALIZED_REASONS.includes(reason)) {
    return false;
  }

  if (PENALIZED_REASONS.includes(reason)) {
    return true;
  }

  return true;
};

export const getValidReasons = () => {
  return [...NON_PENALIZED_REASONS, ...PENALIZED_REASONS];
};

export const isValidReason = (reason) => {
  return getValidReasons().includes(reason);
};

/**
 * Sanitize cancellation history for list/detail APIs (omit internal reliability flag).
 * Cancel responses use `buildCancellationApiPayload` instead.
 */
export const sanitizeResponse = (record) => {
  if (!record) return record;

  const plain = record.toJSON ? record.toJSON() : record;
  const { affects_reliability, ...sanitized } = plain;

  return sanitized;
};
