import test from 'node:test';
import assert from 'node:assert/strict';
import { coachIsFavoritable } from '../utils/favoriteCoachEligibility.js';

const coach = (overrides = {}) => ({
  id: 2,
  is_active: true,
  deleted_at: null,
  role_governance_locked: false,
  userRoles: [{ role: 'coach' }],
  coachProfile: { deleted_at: null },
  ...overrides,
});

test('an active coach with a live profile can be favorited', () => {
  assert.equal(coachIsFavoritable(coach()), true);
});

test('deleted, suspended, non-coach, and profile-less accounts cannot be favorited', () => {
  assert.equal(coachIsFavoritable(null), false);
  assert.equal(coachIsFavoritable(coach({ deleted_at: new Date() })), false);
  assert.equal(coachIsFavoritable(coach({ is_active: false })), false);
  assert.equal(coachIsFavoritable(coach({ userRoles: [{ role: 'student' }] })), false);
  assert.equal(coachIsFavoritable(coach({ userRoles: [] })), false);
  assert.equal(coachIsFavoritable(coach({ coachProfile: null })), false);
  assert.equal(coachIsFavoritable(coach({ coachProfile: { deleted_at: new Date() } })), false);
});
