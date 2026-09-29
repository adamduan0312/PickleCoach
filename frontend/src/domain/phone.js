/**
 * Phone validation mirrored from the backend `phoneSchema`:
 * digits with optional leading +, spaces, dashes, dots, parentheses; 7–15 digits.
 */

const ALLOWED = /^\+?[\d\s().-]+$/;

/** Characters a user may type into a phone field; `+` survives only as the first character. */
export function sanitizePhoneInput(value) {
  const cleaned = String(value || '').replace(/[^\d\s()+.-]/g, '');
  const leadingPlus = cleaned.trimStart().startsWith('+');
  const rest = cleaned.replace(/\+/g, '');
  return leadingPlus ? `+${rest.trimStart()}` : rest;
}

/**
 * @param {string|null|undefined} value
 * @returns {string|null} error message, or null when valid (empty is valid — phone is optional)
 */
export function validatePhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (!ALLOWED.test(trimmed)) {
    return 'Phone number can only contain digits, spaces, and + ( ) - .';
  }
  const digits = trimmed.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return 'Enter a valid phone number (7–15 digits).';
  return null;
}
