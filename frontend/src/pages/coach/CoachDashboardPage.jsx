import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { BookingListCardBody } from '../../components/bookings/BookingListCardBody.jsx';
import { HowBookingsWorkGuide } from '../../components/guides/HowBookingsWorkGuide.jsx';
import { DashboardReminders } from '../../components/dashboard/DashboardReminders.jsx';
import { bookingDisplayLabel, bookingDisplayTone, coachAcceptanceDeadlineAt, sortBookingsForList } from '../../domain/bookingStatus.js';
import { coachDashboardReminders } from '../../domain/dashboardReminders.js';
import { bookingLessonTitle } from '../../domain/lessonOffering.js';
import { formatListWhenInZone, formatListWhenWithZone } from '../../utils/datetime.js';
import { coachSetupView } from '../../domain/coachSetup.js';

function respondByWhen(booking, tz) {
  const iso = coachAcceptanceDeadlineAt(booking);
  return iso ? formatListWhenWithZone(iso, tz) : null;
}

export function CoachDashboardPage() {
  const { user, readiness, refreshProfile, refreshStripeStatus } = useAuth();
  const tz = user?.timezone;
  const location = useLocation();
  const navigate = useNavigate();
  const [flash] = useState(() => location.state?.flash || null);

  // Show once: drop it from history so refresh/back doesn't repeat it.
  useEffect(() => {
    if (location.state?.flash) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);
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
  // Without a profile the next step is known even if marketplace status fails to load.
  const setupSteps = market?.steps || (readiness.coachUiPhase === 'start_setup' ? { profile: false } : null);
  const setup = setupSteps
    ? coachSetupView(setupSteps, {
      coachUiPhase: readiness.coachUiPhase,
      profileExists: market?.profile_exists ?? readiness.coachUiPhase !== 'start_setup',
      profileMissingFields: market?.profile_missing_fields,
    })
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Coach dashboard</h1>
          <p className="muted">Manage your marketplace profile and incoming requests.</p>
        </div>
        <Link className="btn" to="/coach/bookings">All bookings</Link>
      </div>
      {flash ? (
        <Alert tone="success">
          {flash}{' '}
          {user?.id ? <Link to={`/coaches/${user.id}`}>View public profile</Link> : null}
        </Alert>
      ) : null}
      <HowBookingsWorkGuide userId={user?.id} role="coach" />
      {!bookingsLoading && !bookingsError ? <DashboardReminders items={reminders} /> : null}
      {setup?.next ? (
        <div className="card coach-next-step" style={{ marginBottom: 16 }}>
          <span className="small muted coach-next-step-label">Next step</span>
          <h2>{setup.next.title}</h2>
          <p>{setup.next.detail}</p>
          <Link className="btn" to={setup.next.to}>{setup.next.cta}</Link>
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
            {(setup?.checklist || []).map((item) => (
              <li key={item.key} className={item.done ? 'done' : item.disabled ? 'disabled' : ''}>
                <span aria-hidden="true">{item.done ? '✓' : '○'}</span>{' '}
                {item.disabled ? (
                  <span aria-disabled="true">
                    {item.label} <span className="small muted">— {item.hint}</span>
                  </span>
                ) : (
                  <Link to={item.to}>
                    {item.label}
                    <span className="visually-hidden">{item.done ? ' (done)' : ' (not done)'}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {!user?.avatar_url ? (
            <div className="coach-photo-tip">
              <span className="small muted coach-next-step-label">Optional</span>
              <p>
                <strong>Add a profile photo</strong>
                <br />
                <span className="small">Help students recognize you before booking.</span>
              </p>
              <Link className="btn secondary" to="/coach/profile">Add photo</Link>
            </div>
          ) : null}
          <div className="row">
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
              <StatusBadge status={b.status} label={bookingDisplayLabel(b, { audience: 'coach' })} tone={bookingDisplayTone(b, { audience: 'coach' })} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
