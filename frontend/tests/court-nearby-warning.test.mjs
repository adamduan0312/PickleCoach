import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/pages/coach/CoachCourtsPage.jsx', import.meta.url), 'utf8');

test('nearby courts warn but never block creating a new court', () => {
  assert.doesNotMatch(src, /Select that court instead of creating a new one/);
  assert.match(src, /const nearbyMatches = \[\.\.\.high, \.\.\.possible\];/);
  assert.match(src, /\{nearbyMatches\.length > 0 \? \(/);
  assert.match(src, /onClick=\{\(\) => createNew\(\{ acknowledgePossible: true \}\)\}/);
  assert.match(src, /This is a different location — create new/);
});
