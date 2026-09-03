import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { studentsApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import {
  bookingDisplayLabel,
  bookingDisplayTone,
  coachAcceptanceDeadlineAt,
  studentRecentLesson,
  hasLessonEnded,
} from '../../domain/bookingStatus.js';
import { formatDateInZone, formatTimeInZone, detectLocalTimezone } from '../../utils/datetime.js';
import {
  LOCATION_ACCESS_OFF_DETAIL,
  LOCATION_ACCESS_OFF_TITLE,
  LOCATION_ALLOW_HINT,
  geolocationErrorMessage,
  getBrowserPosition,
  isGeolocationPermissionDenied,
  queryGeolocationPermission,
  tryGetGrantedGeolocation,
  writeSessionGeo,
} from '../../utils/geolocation.js';


function bookingCourtName(booking) {
  const court = booking?.courtLocation;
  if (!court) return null;
  return court.name || null;
}

function sortByScheduledAsc(a, b) {
  return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
}

function discoverUrlForGeo(loc) {
  const params = new URLSearchParams({
    lat: String(loc.lat),
    lng: String(loc.lng),
    label: loc.label || 'Your current location',
  });
  return `/discover?${params.toString()}`;
}

export function StudentDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const tz = user?.timezone || detectLocalTimezone();
  const [query, setQuery] = useState('');
  const [nearYou, setNearYou] = useState(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState(null);
  /** @type {'granted'|'prompt'|'denied'|'unsupported'|null} */
  const [geoPermission, setGeoPermission] = useState(null);

  const { data, error, loading } = useAsync(async () => {
    const res = await studentsApi.myBookings();
    return asList(res.data);
  }, [user?.id]);

  // Progressive geo: only auto-use location when the browser already granted permission.
  // Never prompt on open; only explain blocked access when permission is denied.
  useEffect(() => {
    let cancelled = false;
    /** @type {PermissionStatus | null} */
    let permissionStatus = null;

    (async () => {
      const permission = await queryGeolocationPermission();
      if (cancelled) return;
      setGeoPermission(permission);

      if (permission === 'granted') {
        const loc = await tryGetGrantedGeolocation();
        if (!cancelled && loc) setNearYou(loc);
      }

      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        try {
          permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
          permissionStatus.onchange = () => {
            if (cancelled) return;
            setGeoPermission(permissionStatus.state);
          };
        } catch {
          // Safari / unsupported — ignore
        }
      }
    })();

    return () => {
      cancelled = true;
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, []);

  const bookings = data || [];
  const upcoming = bookings
    .filter((b) => {
      if (b.status === 'pending') return true;
      if (b.status === 'confirmed') return !hasLessonEnded(b);
      return false;
    })
    .sort(sortByScheduledAsc);
  const nextLesson = upcoming[0] || null;
  const moreUpcoming = upcoming.slice(1);
  const recentLessons = bookings
    .filter((b) => studentRecentLesson(b))
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());

  function goDiscover(e) {
    e.preventDefault();
    const q = query.trim();
    setLocError(null);

    // Place search only — "Browse coaches near me" is a separate CTA when GPS is known.
    if (q.length >= 2) {
      navigate(`/discover?q=${encodeURIComponent(q)}`);
      return;
    }

    setLocError('Enter a ZIP, city, or address to search another location.');
  }

  async function useMyLocation() {
    if (geoPermission === 'denied') return;
    setLocError(null);
    setLocBusy(true);
    try {
      const loc = await getBrowserPosition();
      writeSessionGeo(loc);
      setGeoPermission('granted');
      setNearYou(loc);
      setQuery('');
      navigate(discoverUrlForGeo(loc));
    } catch (err) {
      if (isGeolocationPermissionDenied(err)) setGeoPermission('denied');
      setLocError(geolocationErrorMessage(err));
    } finally {
      setLocBusy(false);
    }
  }

  const firstName = user?.full_name?.trim().split(/\s+/).filter(Boolean)[0] || '';
  const hasTypedPlace = query.trim().length >= 2;

  return (
    <div className="page student-dashboard">
      <div className="page-header">
        <div>
          <h1>{firstName ? `Welcome, ${firstName}` : 'Welcome'}</h1>
          <p className="muted">Find a coach and book your next lesson.</p>
        </div>
      </div>

      <section className="card dashboard-search" aria-labelledby="dashboard-find-coach">
        <h2 id="dashboard-find-coach">Find a coach</h2>

        {nearYou ? (
          <div className="dashboard-near-you" role="status">
            <p style={{ margin: 0 }}>
              <strong>Coaches near you</strong>
            </p>
            <p className="muted small" style={{ margin: '0.25rem 0 0.75rem' }}>
              Browse coaches within 25 miles of your location.
            </p>
            <button
              className="btn"
              type="button"
              onClick={() => navigate(discoverUrlForGeo(nearYou))}
              disabled={locBusy}
            >
              Browse coaches near me
            </button>
          </div>
        ) : (
          <div className="dashboard-location-cta" style={{ marginBottom: 12 }}>
            <p className="muted small" style={{ margin: '0 0 0.75rem' }}>
              Use your location to browse coaches within 25 miles, or search a place below.
            </p>
            <div className="stack" style={{ gap: 4 }}>
              <button
                className="btn"
                type="button"
                onClick={useMyLocation}
                disabled={locBusy || geoPermission === 'denied' || geoPermission === 'unsupported'}
                aria-busy={locBusy}
                aria-describedby={
                  geoPermission === 'denied'
                    ? 'dashboard-geo-denied'
                    : geoPermission === 'prompt' || geoPermission == null
                      ? 'dashboard-geo-hint'
                      : undefined
                }
              >
                {locBusy ? 'Getting location…' : 'Use my location'}
              </button>
              {geoPermission === 'prompt' || geoPermission == null ? (
                <span id="dashboard-geo-hint" className="muted small">{LOCATION_ALLOW_HINT}</span>
              ) : null}
            </div>
          </div>
        )}

        <form onSubmit={goDiscover} className="dashboard-search-form">
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="dashboard_location_q">
              {nearYou ? 'Search another location' : 'Search a location'}
            </label>
            <div className="row" style={{ alignItems: 'stretch' }}>
              <input
                id="dashboard_location_q"
                name="q"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (locError) setLocError(null);
                }}
                placeholder="ZIP, city, or address"
                disabled={locBusy}
                autoComplete="address-level2"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button className="btn secondary" type="submit" disabled={locBusy || !hasTypedPlace}>
                Search
              </button>
            </div>
          </div>
        </form>
        {geoPermission === 'denied' ? (
          <div id="dashboard-geo-denied" className="alert warning" role="status" style={{ marginTop: 12 }}>
            <strong>{LOCATION_ACCESS_OFF_TITLE}</strong>
            <div className="small" style={{ marginTop: 4 }}>{LOCATION_ACCESS_OFF_DETAIL}</div>
          </div>
        ) : null}
        {locError && geoPermission !== 'denied' ? (
          <div className="alert error" role="alert" style={{ marginTop: 12 }}>{locError}</div>
        ) : null}
      </section>

      <section className="card dashboard-next-lesson" style={{ marginTop: 16 }} aria-labelledby="dashboard-upcoming-lesson">
        <h2 id="dashboard-upcoming-lesson">Upcoming lesson</h2>
        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} /> : null}
        {!loading && !error && !nextLesson ? (
          <EmptyState
            title="No upcoming lessons"
            detail="Your next lesson will appear here after you book one. Search above or browse Discover to find a coach."
          />
        ) : null}
        {!loading && !error && nextLesson ? (
          <div className="dashboard-next-body">
            <div className="small muted" style={{ letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
              {bookingDisplayLabel(nextLesson, { audience: 'student' })}
            </div>
            {nextLesson.status === 'pending' ? (
              <p className="small" style={{ margin: '0.35rem 0 0' }}>
                Waiting for the coach to accept
                {coachAcceptanceDeadlineAt(nextLesson)
                  ? ` · by ${formatDateInZone(coachAcceptanceDeadlineAt(nextLesson), tz)} · ${formatTimeInZone(coachAcceptanceDeadlineAt(nextLesson), tz)}`
                  : ''}
                .
              </p>
            ) : null}
            <h3 className="dashboard-next-title">{nextLesson.lesson?.title || 'Lesson'}</h3>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              with {nextLesson.coach?.full_name || 'Coach'}
            </p>
            <p style={{ margin: '0.75rem 0 0' }}>
              <strong>{formatDateInZone(nextLesson.scheduled_at, tz)}</strong>
              {' · '}
              {formatTimeInZone(nextLesson.scheduled_at, tz)}
            </p>
            {bookingCourtName(nextLesson) ? (
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>{bookingCourtName(nextLesson)}</p>
            ) : null}
            <div style={{ marginTop: 16 }}>
              <Link className="btn secondary" to={`/bookings/${nextLesson.id}`}>View booking</Link>
            </div>
          </div>
        ) : null}
      </section>

      {recentLessons.length > 0 ? (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="dashboard-recent-lessons">
          <h2 id="dashboard-recent-lessons">Recent lessons</h2>
          <div className="stack">
            {recentLessons.slice(0, 5).map((b) => (
              <Link key={b.id} to={`/bookings/${b.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="spread">
                  <div>
                    <strong>{b.lesson?.title || 'Lesson'}</strong>
                    <div className="small muted">
                      with {b.coach?.full_name || 'Coach'}
                      {' · '}
                      {formatDateInZone(b.scheduled_at, tz)}
                      {' · '}
                      {formatTimeInZone(b.scheduled_at, tz)}
                    </div>
                    {bookingCourtName(b) ? (
                      <div className="small muted">{bookingCourtName(b)}</div>
                    ) : null}
                  </div>
                  <StatusBadge
                    status={b.status}
                    label={bookingDisplayLabel(b, { audience: 'student' })}
                    tone={bookingDisplayTone(b)}
                  />
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {moreUpcoming.length > 0 ? (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="dashboard-upcoming">
          <h2 id="dashboard-upcoming">Upcoming lessons</h2>
          <div className="stack">
            {moreUpcoming.map((b) => (
              <Link key={b.id} to={`/bookings/${b.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="spread">
                  <div>
                    <strong>{b.lesson?.title || 'Lesson'}</strong>
                    <div className="small muted">
                      with {b.coach?.full_name || 'Coach'}
                      {' · '}
                      {formatDateInZone(b.scheduled_at, tz)}
                      {' · '}
                      {formatTimeInZone(b.scheduled_at, tz)}
                    </div>
                    {bookingCourtName(b) ? (
                      <div className="small muted">{bookingCourtName(b)}</div>
                    ) : null}
                  </div>
                  <StatusBadge status={b.status} label={bookingDisplayLabel(b)} tone={bookingDisplayTone(b)} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
