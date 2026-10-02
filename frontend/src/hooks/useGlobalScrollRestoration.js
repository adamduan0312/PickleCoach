import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import {
  STORAGE_KEY,
  USER_SCROLL_INTENT_EVENTS,
  restoreScrollPosition,
  scrollActionFor,
  trimPositions,
} from '../utils/scrollRestoration.js';

function loadPositions() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return new Map(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Map();
  }
}

function persistPositions(positions) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimPositions([...positions])));
  } catch {
    /* storage full or unavailable — in-memory positions still work for this session */
  }
}

function maxWindowScroll() {
  return document.documentElement.scrollHeight - window.innerHeight;
}

/** Window-level scroll restoration per history entry. Render once, inside the router. */
export function useGlobalScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positionsRef = useRef(null);
  if (positionsRef.current == null) positionsRef.current = loadPositions();
  const keyRef = useRef(location.key);
  const pathnameRef = useRef(null);
  const restoringRef = useRef(false);

  useEffect(() => {
    const { history } = window;
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';

    const onScroll = () => {
      if (restoringRef.current) return;
      positionsRef.current.set(keyRef.current, window.scrollY);
    };
    const onPageHide = () => persistPositions(positionsRef.current);

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onPageHide);
      persistPositions(positionsRef.current);
      history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    keyRef.current = location.key;
    const previousPathname = pathnameRef.current;
    pathnameRef.current = location.pathname;

    const action = scrollActionFor({
      navigationType,
      pathname: location.pathname,
      previousPathname,
      savedY: positionsRef.current.get(location.key),
    });

    if (action.type === 'keep') {
      positionsRef.current.set(location.key, window.scrollY);
      return undefined;
    }

    if (action.type === 'top') {
      const anchor = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
      if (anchor) anchor.scrollIntoView();
      else window.scrollTo(0, 0);
      positionsRef.current.set(location.key, window.scrollY);
      return undefined;
    }

    restoringRef.current = true;
    const cancel = restoreScrollPosition(action.y, {
      getMaxScroll: maxWindowScroll,
      scrollTo: (y) => window.scrollTo(0, y),
      requestFrame: (cb) => window.requestAnimationFrame(cb),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
      now: () => performance.now(),
      onUserIntent: (handler) => {
        USER_SCROLL_INTENT_EVENTS.forEach((type) => window.addEventListener(type, handler, { passive: true }));
        return () => USER_SCROLL_INTENT_EVENTS.forEach((type) => window.removeEventListener(type, handler));
      },
      onDone: (reason) => {
        restoringRef.current = false;
        // Timeout keeps the saved target so a later Back can retry; cancellation happens while the
        // next page is already in the DOM, so its scrollY doesn't belong to this entry.
        if (reason === 'reached' || reason === 'user') positionsRef.current.set(location.key, window.scrollY);
      },
    });
    return cancel;
  }, [location.key, location.pathname, location.hash, navigationType]);
}
