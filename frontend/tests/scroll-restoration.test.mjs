import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RESTORE_WINDOW_MS,
  USER_SCROLL_INTENT_EVENTS,
  restoreScrollPosition,
  scrollActionFor,
  trimPositions,
} from '../src/utils/scrollRestoration.js';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/hooks/useGlobalScrollRestoration.js', import.meta.url), 'utf8');

/** Fake page whose height grows over time, with a manual frame clock. */
function harness({ heights, windowMs = RESTORE_WINDOW_MS, frameMs = 16 }) {
  let t = 0;
  let frameIndex = 0;
  let pending = null;
  let intentHandler = null;
  let intentRemoved = false;
  const scrolls = [];
  const done = [];
  const deps = {
    getMaxScroll: () => heights[Math.min(frameIndex, heights.length - 1)],
    scrollTo: (y) => scrolls.push(y),
    requestFrame: (cb) => {
      pending = cb;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
    now: () => t,
    onUserIntent: (handler) => {
      intentHandler = handler;
      return () => {
        intentRemoved = true;
      };
    },
    onDone: (reason) => done.push(reason),
    windowMs,
  };
  return {
    deps,
    scrolls,
    done,
    tick() {
      if (!pending) return false;
      const cb = pending;
      pending = null;
      t += frameMs;
      frameIndex += 1;
      cb();
      return true;
    },
    runAll() {
      while (this.tick()) {
        /* advance frames */
      }
    },
    userScrolls: () => intentHandler(),
    intentRemoved: () => intentRemoved,
  };
}

test('new navigation starts at top; Back/Forward restores; same-page replace keeps position', () => {
  assert.deepEqual(scrollActionFor({ navigationType: 'PUSH', pathname: '/coach/profile', previousPathname: '/coach' }), { type: 'top' });
  assert.deepEqual(scrollActionFor({ navigationType: 'POP', pathname: '/coach', savedY: 647 }), { type: 'restore', y: 647 });
  assert.deepEqual(scrollActionFor({ navigationType: 'POP', pathname: '/coach' }), { type: 'restore', y: 0 }, 'left from the top → back to the top');
  assert.deepEqual(
    scrollActionFor({ navigationType: 'REPLACE', pathname: '/coach', previousPathname: '/coach' }),
    { type: 'keep' },
    'flash-state / search-param cleanup must not jump',
  );
  assert.deepEqual(
    scrollActionFor({ navigationType: 'REPLACE', pathname: '/bookings/9', previousPathname: '/checkout' }),
    { type: 'top' },
  );
});

test('restore retries while async content grows, then stops once reachable', () => {
  const h = harness({ heights: [100, 300, 700, 900] });
  restoreScrollPosition(647, h.deps);
  h.runAll();
  assert.deepEqual(h.scrolls, [100, 300, 647]);
  assert.deepEqual(h.done, ['reached']);
  assert.equal(h.intentRemoved(), true);
});

test('restore is immediate when the page is already tall enough', () => {
  const h = harness({ heights: [2000] });
  restoreScrollPosition(400, h.deps);
  assert.deepEqual(h.scrolls, [400]);
  assert.deepEqual(h.done, ['reached']);
  assert.equal(h.tick(), false, 'no further frames scheduled');
});

test('restore gives up after the retry window, leaving the page as far down as it goes', () => {
  const h = harness({ heights: [200], windowMs: 100 });
  restoreScrollPosition(647, h.deps);
  h.runAll();
  assert.deepEqual(h.done, ['timeout']);
  assert.ok(h.scrolls.length > 1 && h.scrolls.length <= 8);
  assert.ok(h.scrolls.every((y) => y === 200));
  assert.ok(RESTORE_WINDOW_MS >= 500 && RESTORE_WINDOW_MS <= 1000);
});

test('user scroll intent cancels the restore immediately', () => {
  const h = harness({ heights: [100, 200, 300, 900] });
  restoreScrollPosition(647, h.deps);
  h.tick();
  h.userScrolls();
  assert.equal(h.tick(), false, 'pending frame cancelled');
  assert.deepEqual(h.scrolls, [100, 200]);
  assert.deepEqual(h.done, ['user']);
  assert.deepEqual([...USER_SCROLL_INTENT_EVENTS].sort(), ['keydown', 'mousedown', 'touchstart', 'wheel']);
});

test('cancel (navigating away mid-restore) stops retries', () => {
  const h = harness({ heights: [100, 200, 900] });
  const cancel = restoreScrollPosition(647, h.deps);
  cancel();
  assert.equal(h.tick(), false);
  assert.deepEqual(h.done, ['cancelled']);
});

test('saved positions are capped', () => {
  const entries = Array.from({ length: 150 }, (_, i) => [`k${i}`, i]);
  const kept = trimPositions(entries);
  assert.equal(kept.length, 100);
  assert.equal(kept[0][0], 'k50');
});

test('global hook is rendered once in the shared signed-in layout, replacing <ScrollRestoration />', () => {
  assert.doesNotMatch(app, /<ScrollRestoration/, 'two restorers would fight over window scroll');
  assert.doesNotMatch(app, /\bScrollRestoration,/);
  const shell = app.slice(app.indexOf('function ShellLayout'), app.indexOf('function RootRedirect'));
  assert.match(shell, /<Outlet \/>[\s\S]*<GlobalScrollRestoration \/>/);
  assert.equal((app.match(/<GlobalScrollRestoration \/>/g) || []).length, 1);
  assert.match(hook, /history\.scrollRestoration = 'manual'/);
  assert.match(hook, /useNavigationType\(\)/);
  assert.match(hook, /sessionStorage/);
});

test('element-level scrollIntoView (profile save status) is untouched by the global hook', () => {
  const profile = readFileSync(new URL('../src/pages/coach/CoachProfileEditPage.jsx', import.meta.url), 'utf8');
  assert.match(profile, /statusRef\.current\?\.scrollIntoView\(/);
  assert.doesNotMatch(hook, /statusRef|scrollIntoView\(\{ ?behavior/);
});
