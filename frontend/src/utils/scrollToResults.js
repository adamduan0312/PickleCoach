/** Space kept between the sticky header and the results, so the summary line stays readable. */
export const RESULTS_TOP_GAP = 12;

/** How much of the results must already be on screen to skip scrolling (summary + start of the first card). */
export const RESULTS_VISIBLE_ENOUGH = 240;

/**
 * Window scroll position that puts the results just below the sticky header, or null when enough of
 * them is already visible. Never scrolls up past the controls the student just used.
 * @param {{ top: number, height: number, viewportHeight: number, scrollY: number, headerHeight: number }} m
 *   `top`/`height` from the results element's getBoundingClientRect().
 * @returns {number|null}
 */
export function resultsScrollTarget({ top, height, viewportHeight, scrollY, headerHeight }) {
  const needed = Math.min(height, RESULTS_VISIBLE_ENOUGH);
  const alreadyVisible = top >= headerHeight && top + needed <= viewportHeight;
  if (alreadyVisible) return null;
  const target = Math.max(0, Math.round(scrollY + top - headerHeight - RESULTS_TOP_GAP));
  return target > scrollY ? target : null;
}

/** Smoothly scroll the window so `el` sits just below the sticky app header (instant with reduced motion). */
export function scrollResultsIntoView(el) {
  if (!el || typeof window === 'undefined') return;
  const rect = el.getBoundingClientRect();
  const header = document.querySelector('.app-header');
  const target = resultsScrollTarget({
    top: rect.top,
    height: rect.height,
    viewportHeight: window.innerHeight,
    scrollY: window.scrollY,
    headerHeight: header ? header.getBoundingClientRect().height : 0,
  });
  if (target == null) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
}
