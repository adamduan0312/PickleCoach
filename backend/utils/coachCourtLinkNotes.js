/**
 * Optional `coach_notes` on POST /api/coaches/me/courts (coach_court_locations only).
 * Coach-specific notes about this coach–court relationship (not court directory data).
 */
export function parseCoachCourtLinkCoachNotesFromBody(body) {
  if (body == null || !Object.prototype.hasOwnProperty.call(body, 'coach_notes')) {
    return { coachNotesProvided: false, coachNotes: null };
  }
  const raw = body.coach_notes;
  if (raw == null) {
    return { coachNotesProvided: true, coachNotes: null };
  }
  if (typeof raw === 'string' && raw.trim() === '') {
    return { coachNotesProvided: true, coachNotes: null };
  }
  const s = String(raw).trim();
  return { coachNotesProvided: true, coachNotes: s || null };
}
