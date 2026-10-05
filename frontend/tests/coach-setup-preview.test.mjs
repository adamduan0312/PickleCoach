import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coachSetupView, missingSetupSteps, ownProfileLessonPreview, setupContinuation } from '../src/domain/coachSetup.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const NONE = { profile: false, lesson: false, court: false, availability: false, stripe: false };

test('missingSetupSteps uses the dashboard order (payouts last) and links each step', () => {
  assert.deepEqual(missingSetupSteps(['stripe', 'availability']), [
    { key: 'availability', label: 'Availability', to: '/coach/availability' },
    { key: 'stripe', label: 'Payouts', to: '/coach/stripe' },
  ]);
  assert.deepEqual(missingSetupSteps(['unknown']), []);
  assert.deepEqual(missingSetupSteps(undefined), []);
});

test('own profile, not listed: preview own active lessons with what is missing', () => {
  const view = ownProfileLessonPreview({
    marketplaceLessons: [],
    ownLessons: [
      { id: 1, title: 'Active', is_active: true },
      { id: 2, title: 'Inactive', is_active: false },
    ],
    status: { listed: false, missing: ['stripe', 'availability'] },
  });
  assert.equal(view.preview, true);
  assert.deepEqual(view.lessons.map((l) => l.id), [1]);
  assert.deepEqual(view.missing.map((s) => s.label), ['Availability', 'Payouts']);
});

test('new coach: next step is the profile; payouts disabled until a profile exists', () => {
  const { checklist, next } = coachSetupView(NONE, { coachUiPhase: 'start_setup' });
  assert.deepEqual(checklist.map((i) => i.label), ['Coach profile', 'First lesson', 'Teaching court', 'Availability', 'Payouts']);
  assert.ok(checklist.every((i) => !i.done));
  assert.deepEqual(checklist.map((i) => i.disabled), [false, false, false, false, true]);
  assert.equal(checklist[4].hint, 'Create your profile first');
  assert.deepEqual(
    { title: next.title, detail: next.detail, cta: next.cta, to: next.to },
    { title: 'Create your coach profile', detail: 'Build the basic profile students see before booking.', cta: 'Start setup', to: '/coach/profile' },
  );
});

test('draft profile: checklist stays ○, next step asks to complete it, payouts unlocked', () => {
  const { checklist, next } = coachSetupView(NONE, {
    coachUiPhase: 'connect_stripe',
    profileExists: true,
    profileMissingFields: ['headline', 'bio', 'location'],
  });
  assert.equal(checklist[0].done, false);
  assert.equal(checklist[4].disabled, false);
  assert.deepEqual(
    { title: next.title, detail: next.detail, cta: next.cta, to: next.to },
    {
      title: 'Complete your coach profile',
      detail: 'Add a headline, bio, and location to make your profile ready for students.',
      cta: 'Complete profile',
      to: '/coach/profile',
    },
  );
  const onlyBio = coachSetupView(NONE, { profileExists: true, profileMissingFields: ['bio'] }).next;
  assert.equal(onlyBio.detail, 'Add a bio to make your profile ready for students.');
  // Status without field detail still gets sensible copy.
  assert.match(coachSetupView(NONE, { profileExists: true }).next.detail, /headline, bio, and location/);
});

test('next step walks profile → lesson → court → availability → payouts', () => {
  const at = (done) => coachSetupView({ ...NONE, ...done }, { coachUiPhase: 'connect_stripe' }).next;
  assert.equal(at({ profile: true }).title, 'Add your first lesson');
  assert.equal(at({ profile: true }).to, '/coach/lessons');
  assert.equal(at({ profile: true, lesson: true }).title, 'Add a teaching court');
  assert.equal(at({ profile: true, lesson: true, court: true }).title, 'Set your availability');
  const pay = at({ profile: true, lesson: true, court: true, availability: true });
  assert.deepEqual([pay.title, pay.cta, pay.to], ['Set up payouts', 'Connect payouts', '/coach/stripe']);
  // Earlier gaps win even if later steps are done.
  assert.equal(at({ profile: true, court: true, availability: true, stripe: true }).title, 'Add your first lesson');
  // Payouts no longer disabled once a profile exists.
  assert.equal(coachSetupView({ ...NONE, profile: true }).checklist[4].disabled, false);
});

test('payout step reuses readiness phases; listed coach has no next step', () => {
  const almost = { profile: true, lesson: true, court: true, availability: true, stripe: false };
  assert.equal(coachSetupView(almost, { coachUiPhase: 'complete_stripe' }).next.title, 'Finish payout setup');
  assert.equal(coachSetupView(almost, { coachUiPhase: 'connect_stripe' }).next.title, 'Set up payouts');
  const all = coachSetupView({ ...almost, stripe: true }, { coachUiPhase: 'ready' });
  assert.equal(all.next, null);
  assert.ok(all.checklist.every((i) => i.done && !i.disabled));
});

test('setup view counts progress; continuation appears once a page’s own step is done', () => {
  const view = coachSetupView({ ...NONE, profile: true, court: true });
  assert.equal(view.doneCount, 2);
  assert.equal(view.total, 5);

  assert.equal(setupContinuation('lesson', { ...NONE, profile: true }), null);
  const afterProfile = setupContinuation('profile', { ...NONE, profile: true }, { coachUiPhase: 'connect_stripe' });
  assert.equal(afterProfile.doneLabel, 'Profile complete');
  assert.deepEqual([afterProfile.next.title, afterProfile.next.cta, afterProfile.next.to], ['Add your first lesson', 'Go to Lessons', '/coach/lessons']);
  const afterLesson = setupContinuation('lesson', { ...NONE, profile: true, lesson: true });
  assert.equal(afterLesson.doneLabel, 'Lesson complete');
  assert.equal(afterLesson.next.title, 'Add a teaching court');
  // Earlier gaps still win: payouts done first points back to the lesson.
  assert.equal(setupContinuation('stripe', { ...NONE, profile: true, stripe: true }).next.title, 'Add your first lesson');
  const all = { profile: true, lesson: true, court: true, availability: true, stripe: true };
  assert.deepEqual(setupContinuation('availability', all), { doneLabel: 'Availability complete', next: null });
});

test('dashboard: one "Get listed on Discover" card replaces Next step + Marketplace status', () => {
  const src = read('../src/pages/coach/CoachDashboardPage.jsx');
  assert.match(src, /coachSetupView\(setupSteps, \{\s*coachUiPhase: readiness\.coachUiPhase,/);
  assert.match(src, /profileExists: market\?\.profile_exists \?\? readiness\.coachUiPhase !== 'start_setup'/);
  assert.match(src, /profileMissingFields: market\?\.profile_missing_fields/);
  assert.match(src, /<CoachOnboardingCard\s+listed=\{listed\}/);
  assert.doesNotMatch(src, /Marketplace status/);
  assert.doesNotMatch(src, /coach-next-step"/);
  // Unlisted: onboarding first on the page; listed: short confirmation further down.
  assert.ok(src.indexOf('{!listed ? onboarding : null}') < src.indexOf('<HowBookingsWorkGuide'));
  assert.ok(src.indexOf('{listed ? onboarding : null}') > src.indexOf('<DashboardReminders'));

  const card = read('../src/components/coach/CoachOnboarding.jsx');
  assert.match(card, />Get listed on Discover</);
  assert.match(card, /Complete these \{total\} steps so students can find and book you\./);
  assert.match(card, /<strong>\{doneCount\} of \{total\}<\/strong> complete/);
  assert.match(card, /role="progressbar"/);
  assert.match(card, /<h3>Next: \{next\.title\}<\/h3>/);
  assert.match(card, /<Link className="btn" to=\{next\.to\}>\{next\.cta\} →<\/Link>/);
  assert.match(card, /<Link to=\{item\.to\}>/);
  assert.match(card, /You’re ready to be discovered! ✓/);
  assert.match(card, /Your coach profile can now appear in Discover\./);
  assert.match(card, />Refresh<\/button>/);
});

test('each setup page offers the next step once its own step is done', () => {
  for (const [file, step] of [
    ['CoachProfileEditPage.jsx', 'profile'],
    ['CoachLessonsPage.jsx', 'lesson'],
    ['CoachCourtsPage.jsx', 'court'],
    ['CoachAvailabilityPage.jsx', 'availability'],
    ['StripeConnectPage.jsx', 'stripe'],
  ]) {
    const src = read(`../src/pages/coach/${file}`);
    assert.match(src, new RegExp(`<SetupNextStep step="${step}"`), file);
  }
  const card = read('../src/components/coach/CoachOnboarding.jsx');
  assert.match(card, /if \(!status \|\| listedAtLoad\) return null;/, 'already-listed coaches are not nagged');
});

test('own profile, listed (or status unknown): normal marketplace lessons, no preview', () => {
  const marketplaceLessons = [{ id: 9 }];
  assert.deepEqual(
    ownProfileLessonPreview({ marketplaceLessons, ownLessons: [{ id: 1 }], status: { listed: true, missing: [] } }),
    { preview: false, lessons: marketplaceLessons },
  );
  assert.deepEqual(
    ownProfileLessonPreview({ marketplaceLessons, ownLessons: [{ id: 1 }], status: null }),
    { preview: false, lessons: marketplaceLessons },
  );
});

test('public profile page: preview is owner-only; students keep the listed-only rule', () => {
  const src = read('../src/pages/student/CoachPublicProfilePage.jsx');
  assert.match(src, /isOwnProfile \? coachesApi\.myLessons\(\)/);
  assert.match(src, /isOwnProfile \? coachesApi\.marketplaceStatus\(\)/);
  assert.match(src, /: \{ preview: false, lessons: marketplaceLessons \};/);
  assert.match(src, /<strong>Your public profile preview<\/strong>/);
  assert.match(src, /Students won’t see your lessons until you’re listed\./);
  assert.match(src, /Finish setup:/);
  assert.match(src, /Hidden from students/);
  assert.match(src, /title="No bookable lessons" detail="This coach is not currently offering marketplace lessons\."/);
});
