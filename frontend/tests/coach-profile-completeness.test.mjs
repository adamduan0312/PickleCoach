import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as frontend from '../src/domain/coachProfileCompleteness.js';
import * as backend from '../../backend/utils/coachProfileCompleteness.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const COMPLETE = {
  headline: 'Patient coach for beginners',
  bio: 'I have coached pickleball for six years and focus on footwork and dinks.',
  location: 'Davie, FL',
};

const CASES = [
  [null, ['headline', 'bio', 'location']],
  [{}, ['headline', 'bio', 'location']],
  [COMPLETE, []],
  [{ ...COMPLETE, headline: 'Too short' }, ['headline']],
  [{ ...COMPLETE, headline: '   1234567890   ' }, []],
  [{ ...COMPLETE, bio: 'x'.repeat(49) }, ['bio']],
  [{ ...COMPLETE, bio: `  ${'x'.repeat(50)}  ` }, []],
  [{ ...COMPLETE, location: '   ' }, ['location']],
  [{ ...COMPLETE, location: null }, ['location']],
  [{ headline: 'Short', bio: null, location: 'Miami, FL' }, ['headline', 'bio']],
];

test('frontend and backend completeness rules match', () => {
  assert.equal(frontend.COACH_HEADLINE_MIN, backend.COACH_HEADLINE_MIN);
  assert.equal(frontend.COACH_BIO_MIN, backend.COACH_BIO_MIN);
  assert.deepEqual([...frontend.COACH_PROFILE_REQUIRED_FIELDS], [...backend.COACH_PROFILE_REQUIRED_FIELDS]);
  for (const [profile, expected] of CASES) {
    assert.deepEqual(frontend.coachProfileMissingFields(profile), expected, JSON.stringify(profile));
    assert.deepEqual(backend.coachProfileMissingFields(profile), expected, JSON.stringify(profile));
    assert.equal(frontend.isCoachProfileComplete(profile), expected.length === 0 && profile != null);
    assert.equal(backend.isCoachProfileComplete(profile), expected.length === 0 && profile != null);
  }
});

test('minimums are 10 (headline) and 50 (bio)', () => {
  assert.equal(frontend.COACH_HEADLINE_MIN, 10);
  assert.equal(frontend.COACH_BIO_MIN, 50);
});

test('incomplete-profile copy lists only what is missing', () => {
  assert.equal(
    frontend.incompleteProfileMessage(['headline', 'bio', 'location']),
    'Add a headline, bio, and location to make your profile ready for students.',
  );
  assert.equal(frontend.incompleteProfileMessage(['location', 'headline']), 'Add a headline and location to make your profile ready for students.');
  assert.equal(frontend.incompleteProfileMessage(['bio']), 'Add a bio to make your profile ready for students.');
  assert.equal(frontend.incompleteProfileMessage([]), null);
});

test('profile form: required markers, minimum hints, draft save allowed with a not-ready notice', () => {
  const src = read('../src/pages/coach/CoachProfileEditPage.jsx');
  assert.match(src, /label="Headline \*"/);
  assert.match(src, /label="Bio \*"/);
  assert.match(src, /label="Location \(Based in\) \*"/);
  assert.doesNotMatch(src, /label="Experience \(years\) \*"/);
  assert.doesNotMatch(src, /label="Certifications \*"/);
  assert.match(src, /\* Required before students can see your profile\. You can save a draft and finish later\./);
  assert.match(src, /hint=\{COACH_PROFILE_REQUIREMENT_HINTS\.headline\}/);
  assert.match(src, /hint=\{COACH_PROFILE_REQUIREMENT_HINTS\.bio\}/);
  assert.match(src, /coachProfileMissingFields\(fresh\?\.coachProfile\)/);
  assert.match(src, /<Alert tone="warning">\{incompleteNotice\}<\/Alert>/);
});

test('client validation does not block saving a draft with blank required fields', async () => {
  const { validateCoachProfileForm } = await import('../src/domain/coachRating.js');
  const errors = validateCoachProfileForm({
    headline: '', bio: '', experience_years: '', rating_system: 'DUPR', skill_rating: '', certifications: [''], location: '',
  });
  assert.deepEqual(errors, {});
});
