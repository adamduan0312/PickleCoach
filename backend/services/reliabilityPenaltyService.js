/**
 * Hidden Reliability Penalty Service
 * 
 * This service contains server-side-only logic for classifying reschedule
 * and cancellation reasons as penalized or non-penalized.
 * 
 * ⚠️ IMPORTANT: This logic must NEVER be exposed to the frontend.
 * The frontend only sees the reason enum values, never the penalty classification.
 */

/**
 * Non-penalized reasons (do not affect reliability score)
 * These are uncontrollable circumstances
 */
const NON_PENALIZED_REASONS = [
  'weather',
  'emergency',
  'sickness',
];

/**
 * Penalized reasons (affect reliability score)
 * These are controllable circumstances
 */
const PENALIZED_REASONS = [
  'travel_delay',
  'schedule_conflict',
  'forgot',
  'other',
];

/**
 * Determine if a reason affects reliability
 * 
 * @param {string} reason - The reason enum value
 * @returns {boolean} - true if reason should affect reliability, false otherwise
 */
export const affectsReliability = (reason) => {
  if (!reason) {
    // If no reason provided, default to penalized (shouldn't happen if validation works)
    return true;
  }

  // Non-penalized reasons do not affect reliability
  if (NON_PENALIZED_REASONS.includes(reason)) {
    return false;
  }

  // Penalized reasons affect reliability
  if (PENALIZED_REASONS.includes(reason)) {
    return true;
  }

  // Default to penalized for unknown reasons
  return true;
};

/**
 * Get all valid reason enum values
 * Useful for validation schemas
 * 
 * @returns {string[]} - Array of valid reason enum values
 */
export const getValidReasons = () => {
  return [...NON_PENALIZED_REASONS, ...PENALIZED_REASONS];
};

/**
 * Check if a reason is valid
 * 
 * @param {string} reason - The reason to validate
 * @returns {boolean} - true if reason is valid
 */
export const isValidReason = (reason) => {
  return getValidReasons().includes(reason);
};

/**
 * Sanitize reschedule/cancellation response to remove penalty classification
 * This ensures affects_reliability is never sent to the frontend
 * 
 * @param {Object} record - RescheduleHistory or CancellationHistory record
 * @returns {Object} - Sanitized record without affects_reliability
 */
export const sanitizeResponse = (record) => {
  if (!record) return record;

  // Convert to plain object if it's a Sequelize instance
  const plain = record.toJSON ? record.toJSON() : record;
  
  // Remove affects_reliability from the response
  const { affects_reliability, ...sanitized } = plain;
  
  return sanitized;
};

