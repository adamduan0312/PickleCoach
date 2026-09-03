/** Mirrors backend Joi limits in `backend/config/validation.js`. */
export const CHAR_LIMITS = {
  reviewComment: 1000,
  declineMessage: 500,
  declineMessageMin: 3,
  cancelNotes: 255,
  disputeNotes: 1000,
  messageText: 5000,
  coachHeadline: 255,
  courtName: 255,
  courtAddress: 255,
  courtCity: 100,
};

export function charCount(value) {
  return String(value ?? '').length;
}

export function charMaxHint(max) {
  return `${max.toLocaleString()} character maximum`;
}

export function charCounterLabel(value, max) {
  return `${charCount(value).toLocaleString()} / ${max.toLocaleString()}`;
}
