/**
 * Coach–court `coach_notes` live on `coach_court_locations` only; POST /api/courts rejects `coach_notes` / legacy `notes`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { courtCreatePayloadRejectsCoachCourtFields } from '../utils/validateCourtCreatePayload.js';
import { parseCoachCourtLinkCoachNotesFromBody } from '../utils/coachCourtLinkNotes.js';

describe('courtCreatePayloadRejectsCoachCourtFields', () => {
  it('rejects when body has coach_notes key', () => {
    const r = courtCreatePayloadRejectsCoachCourtFields({ name: 'A', coach_notes: 'x' });
    assert.equal(r.rejected, true);
    assert.equal(r.message, 'coach_notes belongs to coach_court_locations, not court creation');
  });

  it('rejects legacy notes key on court create (including null)', () => {
    const r = courtCreatePayloadRejectsCoachCourtFields({ name: 'A', notes: null });
    assert.equal(r.rejected, true);
    assert.equal(r.message, 'coach_notes belongs to coach_court_locations, not court creation');
  });

  it('allows court-only payloads', () => {
    assert.equal(courtCreatePayloadRejectsCoachCourtFields({ name: 'A', latitude: 1 }).rejected, false);
    assert.equal(courtCreatePayloadRejectsCoachCourtFields({}).rejected, false);
  });
});

describe('parseCoachCourtLinkCoachNotesFromBody', () => {
  it('treats missing coach_notes key as not provided', () => {
    const r = parseCoachCourtLinkCoachNotesFromBody({ court_id: 1 });
    assert.equal(r.coachNotesProvided, false);
    assert.equal(r.coachNotes, null);
  });

  it('parses string coach_notes and trims', () => {
    const r = parseCoachCourtLinkCoachNotesFromBody({ court_id: 1, coach_notes: '  hi  ' });
    assert.equal(r.coachNotesProvided, true);
    assert.equal(r.coachNotes, 'hi');
  });

  it('maps empty string and null to null when key present', () => {
    assert.equal(parseCoachCourtLinkCoachNotesFromBody({ coach_notes: '' }).coachNotes, null);
    assert.equal(parseCoachCourtLinkCoachNotesFromBody({ coach_notes: null }).coachNotes, null);
  });
});
