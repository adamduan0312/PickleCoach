import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COACH_DASHBOARD_RELIABILITY_NOTE,
  COACH_DASHBOARD_RELIABILITY_NOTE_UNLISTED,
  COACH_OWN_RELIABILITY_HINT,
  PUBLIC_COACH_RELIABILITY_HINT,
} from '../src/domain/reliabilitySelfServe.js';
import { BENEFITS_INTRO } from '../src/domain/platformBenefits.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ALL = [PUBLIC_COACH_RELIABILITY_HINT, COACH_OWN_RELIABILITY_HINT, COACH_DASHBOARD_RELIABILITY_NOTE].join('\n');

test('reliability explanations say what the score means, not how it is calculated', () => {
  assert.equal(
    PUBLIC_COACH_RELIABILITY_HINT,
    'Reliability scores help indicate how consistently someone follows through on bookings. Missed lessons and other booking-related behavior may affect a score.',
  );
  assert.equal(
    COACH_OWN_RELIABILITY_HINT,
    'Your reliability score reflects how consistently you follow through on bookings. Missed lessons and other booking-related behavior may affect your score.',
  );
  assert.doesNotMatch(ALL, /sick|emergenc|weather|exempt|point|percent|formula|cancel/i);
  assert.doesNotMatch(ALL, /verif|identity|qualif|background/i, 'score is not a verification signal');
});

test('coach profile shows an info icon beside the score; Discover keeps a hover hint inside its card link', () => {
  const profile = read('../src/pages/student/CoachPublicProfilePage.jsx');
  assert.match(profile, /<InfoTip label="What reliability scores mean">\{formatReliabilityHint\(\)\}<\/InfoTip>/);
  assert.match(read('../src/pages/student/DiscoverPage.jsx'), /<li title=\{formatReliabilityHint\(\)\}>/);
});

test('coach dashboard shows own score with info icon and a link to Settings', () => {
  const dash = read('../src/pages/coach/CoachDashboardPage.jsx');
  const order = ['{!listed ? checklist : null}', '{market ? <CoachReliabilitySummary listed={listed} /> : null}', '{!listed ? photoPrompt : null}', '<HowBookingsWorkGuide', '<h2>Incoming requests</h2>']
    .map((needle) => dash.indexOf(needle));
  assert.ok(order.every((i) => i >= 0), 'dashboard sections present');
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'listing checklist → reliability → photos → how bookings work → incoming requests');
  assert.match(COACH_DASHBOARD_RELIABILITY_NOTE_UNLISTED, /^Once you’re listed/);
  const summary = read('../src/components/coach/CoachReliabilitySummary.jsx');
  assert.match(summary, /<InfoTip label="What your reliability score means">\{COACH_OWN_RELIABILITY_HINT\}<\/InfoTip>/);
  assert.match(summary, /to="\/settings#reliability"/);
  assert.match(read('../src/components/settings/ReliabilitySelfServeCard.jsx'), /window\.location\.hash === '#reliability'/);
});

test('info tip is keyboard and touch accessible', () => {
  const src = read('../src/components/ui/InfoTip.jsx');
  assert.match(src, /type="button"/);
  assert.match(src, /aria-label=\{label\}/);
  assert.match(src, /role="tooltip"/);
  assert.match(src, /onFocus=/);
  assert.match(src, /'Escape'/);
});

test('benefits intro no longer implies vetted coaches', () => {
  assert.equal(BENEFITS_INTRO, 'Compare coaches, keep your bookings organized, and understand your options if plans change.');
  assert.doesNotMatch(BENEFITS_INTRO, /trusted/i);
});
