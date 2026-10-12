import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RESULTS_TOP_GAP, resultsScrollTarget } from '../src/utils/scrollToResults.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const base = { height: 900, viewportHeight: 800, scrollY: 0, headerHeight: 64 };

test('results below the fold: scroll so they sit just under the sticky header', () => {
  assert.equal(resultsScrollTarget({ ...base, top: 1100 }), 1100 - 64 - RESULTS_TOP_GAP);
  assert.equal(resultsScrollTarget({ ...base, top: 700, scrollY: 300 }), 300 + 700 - 64 - RESULTS_TOP_GAP);
});

test('results already showing their summary and first card: no scroll', () => {
  assert.equal(resultsScrollTarget({ ...base, top: 300 }), null);
});

test('only partly visible (summary but not the first card): scroll', () => {
  assert.notEqual(resultsScrollTarget({ ...base, top: 700 }), null);
});

test('short empty-results message that fits on screen: no scroll', () => {
  assert.equal(resultsScrollTarget({ ...base, top: 600, height: 150 }), null);
});

test('never scrolls back up past the search controls', () => {
  assert.equal(resultsScrollTarget({ ...base, top: 20, scrollY: 900 }), null);
});

test('Discover scrolls only after explicit, successful location actions', () => {
  const src = read('../src/pages/student/DiscoverPage.jsx');
  const fn = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n  }\n', src.indexOf(`function ${name}(`)));

  assert.match(fn('useMyLocation'), /applyLocation\(next\);\s*scrollToResultsWhenLoaded\(\);\s*\} catch/, 'after geolocation succeeds, not in catch');
  assert.match(fn('chooseLocationResult'), /scrollToResultsWhenLoaded\(\)/, 'picking one of several matches');
  assert.match(fn('searchLocation'), /scrollToResults: true/, 'Search button / Enter');

  const query = fn('runLocationQuery');
  const resolved = query.indexOf('if (scrollToResults) scrollToResultsWhenLoaded();');
  assert.ok(resolved > query.indexOf("outcome.status === 'ambiguous'"), 'not for ambiguous matches');
  assert.ok(resolved > query.indexOf("outcome.status === 'invalid'"), 'not for invalid / empty queries');
  assert.ok(resolved < query.indexOf('} catch'), 'not when the lookup fails');

  assert.match(src, /runLocationQuery\(handoff\.q, \{ keepQueryText: true \}\)/, 'dashboard handoff on page load does not scroll');
  assert.doesNotMatch(fn('onFilterSubmit'), /scrollToResults/);
  assert.match(src, /onChange=\{\(e\) => \{\s*setLocationQuery\(e\.target\.value\);/, 'typing only updates the field');

  assert.match(src, /if \(!pending \|\| loading \|\| \(data === pending\.before && !error\)\) return;/, 'waits for the reloaded results');
  assert.match(src, /className="discover-results" ref=\{resultsRef\}/);
});
