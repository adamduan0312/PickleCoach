import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { studentsApi, asList } from '../../api/index.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { CoachMarketplaceCard } from '../../components/student/CoachMarketplaceCard.jsx';

export function FavoritesPage() {
  const [coaches, setCoaches] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await studentsApi.favoriteCoaches();
      setCoaches(asList(res.data));
    } catch (err) {
      setCoaches(null);
      setError(err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(coachId) {
    if (busyId != null) return;
    const id = Number(coachId);
    setActionError(null);
    setBusyId(id);
    const previous = coaches;
    setCoaches((list) => (list || []).filter((c) => Number(c.id) !== id));
    try {
      await studentsApi.removeFavoriteCoach(id);
    } catch (err) {
      setCoaches(previous);
      setActionError(err.message || 'Couldn’t remove this coach.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Favorite coaches</h1>
          <p className="muted">Coaches you’ve saved, so you can come back to them.</p>
        </div>
      </div>
      {coaches == null && !error ? <LoadingState label="Loading your saved coaches…" /> : null}
      {error ? <ErrorState error={error} onRetry={load} /> : null}
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}
      {coaches && coaches.length === 0 ? (
        <EmptyState
          title="No favorite coaches yet"
          detail="When you find a coach you like, tap the heart on Discover or their profile to save them here."
          action={<Link className="btn" to="/discover">Find a coach</Link>}
        />
      ) : null}
      {coaches && coaches.length > 0 ? (
        <div className="grid-2 discover-coach-grid">
          {coaches.map((coach) => (
            <CoachMarketplaceCard
              key={coach.id}
              coach={coach}
              unavailable={coach.available === false}
              toState={{ backTo: '/favorites' }}
              favorite={{
                saved: true,
                busy: busyId === Number(coach.id),
                onToggle: () => remove(coach.id),
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
