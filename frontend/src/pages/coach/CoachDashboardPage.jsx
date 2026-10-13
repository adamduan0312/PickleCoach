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
import { CoachOnboardingCard } from '../../components/coach/CoachOnboarding.jsx';
import { CoachReliabilitySummary } from '../../components/coach/CoachReliabilitySummary.jsx';
import { PAYOUT_SETUP_RESET_MESSAGE } from '../../domain/payoutSetupReset.js';

function respondByWhen(booking, tz) {
  const iso = coachAcceptanceDeadlineAt(booking);
  return iso ? formatListWhenWithZone(iso, tz) : null;
}

export function CoachDashboardPage() {
  const { user, readiness, payoutSetupReset, refreshProfile, refreshStripeStatus } = useAuth();
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
  }, [user?.id, readiness.coachUiPhase], { keepData: true });

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

  const { data: galleryCount } = useAsync(async () => {
    const res = await coachesApi.myPhotos();
    return (res.data?.photos || []).length;
  }, [user?.id]);

  const reminders = useMemo(
    () => coachDashboardReminders(bookingsData?.bookings || []),
    [bookingsData?.bookings],
  );

  const loading = (marketLoading && !market) || bookingsLoading;
  // Without a profile the next step is known even if marketplace status fails to load.
  const setupSteps = market?.steps || (readiness.coachUiPhase === 'start_setup' ? { profile: false } : null);
  const setup = setupSteps
    ? coachSetupView(setupSteps, {
      coachUiPhase: readiness.coachUiPhase,
      profileExists: market?.profile_exists ?? readiness.coachUiPhase !== 'start_setup',
      profileMissingFields: market?.profile_missing_fields,
      profile: user?.coachProfile,
    })
    : null;
  const listed = Boolean(market?.listed);

  const checklist = setup ? (
    <CoachOnboardingCard
      listed={listed}
      setup={setup}
      userId={user?.id}
      onRefresh={() => { refreshProfile(); refreshStripeStatus(); }}
    />
  ) : null;

  const photoPrompt = setup && galleryCount === 0 ? (
    <div className="card coach-optional-photo">
      <div>
        <span className="small muted coach-next-step-label">Optional</span>
        <p>
          <strong>Add coaching photos</strong>
          <br />
          <span className="small">Show students what your lessons look like, on the court and in action.</span>
        </p>
      </div>
      <Link className="btn secondary" to="/coach/profile#coaching-photos">Add photos →</Link>
    </div>
  ) : null;

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
          {user?.id ? <Link to={`/coaches/${user.id}`} state={{ backTo: '/coach' }}>View public profile</Link> : null}
        </Alert>
      ) : null}
      {payoutSetupReset && !listed ? (
        <Alert tone="warning">
          {PAYOUT_SETUP_RESET_MESSAGE}{' '}
          <Link to="/coach/stripe">Set up payouts</Link>
        </Alert>
      ) : null}
      {!listed ? checklist : null}
      {market ? <CoachReliabilitySummary listed={listed} /> : null}
      {!listed ? photoPrompt : null}
      <HowBookingsWorkGuide userId={user?.id} role="coach" />
      {!bookingsLoading && !bookingsError ? <DashboardReminders items={reminders} /> : null}
      {loading ? <LoadingState /> : null}
      {marketError ? <ErrorState error={marketError} /> : null}
      {bookingsError ? <ErrorState error={bookingsError} /> : null}
      {listed ? checklist : null}
      {listed ? photoPrompt : null}
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
