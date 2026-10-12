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

test('profile step = profile photo + required fields, same on both sides', () => {
  assert.deepEqual([...frontend.COACH_PROFILE_STEP_FIELDS], ['photo', 'headline', 'bio', 'location']);
  assert.deepEqual([...frontend.COACH_PROFILE_STEP_FIELDS], [...backend.COACH_PROFILE_STEP_FIELDS]);
  const STEP_CASES = [
    [COMPLETE, '/uploads/avatars/7.jpg', []],
    [COMPLETE, null, ['photo']],
    [COMPLETE, '   ', ['photo']],
    [{ ...COMPLETE, bio: '' }, '', ['photo', 'bio']],
    [null, '/uploads/avatars/7.jpg', ['headline', 'bio', 'location']],
    [null, undefined, ['photo', 'headline', 'bio', 'location']],
  ];
  for (const [profile, avatar, expected] of STEP_CASES) {
    assert.deepEqual(frontend.coachProfileStepMissing(profile, avatar), expected);
    assert.deepEqual(backend.coachProfileStepMissing(profile, avatar), expected);
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
  assert.equal(frontend.incompleteProfileMessage(['photo']), 'Add a profile photo to make your profile ready for students.');
  assert.equal(frontend.incompleteProfileMessage(['bio', 'photo']), 'Add a profile photo and bio to make your profile ready for students.');
  assert.equal(
    frontend.incompleteProfileMessage(['photo', 'headline', 'bio', 'location']),
    'Add a profile photo, headline, bio, and location to make your profile ready for students.',
  );
});

test('filled-in but too-short headline/bio asks to lengthen them, not add them', () => {
  const short = { headline: 'Adam Dua', bio: 'Profile restored fo discovery after test-flow re', location: 'New York' };
  assert.equal(
    frontend.incompleteProfileMessage(['headline', 'bio'], short),
    'To make your profile ready for students, lengthen your headline (at least 10 characters) and bio (at least 50 characters).',
  );
  assert.equal(
    frontend.incompleteProfileMessage(['bio'], short),
    'To make your profile ready for students, lengthen your bio to at least 50 characters.',
  );
  assert.equal(
    frontend.incompleteProfileMessage(['photo', 'bio', 'location'], { headline: 'Doubles strategy coach', bio: 'Short bio', location: '' }),
    'To make your profile ready for students, add a profile photo and location, and lengthen your bio to at least 50 characters.',
  );
  assert.equal(
    frontend.incompleteProfileMessage(['headline', 'bio'], { headline: '  ', bio: null }),
    'Add a headline and bio to make your profile ready for students.',
  );
  const page = read('../src/pages/coach/CoachProfileEditPage.jsx');
  assert.match(page, /incompleteProfileMessage\(stepMissing, existing\)/);
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
  assert.match(src, /label="Profile photo \*"/);
  // Live: uploading the photo after saving updates the notice without another save.
  assert.match(src, /coachProfileStepMissing\(existing, user\?\.avatar_url\)/);
  assert.match(src, /<Alert tone="warning">\{incompleteNotice\}<\/Alert>/);
});

test('client validation does not block saving a draft with blank required fields', async () => {
  const { validateCoachProfileForm } = await import('../src/domain/coachRating.js');
  const errors = validateCoachProfileForm({
    headline: '', bio: '', experience_years: '', rating_system: 'DUPR', skill_rating: '', certifications: [''], location: '',
  });
  assert.deepEqual(errors, {});
});
