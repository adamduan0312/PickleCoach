/**
 * POST /api/courts must only accept court entity fields.
 * Coach-specific text on the coach–court link belongs on POST /api/coaches/me/courts (`coach_notes`).
 * Reject legacy `notes` on this route as well (wrong layer / old clients).
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
  return { rejected: false };
}
