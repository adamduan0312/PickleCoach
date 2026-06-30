/**
 * Hidden Reliability Penalty Service
 *
 * Server-side-only logic for classifying cancellation reasons as excused or unexcused.
 *
 * ⚠️ IMPORTANT: This logic must NEVER be exposed to the frontend.
 * The frontend only sees the reason enum values, never the penalty classification.
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
