/**
 * Cancellation API payload — timing classification separate from financial penalty_reason.
 */

/** @typedef {'late' | 'non_late'} CancellationType */

/**
 * @param {boolean} isLateCancel
 * @returns {CancellationType}
 */
export function cancellationTypeFromIsLate(isLateCancel) {
  return isLateCancel ? 'late' : 'non_late';
}

/**
 * Build `data.cancellation` for POST .../cancel responses.
 *
 * `affects_reliability` means the cancel qualifies for reliability scoring — not a guaranteed
 * score deduction or a specific point amount (see API_ENDPOINTS cancel response docs).
 *
 * @param {object} cancellationHistory — Sequelize model or plain row
 * @param {{ isLateCancel: boolean }} options
 */
export function buildCancellationApiPayload(cancellationHistory, { isLateCancel }) {
  if (!cancellationHistory) return null;

  const plain = cancellationHistory.toJSON
    ? cancellationHistory.toJSON()
    : { ...cancellationHistory };

  return {
    id: plain.id,
    booking_id: plain.booking_id,
    cancelled_by: plain.cancelled_by,
    cancellation_type: cancellationTypeFromIsLate(isLateCancel),
    affects_reliability: Boolean(plain.affects_reliability),
    reason: plain.reason ?? null,
    reason_notes: plain.reason_notes ?? null,
    refund_amount: plain.refund_amount,
    penalty_amount: plain.penalty_amount,
    penalty_reason: plain.penalty_reason ?? null,
    cancelled_at: plain.cancelled_at,
  };
}
