import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

export const UNSAVED_CHANGES_PROMPT = 'You have unsaved changes. Leave this page?';

/**
 * Confirms in-app navigation (links, back/forward) and warns on refresh/close
 * while `isDirty`. Call `allowNavigation()` right before navigating after a save.
 */
export function useUnsavedChangesGuard(isDirty) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const bypassRef = useRef(false);

  const blocker = useBlocker(() => dirtyRef.current && !bypassRef.current);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(UNSAVED_CHANGES_PROMPT)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  return {
    allowNavigation() {
      bypassRef.current = true;
    },
  };
}
