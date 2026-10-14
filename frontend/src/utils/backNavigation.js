/**
 * Where a "Back" link goes. Only these in-app routes may be named via `location.state.backTo`;
 * anything else (unknown paths, external URLs, non-strings) is ignored.
 */
export const BACK_DESTINATIONS = Object.freeze({
  '/coach': 'Back to dashboard',
  '/coach/profile': 'Back to coach profile',
  '/messages': 'Back to messages',
});

export const GENERIC_BACK_LABEL = 'Back';

/**
 * @param {{ state?: any, historyIdx?: number, fallbackTo: string, fallbackLabel: string, alwaysFallback?: boolean }} input
 *   historyIdx — React Router's index of the current entry in this tab (0 = first page opened here).
 *   alwaysFallback — the link always leads to `fallbackTo`: it steps back through history only when the
 *   previous page is that destination, otherwise it links there.
 * @returns {{ kind: 'history' | 'link', href: string, label: string }}
 *   'history' steps back one entry (keeps Back/Forward intact); 'link' navigates to `href`.
 */
export function backLinkTarget({ state, historyIdx, fallbackTo, fallbackLabel, alwaysFallback = false }) {
  const canGoBack = Number.isInteger(historyIdx) && historyIdx > 0;
  const backTo = typeof state?.backTo === 'string' && Object.hasOwn(BACK_DESTINATIONS, state.backTo)
    ? state.backTo
    : null;
  if (alwaysFallback) {
    return { kind: canGoBack && backTo === fallbackTo ? 'history' : 'link', href: fallbackTo, label: fallbackLabel };
  }
  if (backTo) return { kind: canGoBack ? 'history' : 'link', href: backTo, label: BACK_DESTINATIONS[backTo] };
  if (canGoBack) return { kind: 'history', href: fallbackTo, label: GENERIC_BACK_LABEL };
  return { kind: 'link', href: fallbackTo, label: fallbackLabel };
}
