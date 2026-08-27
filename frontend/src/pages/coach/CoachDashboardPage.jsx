import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { bookingStatusLabel, bookingStatusTone, coachAcceptanceDeadlineAt } from '../../domain/bookingStatus.js';
import { formatInZone, formatDateInZone, formatTimeInZone } from '../../utils/datetime.js';

const STEP_LABELS = {
  profile: 'Coach profile',
  lesson: 'At least one lesson',
  court: 'A court location',
  availability: 'Availability windows',
  stripe: 'Payouts enabled',
};

function respondByLabel(booking, tz) {
  const iso = coachAcceptanceDeadlineAt(booking);
  if (!iso) return null;
  return `${formatDateInZone(iso, tz)} · ${formatTimeInZone(iso, tz)}`;
}

export function CoachDashboardPage() {
  const { user, readiness, refreshProfile, refreshStripeStatus } = useAuth();
  const tz = user?.timezone;
  const { data, error, loading } = useAsync(async () => {
    const [statusRes, bookingsRes] = await Promise.all([
      coachesApi.marketplaceStatus(),
      coachesApi.myBookings({ status: 'pending' }).catch(() => ({ data: [] })),
    ]);
    return {
      market: statusRes.data,
      pending: asList(bookingsRes.data),
    };
  }, [user?.id, readiness.coachUiPhase]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Coach dashboard</h1>
          <p className="muted">Manage your marketplace profile and incoming requests.</p>
        </div>
        <Link className="btn" to="/coach/bookings">All bookings</Link>
      </div>
      {readiness.coachUiPhase === 'start_setup' ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Create your coach profile</h2>
          <p>You have the coach role, but no profile yet.</p>
          <Link className="btn" to="/coach/profile">Start setup</Link>
        </div>
      ) : null}
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {data?.market ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread">
            <h2>Marketplace status</h2>
            <StatusBadge
              status={data.market.listed ? 'listed' : 'unlisted'}
              label={data.market.listed ? 'Listed for students' : 'Not listed yet'}
              tone={data.market.listed ? 'success' : 'warning'}
            />
          </div>
          {!data.market.listed ? (
            <p className="small muted">
              Complete every step below to appear in Discover. Students can’t find you until you’re listed.
            </p>
          ) : (
            <p className="small muted">You’re visible to students in Discover.</p>
          )}
          <ul className="checklist">
            {Object.entries(data.market.steps || {}).map(([key, done]) => (
              <li key={key} className={done ? 'done' : ''}>
                {done ? '✓' : '○'} {STEP_LABELS[key] || key}
              </li>
            ))}
          </ul>
          <div className="row">
            <Link className="btn secondary" to="/coach/profile">Profile</Link>
            <Link className="btn secondary" to="/coach/lessons">Lessons</Link>
            <Link className="btn secondary" to="/coach/courts">Courts</Link>
            <Link className="btn secondary" to="/coach/availability">Availability</Link>
            <Link className="btn secondary" to="/coach/stripe">Payouts</Link>
            <button type="button" className="btn ghost" onClick={() => { refreshProfile(); refreshStripeStatus(); }}>Refresh</button>
          </div>
        </div>
      ) : null}
      <div className="card">
        <h2>Incoming requests</h2>
        {data && data.pending.length === 0 ? (
          <EmptyState
            title="No pending booking requests"
            detail="You’ll see new requests here when a student books a lesson with you."
          />
        ) : null}
        <div className="stack">
          {(data?.pending || []).map((b) => {
            const respondBy = respondByLabel(b, tz);
            return (
              <Link key={b.id} to={`/bookings/${b.id}`} className="spread" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div>
                  <strong>{b.lesson?.title || 'Lesson'}</strong>
                  <div className="small muted">{b.primaryStudent?.full_name} · {formatInZone(b.scheduled_at, tz)}</div>
                  {respondBy ? (
                    <div className="small" style={{ marginTop: 4 }}>
                      <strong>Respond by {respondBy}</strong>
                    </div>
                  ) : null}
                </div>
                <StatusBadge status={b.status} label={bookingStatusLabel(b.status, { audience: 'coach' })} tone={bookingStatusTone(b.status)} />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
