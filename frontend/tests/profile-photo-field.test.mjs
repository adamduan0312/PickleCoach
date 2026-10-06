import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const field = read('../src/components/ui/ProfilePhotoField.jsx');
const settings = read('../src/pages/settings/SettingsPage.jsx');
const coachProfile = read('../src/pages/coach/CoachProfileEditPage.jsx');
const dashboard = read('../src/pages/coach/CoachDashboardPage.jsx');
const publicProfile = read('../src/pages/student/CoachPublicProfilePage.jsx');
const backendUpload = read('../../backend/middleware/avatarUpload.js');

test('ProfilePhotoField: account-level photo, immediate upload/remove, limits match the backend', () => {
  assert.match(field, /authApi\.uploadAvatar\(file\)/);
  assert.match(field, /authApi\.removeAvatar\(\)/);
  assert.match(field, /await refreshProfile\(\);/);
  assert.match(field, /src=\{user\?\.avatar_url\}/);
  assert.match(field, /'image\/jpeg,image\/png,image\/webp'/);
  assert.match(field, /up to 2 MB/);
  assert.match(backendUpload, /MAX_AVATAR_BYTES = 2 \* 1024 \* 1024/);
  assert.match(read('../../backend/utils/avatarStorage.js'), /ALLOWED_MIME = new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
  // Buttons never submit the surrounding form.
  assert.equal((field.match(/type="submit"/g) || []).length, 0);
  assert.equal((field.match(/type="button"/g) || []).length, 2);
});

test('Settings and Coach Profile both use the shared field (no duplicate upload code)', () => {
  for (const src of [settings, coachProfile]) {
    assert.match(src, /import \{ ProfilePhotoField \} from '\.\.\/\.\.\/components\/ui\/ProfilePhotoField\.jsx';/);
    assert.match(src, /<ProfilePhotoField/);
    assert.doesNotMatch(src, /uploadAvatar|removeAvatar/);
  }
});

test('Coach Profile: photo sits at the top of the form, before Headline, and stays out of the profile save', () => {
  const form = coachProfile.indexOf('<form');
  const photo = coachProfile.indexOf('<ProfilePhotoField');
  const headline = coachProfile.indexOf('label="Headline *"');
  assert.ok(form < photo && photo < headline);
  assert.match(coachProfile, /Students see this before booking\./);
  assert.doesNotMatch(read('../src/domain/coachRating.js'), /avatar/);
});

test('profile photo is part of the Coach profile step (no separate step); the gallery is not required', () => {
  assert.doesNotMatch(read('../src/domain/coachSetup.js'), /photo: \{/);
  const eligibility = read('../../backend/services/coachMarketplaceEligibility.js');
  assert.doesNotMatch(eligibility, /hasProfilePhoto|photo: /);
  const rules = eligibility.slice(
    eligibility.indexOf('export async function getCoachMarketplaceEligibility'),
    eligibility.indexOf('export function marketplaceDiscoveryIncludes'),
  );
  assert.match(rules, /coachProfileStepMissing\(profile, user\?\.avatar_url\)/);
  assert.doesNotMatch(rules, /CoachPhoto/, 'gallery photos are not counted');
});

test('dashboard: optional coaching-gallery nudge (profile photo is now in the required checklist)', () => {
  assert.match(dashboard, /\{galleryCount === 0 \? \(\s*<div className="card coach-optional-photo">/);
  assert.match(dashboard, /<strong>Add coaching photos<\/strong>/);
  assert.match(dashboard, /<Link className="btn secondary" to="\/coach\/profile#coaching-photos">Add photos →<\/Link>/);
  assert.doesNotMatch(dashboard, /Add a profile photo/);
  assert.doesNotMatch(dashboard, /more (profile )?views|more bookings/i);
});

test('owner preview: a missing profile photo is listed with the other setup steps, not as a separate tip', () => {
  const banner = publicProfile.slice(publicProfile.indexOf('coach-preview-banner'), publicProfile.indexOf('coach-profile-hero'));
  assert.match(banner, /Finish setup:/);
  assert.doesNotMatch(banner, /Add a photo/);
});
