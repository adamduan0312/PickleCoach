/**
 * Global scroll restoration rules (pure + injectable, so it's testable without a DOM).
 *
 * - New navigation (PUSH, or REPLACE to a different page) → top of the new page.
 * - REPLACE on the same page (flash/state cleanup, search-param tweaks) → leave scroll alone.
 * - Back/Forward (POP) → the position saved for that history entry, retried briefly while
 *   async content grows the page, and abandoned as soon as the user scrolls.
 */

export const RESTORE_WINDOW_MS = 1000;
export const MAX_SAVED_ENTRIES = 100;
export const STORAGE_KEY = 'pc.scrollPositions';

/** Input that means the user is taking over scrolling (our own scrollTo calls never emit these). */
export const USER_SCROLL_INTENT_EVENTS = Object.freeze(['wheel', 'touchstart', 'keydown', 'mousedown']);

/**
 * @param {{ navigationType: 'POP'|'PUSH'|'REPLACE', pathname: string, previousPathname?: string|null, savedY?: number|null }} args
 * @returns {{ type: 'restore', y: number } | { type: 'top' } | { type: 'keep' }}
 */
export function scrollActionFor({ navigationType, pathname, previousPathname = null, savedY = null }) {
  if (navigationType === 'POP') return { type: 'restore', y: Number.isFinite(savedY) ? savedY : 0 };
  if (navigationType === 'REPLACE' && previousPathname != null && previousPathname === pathname) {
    return { type: 'keep' };
  }
  return { type: 'top' };
}

/**
 * Scroll to `targetY`, retrying each frame while the page is still too short to reach it.
 * Stops when the target is reachable, when `windowMs` elapses (leaving the page as far down as
 * it can go), or when the user shows scroll intent.
 *
 * @returns {() => void} cancel
 */
export function restoreScrollPosition(targetY, deps) {
  const {
    getMaxScroll,
    scrollTo,
    requestFrame,
    cancelFrame,
    now,
    onUserIntent,
    onDone = () => {},
    windowMs = RESTORE_WINDOW_MS,
  } = deps;
  const target = Math.max(0, targetY);
  const deadline = now() + windowMs;
  let frame = null;
  let finished = false;
  let removeIntentListener = () => {};

  function finish(reason) {
    if (finished) return;
    finished = true;
    if (frame != null) cancelFrame(frame);
    removeIntentListener();
    onDone(reason);
  }

  function attempt() {
    frame = null;
    const max = Math.max(0, getMaxScroll());
    scrollTo(Math.min(target, max));
    if (max >= target) return finish('reached');
    if (now() >= deadline) return finish('timeout');
    frame = requestFrame(attempt);
  }

  removeIntentListener = onUserIntent(() => finish('user'));
  attempt();
  return () => finish('cancelled');
}

/** Keep only the most recent entries so sessionStorage stays small. */
export function trimPositions(entries, max = MAX_SAVED_ENTRIES) {
  return entries.length > max ? entries.slice(entries.length - max) : entries;
}
