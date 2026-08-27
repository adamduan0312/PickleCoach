/**
 * GET /api/coaches?court_location_id= — browse coaches teaching at a court.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getCoachesQuerySchema } from '../config/validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coachControllerSrc = readFileSync(join(__dirname, '../controllers/coachController.js'), 'utf8');
const getCoachesSection = coachControllerSrc.slice(
  coachControllerSrc.indexOf('export const getCoaches'),
  coachControllerSrc.indexOf('export const getCoachById'),
);

describe('getCoachesQuerySchema court_location_id', () => {
  it('accepts court_location_id alone', () => {
    const { error, value } = getCoachesQuerySchema.validate(
      { court_location_id: '15' },
      { convert: true, abortEarly: false },
    );
    assert.equal(error, undefined);
    assert.equal(value.court_location_id, 15);
  });

  it('accepts court_location_id with geo and rating filters', () => {
    const { error, value } = getCoachesQuerySchema.validate(
      {
        court_location_id: 15,
        lat: 25.7,
        lng: -80.2,
        radius: 10,
        min_rating: 4,
      },
      { convert: true, abortEarly: false },
    );
    assert.equal(error, undefined);
    assert.equal(value.court_location_id, 15);
    assert.equal(value.min_rating, 4);
  });

  it('defaults radius to 25 miles when omitted (launch sparse-market default)', () => {
    const { error, value } = getCoachesQuerySchema.validate(
      { lat: 25.7, lng: -80.2 },
      { convert: true, abortEarly: false },
    );
    assert.equal(error, undefined);
    assert.equal(value.radius, 25);
  });

  it('rejects non-positive court_location_id', () => {
    const { error } = getCoachesQuerySchema.validate(
      { court_location_id: 0 },
      { convert: true, abortEarly: false },
    );
    assert.ok(error);
  });
});

describe('getCoaches court_location_id wiring', () => {
  it('reads court_location_id and scopes courtWhere.id after existence check', () => {
    assert.match(getCoachesSection, /court_location_id/);
    assert.match(getCoachesSection, /courtWhere\.id\s*=\s*court_location_id/);
    assert.match(getCoachesSection, /Court not found/);
    assert.match(getCoachesSection, /deleted_at:\s*null/);
  });

  it('allows coach role to browse marketplace (same public cards as students)', () => {
    assert.match(getCoachesSection, /roles\.includes\('coach'\)/);
    assert.doesNotMatch(getCoachesSection, /Only students and admins can search/);
  });
});
