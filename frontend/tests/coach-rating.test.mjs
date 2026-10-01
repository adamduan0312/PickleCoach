import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COACH_PROFILE_LIMITS,
  COACH_RATING_SYSTEMS,
  COACH_RATING_SYSTEM_VALUES,
  certificationList,
  coachProfileApiFieldErrors,
  coachProfileFormToPayload,
  coachProfileToForm,
  formatSkillRating,
  formatSkillRatingLine,
  ratingFieldCopy,
  ratingSwitchMessage,
  sanitizeRatingInput,
  sanitizeWholeNumberInput,
  skillFilterOptions,
  validateCoachProfileForm,
  validateSkillRatingForSystem,
} from '../src/domain/coachRating.js';
import { formatSkillRatingLine as formatSkillRatingLineFromUtils } from '../src/utils/format.js';
import * as backend from '../../backend/utils/coachRating.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const baseForm = () => coachProfileToForm({ headline: 'Coach', rating_system: 'DUPR', skill_rating: 4.217 });

test('coach rating rules match the backend exactly', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(COACH_RATING_SYSTEMS)), JSON.parse(JSON.stringify(backend.COACH_RATING_SYSTEMS)));
  assert.deepEqual([...COACH_RATING_SYSTEM_VALUES], [...backend.COACH_RATING_SYSTEM_VALUES]);
  const samples = ['2.000', '4.217', '7.218', '8.000', '1.999', '8.001', '4.2175', '1.0', '9.5', '10.0', '0.9', '10.1', '9.55', '4.', '.5', 'abc'];
  for (const system of ['DUPR', 'UTR-P', 'self', '']) {
    for (const v of samples) {
      assert.equal(validateSkillRatingForSystem(system, v), backend.validateSkillRatingForSystem(system, v), `${system} ${v}`);
    }
  }
});

test('DUPR accepts 2.000–8.000 with up to 3 decimals, rejects the rest', () => {
  for (const v of ['2.000', '3.500', '4.217', '7.218', '8.000', '4', '4.2']) assert.equal(validateSkillRatingForSystem('DUPR', v), null, v);
  for (const v of ['1.999', '8.001', '4.2175', '4.', '']) assert.ok(validateSkillRatingForSystem('DUPR', v), v);
});

test('UTR-P accepts 1.0–10.0 with 1 decimal, rejects the rest', () => {
  for (const v of ['1.0', '3.5', '4.5', '9.5', '10.0', '10']) assert.equal(validateSkillRatingForSystem('UTR-P', v), null, v);
  for (const v of ['0.9', '10.1', '9.55', '4.217']) assert.ok(validateSkillRatingForSystem('UTR-P', v), v);
});

test('display keeps each system’s precision and always names the system', () => {
  assert.equal(formatSkillRatingLine(4.217, 'DUPR'), 'DUPR 4.217');
  assert.equal(formatSkillRatingLine('7.218', 'DUPR'), 'DUPR 7.218');
  assert.equal(formatSkillRatingLine(4.5, 'DUPR'), 'DUPR 4.500');
  assert.equal(formatSkillRatingLine(9.5, 'UTR-P'), 'UTR-P 9.5');
  assert.equal(formatSkillRatingLine('9.500', 'UTR-P'), 'UTR-P 9.5');
  assert.equal(formatSkillRatingLine(10, 'UTR-P'), 'UTR-P 10.0');
  assert.equal(formatSkillRating(4.217, 'DUPR'), '4.217');
  // No bare numbers: missing/legacy systems render nothing.
  assert.equal(formatSkillRatingLine(4, 'self'), null);
  assert.equal(formatSkillRatingLine(4, null), null);
  assert.equal(formatSkillRatingLine(null, 'DUPR'), null);
  assert.equal(formatSkillRatingLineFromUtils, formatSkillRatingLine);
  const fmt = read('../src/utils/format.js');
  assert.doesNotMatch(fmt, /Self-reported|'self'|Skill \$\{/);
});

test('rating field copy per system', () => {
  assert.deepEqual(ratingFieldCopy('DUPR'), {
    label: 'DUPR rating (2.000–8.000)',
    hint: 'Enter your current DUPR rating.',
    placeholder: 'e.g. 4.217',
  });
  assert.deepEqual(ratingFieldCopy('UTR-P'), {
    label: 'UTR-P rating (1.0–10.0)',
    hint: 'Enter your current UTR-P rating.',
    placeholder: 'e.g. 9.5',
  });
});

test('input sanitization keeps precision and never rounds', () => {
  assert.equal(sanitizeRatingInput('4.2175'), '4.2175');
  assert.equal(sanitizeRatingInput('4.2.1'), '4.21');
  assert.equal(sanitizeRatingInput('1e3'), '13');
  assert.equal(sanitizeRatingInput('-4,5'), '45');
  assert.equal(sanitizeWholeNumberInput('12.5'), '125');
  assert.equal(sanitizeWholeNumberInput('1e2'), '12');
  assert.equal(sanitizeWholeNumberInput('-3'), '3');
});

test('form validation: rating, experience, headline, location', () => {
  assert.deepEqual(validateCoachProfileForm(baseForm()), {});
  assert.match(validateCoachProfileForm({ ...baseForm(), skill_rating: '4.2175' }).skill_rating, /up to 3 decimal places/);
  assert.match(validateCoachProfileForm({ ...baseForm(), skill_rating: '8.001' }).skill_rating, /between 2\.000 and 8\.000/);
  assert.match(validateCoachProfileForm({ ...baseForm(), skill_rating: '1.999' }).skill_rating, /between 2\.000 and 8\.000/);
  assert.deepEqual(validateCoachProfileForm({ ...baseForm(), rating_system: 'UTR-P', skill_rating: '10.0' }), {});
  assert.match(validateCoachProfileForm({ ...baseForm(), rating_system: 'UTR-P', skill_rating: '9.55' }).skill_rating, /1 decimal place/);
  assert.deepEqual(validateCoachProfileForm({ ...baseForm(), skill_rating: '' }), {});
  assert.ok(validateCoachProfileForm({ ...baseForm(), experience_years: '101' }).experience_years);
  assert.ok(validateCoachProfileForm({ ...baseForm(), experience_years: '2.5' }).experience_years);
  assert.deepEqual(validateCoachProfileForm({ ...baseForm(), experience_years: '100' }), {});
  assert.deepEqual(validateCoachProfileForm({ ...baseForm(), experience_years: '0' }), {});
  assert.ok(validateCoachProfileForm({ ...baseForm(), headline: 'x'.repeat(256) }).headline);
  assert.ok(validateCoachProfileForm({ ...baseForm(), location: 'x'.repeat(256) }).location);
  assert.equal(COACH_PROFILE_LIMITS.headline, 255);
  assert.equal(COACH_PROFILE_LIMITS.location, 255);
  assert.equal(COACH_PROFILE_LIMITS.experienceYearsMax, 100);
});

test('certifications: 500 characters per row, up to 20 rows, errors keyed by row', () => {
  assert.equal(COACH_PROFILE_LIMITS.certification, 500);
  assert.equal(COACH_PROFILE_LIMITS.certificationsMaxCount, 20);
  const ok = validateCoachProfileForm({ ...baseForm(), certifications: ['x'.repeat(500), ` ${'y'.repeat(500)} `] });
  assert.deepEqual(ok, {});
  const long = validateCoachProfileForm({ ...baseForm(), certifications: ['IPTPA', 'x'.repeat(501)] });
  assert.deepEqual(long, { 'certifications.1': 'Each certification must be 500 characters or fewer.' });
  const many = Array.from({ length: 21 }, (_, i) => `Cert ${i}`);
  assert.equal(validateCoachProfileForm({ ...baseForm(), certifications: many }).certifications, 'You can list up to 20 certifications.');
  const twentyPlusBlanks = [...many.slice(0, 20), '', '  '];
  assert.equal(validateCoachProfileForm({ ...baseForm(), certifications: twentyPlusBlanks }).certifications, undefined);
});

test('certifications: no certification is required; empty rows save as an empty list', () => {
  assert.deepEqual(coachProfileToForm(null).certifications, ['']);
  assert.deepEqual(coachProfileToForm({ certifications: [] }).certifications, ['']);
  assert.deepEqual(validateCoachProfileForm(coachProfileToForm(null)), {});
  assert.deepEqual(coachProfileFormToPayload({ ...baseForm(), certifications: ['', '  '] }).certifications, []);
});

test('certifications: rows round-trip as an array; names may contain commas', () => {
  const saved = ['IPTPA Certified', 'PPA Coach Certified', 'CPR / First Aid Certified', 'Level 1, Advanced'];
  const form = coachProfileToForm({ certifications: saved });
  assert.deepEqual(form.certifications, saved);
  assert.deepEqual(coachProfileFormToPayload(form).certifications, saved);
  assert.deepEqual(
    coachProfileFormToPayload({ ...form, certifications: [' IPTPA Certified ', '', 'iptpa certified', 'PPR'] }).certifications,
    ['IPTPA Certified', 'PPR'],
  );
});

test('certificationList: trims, drops blanks and duplicates, never splits', () => {
  assert.deepEqual(certificationList(['A, B', ' C ', '', 'c']), ['A, B', 'C']);
  assert.deepEqual(certificationList('IPTPA, PPA'), []);
  assert.deepEqual(certificationList(null), []);
  assert.deepEqual(certificationList([1, null, 'X']), ['X']);
});

test('API row errors (certifications.N) map onto the form', () => {
  const { fields, general } = coachProfileApiFieldErrors({
    details: [{ field: 'certifications.2', message: 'Each certification must be 500 characters or fewer.' }],
  });
  assert.deepEqual(fields, { 'certifications.2': 'Each certification must be 500 characters or fewer.' });
  assert.equal(general, null);
});

test('bio: 1,000-character limit (trimmed)', () => {
  assert.equal(COACH_PROFILE_LIMITS.bio, 1000);
  assert.equal(validateCoachProfileForm({ ...baseForm(), bio: 'x'.repeat(1000) }).bio, undefined);
  assert.equal(validateCoachProfileForm({ ...baseForm(), bio: ` ${'x'.repeat(1000)}\n` }).bio, undefined);
  assert.equal(validateCoachProfileForm({ ...baseForm(), bio: 'x'.repeat(1001) }).bio, 'Bio must be 1,000 characters or fewer.');
});

test('coach profile page: bio placeholder, max length, counter', () => {
  const src = read('../src/pages/coach/CoachProfileEditPage.jsx');
  assert.match(src, /placeholder="Tell students about your coaching experience, style, and what they can expect\."/);
  assert.match(src, /maxLength=\{COACH_PROFILE_LIMITS\.bio\}/);
  assert.match(src, /<CharacterCounter value=\{form\.bio\} max=\{COACH_PROFILE_LIMITS\.bio\}/);
});

test('public profile: About and Certifications are separate cards, in order', () => {
  const src = read('../src/pages/student/CoachPublicProfilePage.jsx');
  assert.doesNotMatch(src, /Certifications: \{profile\.certifications\}/);
  assert.match(src, /const certifications = certificationList\(profile\.certifications\);/);
  assert.match(src, /<h2>Certifications<\/h2>\s*<ul className="coach-certifications">/);
  const order = ['<h2>About</h2>', '<h2>Certifications</h2>', '<h2>Teaching locations</h2>', "'Book a lesson' : 'Lessons offered'", '<h2>What students say</h2>']
    .map((s) => src.indexOf(s));
  assert.ok(order.every((i) => i > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('coach profile page: certifications use repeatable rows, not comma-separated text', () => {
  const src = read('../src/pages/coach/CoachProfileEditPage.jsx');
  assert.match(src, /hint="List relevant coaching certifications or credentials\."/);
  assert.match(src, /<CertificationsInput[\s\S]*?value=\{form\.certifications\}[\s\S]*?maxLength=\{COACH_PROFILE_LIMITS\.certification\}[\s\S]*?maxCount=\{COACH_PROFILE_LIMITS\.certificationsMaxCount\}/);
  assert.doesNotMatch(src, /e\.g\. IPTPA Certified, PPA Coach Certified/);
  assert.match(src, /JSON\.stringify\(comparableForm\(form\)\) !== JSON\.stringify\(comparableForm\(initialForm\)\)/);

  const input = read('../src/components/ui/CertificationsInput.jsx');
  assert.match(input, /placeholder="Certification name"/);
  assert.match(input, /\+ Add certification/);
  assert.match(input, /const showRemove = name\.trim\(\) !== '' \|\| value\.length > 1;/);
  assert.match(input, /onChange\(next\.length \? next : \[''\]\)/);
  assert.match(input, /errors\[`certifications\.\$\{i\}`\]/);
  assert.match(input, /if \(e\.key !== 'Enter'\) return;\s*e\.preventDefault\(\);/);
});

test('switching systems with an incompatible value explains instead of changing it', () => {
  assert.match(ratingSwitchMessage('7.218', 'UTR-P'), /^7\.218 isn't a valid UTR-P rating\. Replace it with your UTR-P rating\. UTR-P ratings must be between 1\.0 and 10\.0/);
  assert.match(ratingSwitchMessage('9.5', 'DUPR'), /isn't a valid DUPR rating/);
});

test('payload trims text and preserves rating precision', () => {
  const body = coachProfileFormToPayload({
    ...baseForm(),
    headline: '  Coach  ',
    bio: ' Bio ',
    location: ' Miami ',
    certifications: [' PPR ', ''],
    experience_years: '7',
  });
  assert.deepEqual(body, {
    headline: 'Coach',
    bio: 'Bio',
    certifications: ['PPR'],
    location: 'Miami',
    rating_system: 'DUPR',
    skill_rating: 4.217,
    experience_years: 7,
  });
  assert.equal(JSON.stringify(coachProfileFormToPayload({ ...baseForm(), skill_rating: '7.218' })).includes('"skill_rating":7.218'), true);
  assert.equal(coachProfileFormToPayload({ ...baseForm(), rating_system: 'UTR-P', skill_rating: '9.5' }).skill_rating, 9.5);
  assert.equal(coachProfileFormToPayload({ ...baseForm(), skill_rating: '' }).skill_rating, null);
});

test('DUPR is the form default, but no rating system is saved without a rating', () => {
  const fresh = coachProfileToForm(null);
  assert.equal(fresh.rating_system, 'DUPR');
  assert.equal(fresh.skill_rating, '');
  const body = coachProfileFormToPayload(fresh);
  assert.equal(body.rating_system, null);
  assert.equal(body.skill_rating, null);
  assert.equal(coachProfileFormToPayload({ ...fresh, rating_system: 'UTR-P' }).rating_system, null);
  assert.equal(coachProfileFormToPayload({ ...fresh, skill_rating: '4.217' }).rating_system, 'DUPR');
});

test('existing profiles load into the form without losing precision; legacy self ratings are not carried over', () => {
  assert.equal(coachProfileToForm({ rating_system: 'DUPR', skill_rating: 4.217 }).skill_rating, '4.217');
  assert.equal(coachProfileToForm({ rating_system: 'UTR-P', skill_rating: 9.5 }).skill_rating, '9.5');
  const legacy = coachProfileToForm({ rating_system: 'self', skill_rating: 4 });
  assert.equal(legacy.skill_rating, '');
  assert.equal(legacy.rating_system, 'DUPR');
  assert.equal(coachProfileToForm(null).rating_system, 'DUPR');
});

test('API field errors map onto the form fields', () => {
  const { fields, general } = coachProfileApiFieldErrors({
    details: [
      { field: 'skill_rating', message: 'bad rating' },
      { field: 'rating_system', message: 'bad system' },
      { field: 'something_else', message: 'other' },
    ],
  });
  assert.deepEqual(fields, { skill_rating: 'bad rating', rating_system: 'bad system' });
  assert.equal(general, 'other');
});

test('coach profile page: system before rating, dynamic copy, field errors, unsaved guard, no self', () => {
  const src = read('../src/pages/coach/CoachProfileEditPage.jsx');
  assert.ok(src.indexOf('name="rating_system"') < src.indexOf('name="skill_rating"'));
  assert.match(src, /label=\{ratingCopy\.label\}/);
  assert.match(src, /placeholder=\{ratingCopy\.placeholder\}/);
  assert.match(src, /hint=\{ratingCopy\.hint\}/);
  assert.match(src, /inputMode="decimal"/);
  assert.doesNotMatch(src, /type="number"/);
  for (const f of ['headline', 'bio', 'experience_years', 'rating_system', 'skill_rating', 'certifications', 'location']) {
    assert.match(src, new RegExp(`error=\\{fieldErrors\\.${f}\\}`), f);
  }
  assert.match(src, /<CharacterCounter value=\{form\.headline\} max=\{CHAR_LIMITS\.coachHeadline\}/);
  assert.match(src, /const \{ allowNavigation \} = useUnsavedChangesGuard\(isDirty\);/);
  // Create → dashboard with a one-time flash; edit → stay, reset the saved baseline, confirm near Save.
  assert.match(src, /if \(creating\) \{\s*await coachesApi\.createProfile\(body\);\s*await refreshProfile\(\);\s*allowNavigation\(\);\s*navigate\('\/coach', \{ state: \{ flash: 'Profile created\.' \} \}\);/);
  assert.match(src, /await coachesApi\.updateMyProfile\(body\);\s*const fresh = await refreshProfile\(\);\s*const saved = coachProfileToForm\(fresh\?\.coachProfile\);\s*setForm\(saved\);\s*setInitialForm\(saved\);/);
  assert.match(src, /setMessage\('Profile saved\.'\);/);
  assert.equal((src.match(/navigate\(/g) || []).length, 1);
  assert.ok(src.indexOf("<Alert tone=\"success\">") > src.indexOf('<PlaceAutocomplete'), 'confirmation sits near Save');
  assert.match(src, /<Alert tone="success">\{message\}<\/Alert>/);
  assert.equal((src.match(/View public profile/g) || []).length, 1, 'only the persistent button, not in the save message');
  // Persistent link once a profile exists (not while creating); a normal Link, so the unsaved-changes guard applies.
  assert.match(src, /\{busy \? 'Saving…' : creating \? 'Save profile' : 'Save changes'\}/);
  assert.match(src, /\{!creating && user\?\.id \? \(\s*<Link className="btn secondary" to=\{`\/coaches\/\$\{user\.id\}`\}>View public profile<\/Link>/);

  const dash = read('../src/pages/coach/CoachDashboardPage.jsx');
  assert.match(dash, /const \[flash\] = useState\(\(\) => location\.state\?\.flash \|\| null\);/);
  assert.match(dash, /navigate\(`\$\{location\.pathname\}\$\{location\.search\}`, \{ replace: true, state: null \}\);/);
  assert.match(dash, /\{flash\}\{' '\}\s*\{user\?\.id \? <Link to=\{`\/coaches\/\$\{user\.id\}`\}>View public profile<\/Link> : null\}/);
  assert.match(src, /skill_rating: bad \? ratingSwitchMessage\(form\.skill_rating, system\) : undefined/);
  assert.doesNotMatch(src, /self|Self-reported|2\.0–6\.0|half steps/);
  assert.match(src, /label="Location \(Based in\)"/);
  assert.match(src, /hint="Choose a city and state or ZIP code\. This appears publicly as “Based in” and is separate from your teaching locations\."/);
  assert.match(src, /<PlaceAutocomplete\s+id="location"\s+value=\{form\.location\}\s+onChange=\{\(v\) => setField\('location', v\)\}/);
  assert.match(src, /placeholder="e\.g\. Davie, FL"/);
});

test('Discover: rating-system filter gates skill filtering; no 2.0–6.0 scale', () => {
  const src = read('../src/pages/student/DiscoverPage.jsx');
  assert.doesNotMatch(src, /SKILL_OPTIONS|'6\.0'/);
  assert.match(src, /<label htmlFor="rating_system">Rating system<\/label>/);
  assert.match(src, /<option value="">Any<\/option>\s*\{Object\.values\(COACH_RATING_SYSTEMS\)/);
  assert.match(src, /const SKILL_NEEDS_SYSTEM_HINT = 'Select a rating system to filter by skill\.';/);
  assert.match(src, /\{filters\.rating_system \? \(\s*<>/);
  assert.match(src, /if \(applied\.rating_system\) \{\s*params\.rating_system = applied\.rating_system;\s*if \(applied\.min_skill_rating\)/);
  assert.match(src, /rating_system: e\.target\.value,\s*min_skill_rating: '',\s*max_skill_rating: '',/);
  assert.match(src, /skillFilterOptions\(filters\.rating_system\)/);
});

test('Discover skill options stay on each system’s own scale', () => {
  const dupr = skillFilterOptions('DUPR');
  assert.equal(dupr[0], '2.0');
  assert.equal(dupr.at(-1), '8.0');
  const utrp = skillFilterOptions('UTR-P');
  assert.equal(utrp[0], '1.0');
  assert.equal(utrp.at(-1), '10.0');
  assert.deepEqual(skillFilterOptions(''), []);
});

test('no frontend source still offers self-reported ratings', () => {
  for (const rel of ['../src/utils/format.js', '../src/pages/student/DiscoverPage.jsx', '../src/pages/student/CoachPublicProfilePage.jsx', '../src/pages/coach/CoachProfileEditPage.jsx']) {
    assert.doesNotMatch(read(rel), /Self-reported|value="self"/, rel);
  }
});
