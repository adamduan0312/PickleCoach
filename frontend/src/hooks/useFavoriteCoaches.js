import { useCallback, useEffect, useRef, useState } from 'react';
import { studentsApi } from '../api/index.js';

/**
 * The signed-in student's saved coaches, as a set of coach ids.
 * Toggling updates the set immediately and puts it back if the request fails.
 * `scopeKey` is the signed-in user id, so one account never sees another's hearts.
 */
export function useFavoriteCoaches(enabled, scopeKey = null) {
  const [ids, setIds] = useState(() => new Set());
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const token = ++requestRef.current;
    let cancelled = false;
    studentsApi.favoriteCoachIds()
      .then((res) => {
        if (cancelled || requestRef.current !== token) return;
        const list = Array.isArray(res.data?.coach_ids) ? res.data.coach_ids : [];
        setIds(new Set(list.map((id) => Number(id))));
        setLoadedFor(scopeKey);
        setError(null);
      })
      .catch((err) => {
        if (cancelled || requestRef.current !== token) return;
        setIds(new Set());
        setLoadedFor(scopeKey);
        setError(err.message || 'Couldn’t load your saved coaches.');
      });
    return () => { cancelled = true; };
  }, [enabled, scopeKey]);

  const toggle = useCallback(async (coachId) => {
    const id = Number(coachId);
    if (!Number.isInteger(id) || busyId != null) return;
    const wasSaved = ids.has(id);
    setError(null);
    setBusyId(id);
    setIds((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      if (wasSaved) await studentsApi.removeFavoriteCoach(id);
      else await studentsApi.addFavoriteCoach(id);
    } catch (err) {
      setIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(id);
        else next.delete(id);
        return next;
      });
      setError(err.message || 'Couldn’t update favorites.');
    } finally {
      setBusyId(null);
    }
  }, [busyId, ids]);

  return {
    ids,
    ready: Boolean(enabled) && loadedFor === scopeKey,
    error,
    busyId,
    toggle,
    clearError: () => setError(null),
  };
}
