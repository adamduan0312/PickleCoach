import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coachSetupView, missingSetupSteps, ownProfileLessonPreview } from '../src/domain/coachSetup.js';

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
    { title: 'Create your coach profile', detail: 'You have the coach role, but no profile yet.', cta: 'Start setup', to: '/coach/profile' },
  );
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

test('dashboard: one reusable Next step card + clickable checklist, no separate button row', () => {
  const src = read('../src/pages/coach/CoachDashboardPage.jsx');
  assert.match(src, /coachSetupView\(setupSteps, \{ coachUiPhase: readiness\.coachUiPhase \}\)/);
  assert.match(src, /\{setup\?\.next \? \(/);
  assert.match(src, /<Link className="btn" to=\{setup\.next\.to\}>\{setup\.next\.cta\}<\/Link>/);
  assert.match(src, /<Link to=\{item\.to\}>/);
  assert.doesNotMatch(src, /coachUiPhase === 'start_setup' \? \(/);
  assert.doesNotMatch(src, /STEP_LABELS/);
  for (const label of ['>Profile<', '>Lessons<', '>Courts<', '>Availability<', '>Payouts<']) {
    assert.ok(!src.includes(label), `button row removed: ${label}`);
  }
  assert.match(src, />Refresh<\/button>/);
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
