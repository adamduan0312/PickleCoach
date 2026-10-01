import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/ui/PlaceAutocomplete.jsx', import.meta.url), 'utf8');

test('place autocomplete skips 1-char queries and partial ZIPs (same rule as the server)', async () => {
  // Component module imports the API client (browser-only), so evaluate the pure helper from source.
  const fnSrc = src.slice(src.indexOf('export function shouldSuggestPlaces'), src.indexOf('/**', src.indexOf('export function shouldSuggestPlaces')));
  const shouldSuggestPlaces = new Function(`${fnSrc.replace('export ', '')}; return shouldSuggestPlaces;`)();
  assert.equal(shouldSuggestPlaces('D'), false);
  assert.equal(shouldSuggestPlaces('Da'), true);
  assert.equal(shouldSuggestPlaces('3331'), false);
  assert.equal(shouldSuggestPlaces('33314'), true);
  assert.equal(shouldSuggestPlaces('3001 W Abiaca Cir'), true);
});

test('place autocomplete: debounced, server-backed, stale-safe, keyboard accessible', () => {
  assert.match(src, /const DEBOUNCE_MS = 300;/);
  assert.match(src, /geoApi\.places\(\{ q: value\.trim\(\) \}\)/);
  assert.match(src, /if \(requestId !== requestRef\.current\) return;/);
  assert.match(src, /role="combobox"/);
  assert.match(src, /role="listbox"/);
  assert.match(src, /role="option"/);
  assert.match(src, /e\.key === 'ArrowDown'/);
  assert.match(src, /e\.key === 'Enter' && results\[activeIndex\]/);
  assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  // Choosing a suggestion does not immediately re-query the chosen label.
  assert.match(src, /chosenRef\.current = option\.label;/);
  assert.match(src, /value === chosenRef\.current/);
  // No provider called from the browser.
  assert.doesNotMatch(src, /photon|nominatim/i);
});

test('geo API client exposes the places endpoint', () => {
  const api = readFileSync(new URL('../src/api/index.js', import.meta.url), 'utf8');
  assert.match(api, /places: \(params\) => apiRequest\(`\/geo\/places\$\{qs\(params\)\}`\)/);
});
