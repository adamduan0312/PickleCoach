/**
 * POST /api/courts must only accept court entity fields.
 * Coach-specific text on the coach–court link belongs on POST /api/coaches/me/courts (`coach_notes`).
 * Reject legacy `notes` on this route as well (wrong layer / old clients).
 * Reject legacy free-text `address` (use structured address_line1/city/state/postal_code).
 */
const FORBIDDEN_COURT_CREATE_COACH_LINK_KEYS = ['coach_notes', 'notes'];

export function courtCreatePayloadRejectsCoachCourtFields(body) {
  if (body == null) {
    return { rejected: false };
  }
  for (const key of FORBIDDEN_COURT_CREATE_COACH_LINK_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return {
        rejected: true,
        message: 'coach_notes belongs to coach_court_locations, not court creation',
      };
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'address')) {
    return {
      rejected: true,
      message:
        'Use structured address fields (address_line1, city, state, postal_code); free-text address is not accepted',
    };
  }
  return { rejected: false };
}
