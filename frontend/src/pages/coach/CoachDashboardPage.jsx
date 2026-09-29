import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { BookingListCardBody } from '../../components/bookings/BookingListCardBody.jsx';
import { HowBookingsWorkGuide } from '../../components/guides/HowBookingsWorkGuide.jsx';
import { DashboardReminders } from '../../components/dashboard/DashboardReminders.jsx';
import { bookingDisplayLabel, bookingDisplayTone, coachAcceptanceDeadlineAt, sortBookingsForList } from '../../domain/bookingStatus.js';
import { coachDashboardReminders } from '../../domain/dashboardReminders.js';
import { bookingLessonTitle } from '../../domain/lessonOffering.js';
import { formatListWhenInZone, formatListWhenWithZone } from '../../utils/datetime.js';

const STEP_LABELS = {
  profile: 'Coach profile',
  lesson: 'At least one lesson',
  court: 'A court location',
  availability: 'Availability windows',
  stripe: 'Payouts enabled',
};

function respondByWhen(booking, tz) {
  const iso = coachAcceptanceDeadlineAt(booking);
  return iso ? formatListWhenWithZone(iso, tz) : null;
}

export function CoachDashboardPage() {
  const { user, readiness, refreshProfile, refreshStripeStatus } = useAuth();
  const tz = user?.timezone;
  const { data: market, error: marketError, loading: marketLoading } = useAsync(async () => {
    const statusRes = await coachesApi.marketplaceStatus();
    return statusRes.data;
  }, [user?.id, readiness.coachUiPhase]);

  const { data: bookingsData, error: bookingsError, loading: bookingsLoading } = useAsync(async () => {
    const bookingsRes = await coachesApi.myBookings();
    const bookings = asList(bookingsRes.data);
    return {
      bookings,
      pending: sortBookingsForList(
        bookings.filter((b) => b.status === 'pending'),
        undefined,
        { audience: 'coach' },
      ),
    };
  }, [user?.id]);

  const reminders = useMemo(
    () => coachDashboardReminders(bookingsData?.bookings || []),
    [bookingsData?.bookings],
  );

  const loading = marketLoading || bookingsLoading;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Coach dashboard</h1>
          <p className="muted">Manage your marketplace profile and incoming requests.</p>
        </div>
        <Link className="btn" to="/coach/bookings">All bookings</Link>
      </div>
      <HowBookingsWorkGuide userId={user?.id} role="coach" />
      {!bookingsLoading && !bookingsError ? <DashboardReminders items={reminders} /> : null}
      {readiness.coachUiPhase === 'start_setup' ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Create your coach profile</h2>
          <p>You have the coach role, but no profile yet.</p>
          <Link className="btn" to="/coach/profile">Start setup</Link>
        </div>
      ) : null}
      {loading ? <LoadingState /> : null}
      {marketError ? <ErrorState error={marketError} /> : null}
      {bookingsError ? <ErrorState error={bookingsError} /> : null}
      {market ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread">
            <h2>Marketplace status</h2>
            <StatusBadge
              status={market.listed ? 'listed' : 'unlisted'}
              label={market.listed ? 'Listed for students' : 'Not listed yet'}
              tone={market.listed ? 'success' : 'warning'}
            />
          </div>
          {!market.listed ? (
            <p className="small muted">
              Complete every step below to appear in Discover. Students can’t find you until you’re listed.
            </p>
          ) : (
            <p className="small muted">You’re visible to students in Discover.</p>
          )}
          <ul className="checklist">
            {Object.entries(market.steps || {}).map(([key, done]) => (
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
        {bookingsData && bookingsData.pending.length === 0 ? (
          <EmptyState
            title="No pending booking requests"
            detail="You’ll see new requests here when a student books a lesson with you."
          />
        ) : null}
        <div className="stack">
          {(bookingsData?.pending || []).map((b) => (
            <Link
              key={b.id}
              to={`/bookings/${b.id}`}
              className="spread booking-list-card"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <BookingListCardBody
                lessonTitle={bookingLessonTitle(b)}
                partyName={b.primaryStudent?.full_name}
                price={b.price}
                lessonWhen={formatListWhenWithZone(b.scheduled_at, tz)}
                requestedWhen={b.created_at ? formatListWhenInZone(b.created_at, tz) : null}
                deadlineWhen={respondByWhen(b, tz)}
                audience="coach"
              />
              <StatusBadge status={b.status} label={bookingDisplayLabel(b, { audience: 'coach' })} tone={bookingDisplayTone(b)} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
