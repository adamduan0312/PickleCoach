import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backLinkTarget, BACK_DESTINATIONS, GENERIC_BACK_LABEL } from '../src/utils/backNavigation.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const fallback = { fallbackTo: '/discover', fallbackLabel: 'Back to Discover' };

test('backLinkTarget: allowlisted backTo with history goes Back and names the page', () => {
  assert.deepEqual(backLinkTarget({ state: { backTo: '/coach/profile' }, historyIdx: 3, ...fallback }), {
    kind: 'history', href: '/coach/profile', label: 'Back to coach profile',
  });
  assert.deepEqual(backLinkTarget({ state: { backTo: '/coach' }, historyIdx: 1, ...fallback }), {
    kind: 'history', href: '/coach', label: 'Back to dashboard',
  });
});

test('backLinkTarget: allowlisted backTo without history links to that page (no loop)', () => {
  assert.deepEqual(backLinkTarget({ state: { backTo: '/coach/profile' }, historyIdx: 0, ...fallback }), {
    kind: 'link', href: '/coach/profile', label: 'Back to coach profile',
  });
});

test('backLinkTarget: unknown or hostile backTo is ignored', () => {
  for (const backTo of ['https://evil.example', '//evil.example', '/admin/users', 'javascript:alert(1)', '/coach/../x', 42, null, '__proto__', 'constructor']) {
    const withHistory = backLinkTarget({ state: { backTo }, historyIdx: 2, ...fallback });
    assert.deepEqual(withHistory, { kind: 'history', href: '/discover', label: GENERIC_BACK_LABEL });
    const direct = backLinkTarget({ state: { backTo }, historyIdx: 0, ...fallback });
    assert.deepEqual(direct, { kind: 'link', href: '/discover', label: 'Back to Discover' });
  }
});

test('backLinkTarget: in-app history goes Back with a generic label; direct opens use the fallback', () => {
  assert.equal(backLinkTarget({ state: null, historyIdx: 5, ...fallback }).kind, 'history');
  assert.equal(backLinkTarget({ state: null, historyIdx: 5, ...fallback }).label, 'Back');
  for (const historyIdx of [0, undefined, null, -1, 1.5, '2']) {
    assert.deepEqual(backLinkTarget({ state: undefined, historyIdx, ...fallback }), {
      kind: 'link', href: '/discover', label: 'Back to Discover',
    });
  }
});

test('BACK_DESTINATIONS is a frozen allowlist of internal paths', () => {
  assert.ok(Object.isFrozen(BACK_DESTINATIONS));
  for (const path of Object.keys(BACK_DESTINATIONS)) assert.match(path, /^\/[a-z/]*$/);
});

test('BackLink: history clicks use navigate(-1) and leave modified clicks to the browser', () => {
  const s = src('components/ui/BackLink.jsx');
  assert.match(s, /navigate\(-1\)/);
  assert.match(s, /metaKey/);
  assert.match(s, /window\.history\.state\?\.idx/);
});

test('the three pages use BackLink with their safe fallbacks', () => {
  assert.match(src('pages/student/CoachPublicProfilePage.jsx'), /<BackLink fallbackTo="\/discover" fallbackLabel="Back to Discover" \/>/);
  assert.match(src('pages/coach/CoachLessonsPage.jsx'), /<BackLink fallbackTo="\/coach" fallbackLabel="Back to dashboard" \/>/);
  assert.match(src('pages/bookings/BookingDetailPage.jsx'), /<BackLink fallbackTo=\{admin \? '\/admin\/bookings' : \(isCoach \? '\/coach\/bookings' : '\/bookings'\)\} fallbackLabel="Back to list" \/>/);
});

test('"View public profile" entry points name where Back returns to', () => {
  assert.match(src('pages/coach/CoachProfileEditPage.jsx'), /state=\{\{ backTo: '\/coach\/profile' \}\}>View public profile/);
  assert.match(src('pages/coach/CoachDashboardPage.jsx'), /state=\{\{ backTo: '\/coach' \}\}>View public profile/);
  assert.match(src('components/coach/CoachOnboarding.jsx'), /state=\{\{ backTo: '\/coach' \}\}>View public profile/);
});

test('Discover history state: saves per entry, restores validated search, ignores junk', async () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const { readDiscoverEntry, writeDiscoverEntry } = await import('../src/utils/discoverHistoryState.js');

  const loc = { lat: 26.1, lng: -80.2, label: 'Davie, FL', source: 'search' };
  const filters = { rating_system: 'dupr', min_skill_rating: '3', max_skill_rating: '', radius: '10' };
  writeDiscoverEntry('k1', { filters, applied: { ...filters, location: loc }, location: loc, locationQuery: 'Davie' });

  assert.deepEqual(readDiscoverEntry('k1'), {
    filters, applied: { ...filters, location: loc }, location: loc, locationQuery: 'Davie',
  });
  assert.equal(readDiscoverEntry('other'), null);
  assert.equal(readDiscoverEntry(undefined), null);

  writeDiscoverEntry('k2', { filters, applied: { ...filters, location: null }, location: null, locationQuery: '' });
  assert.equal(readDiscoverEntry('k2'), null, 'no applied search -> normal first-visit setup');

  writeDiscoverEntry('k3', { filters: { radius: 5 }, applied: { radius: '<x>', location: { lat: 'NaN', lng: 1 } } });
  assert.equal(readDiscoverEntry('k3'), null);

  for (let i = 0; i < 30; i++) writeDiscoverEntry(`n${i}`, { applied: { location: loc } });
  assert.equal(readDiscoverEntry('k1'), null, 'old entries are trimmed');
  assert.ok(readDiscoverEntry('n29'));

  store.set('pc.discover.entries', '{not json');
  assert.equal(readDiscoverEntry('n29'), null);
  delete globalThis.sessionStorage;
});

test('Discover entry ids come from our own history.state tag, never React Router\'s shared "default" key', async () => {
  const { currentDiscoverEntryId } = await import('../src/utils/discoverHistoryState.js');
  assert.equal(currentDiscoverEntryId(null), null);
  assert.equal(currentDiscoverEntryId({ usr: null, key: 'default', idx: 0 }), null);
  assert.equal(currentDiscoverEntryId({ key: 'default', idx: 0, discoverEntry: 'abc' }), 'abc');
  assert.equal(currentDiscoverEntryId({ discoverEntry: 42 }), null);
});

test('DiscoverPage restores per-entry state and skips the first-visit bootstrap when restored', () => {
  const s = src('pages/student/DiscoverPage.jsx');
  assert.match(s, /readDiscoverEntry\(currentDiscoverEntryId\(\)\)/);
  assert.match(s, /writeDiscoverEntry\(ensureDiscoverEntryId\(\), \{ filters, applied, location, locationQuery \}\)/);
  assert.match(s, /\}, \[routerLocation\.key, filters, applied, location, locationQuery\]\);/);
  assert.match(s, /if \(restored\) return;\s+const handoff = captureDiscoverUrlHandoff/);
});
