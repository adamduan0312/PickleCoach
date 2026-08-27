import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { formatMilesAway, formatSkillRatingLine, formatReliabilityLabel, formatReliabilityHint, discoverTeachingPlaceLabel } from '../../utils/format.js';
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
import { resolveLocationQuery } from '../../utils/resolveLocationQuery.js';
import {
  captureDiscoverUrlHandoff,
  markDiscoverUrlHandoffDone,
  runDiscoverQHandoffOnce,
} from '../../utils/discoverUrlHandoff.js';

const SKILL_OPTIONS = ['', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0'];
const RADIUS_OPTIONS = [
  { value: '5', label: '5 miles' },
  { value: '10', label: '10 miles' },
  { value: '25', label: '25 miles' },
  { value: '50', label: '50 miles' },
];
const DEFAULT_SEARCH_RADIUS = '25';
const MIN_RATING_OPTIONS = [
  { value: '', label: 'Any rating' },
  { value: '3', label: '3.0+' },
  { value: '4', label: '4.0+' },
  { value: '4.5', label: '4.5+' },
];

export function DiscoverPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    min_skill_rating: '',
    max_skill_rating: '',
    min_rating: '',
    radius: DEFAULT_SEARCH_RADIUS,
  });
  /** @type {null | { lat: number, lng: number, label: string, source: 'geolocation' | 'search' }} */
  const [location, setLocation] = useState(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState(null);
  /** @type {'granted'|'prompt'|'denied'|'unsupported'|null} */
  const [geoPermission, setGeoPermission] = useState(null);
  /** @type {null | { label: string, lat: number, lng: number }[]} */
  const [locationCandidates, setLocationCandidates] = useState(null);
  const [skillError, setSkillError] = useState(null);
  const [applied, setApplied] = useState({
    min_skill_rating: '',
    max_skill_rating: '',
    min_rating: '',
    radius: DEFAULT_SEARCH_RADIUS,
    location: null,
  });
  const [reloadToken, setReloadToken] = useState(0);
  /** Keep latest filters for apply-from-async without stale closures. */
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const skillConflictRef = useRef(false);

  const skillConflict = useMemo(() => {
    if (!filters.min_skill_rating || !filters.max_skill_rating) return false;
    return Number(filters.min_skill_rating) > Number(filters.max_skill_rating);
  }, [filters.min_skill_rating, filters.max_skill_rating]);
  skillConflictRef.current = skillConflict;

  const hasLocation = Boolean(applied.location?.lat != null && applied.location?.lng != null);

  const { data, error, loading } = useAsync(async () => {
    const params = {};
    if (applied.min_skill_rating) params.min_skill_rating = applied.min_skill_rating;
    if (applied.max_skill_rating) params.max_skill_rating = applied.max_skill_rating;
    if (applied.min_rating) params.min_rating = applied.min_rating;
    if (applied.location?.lat != null && applied.location?.lng != null) {
      params.lat = applied.location.lat;
      params.lng = applied.location.lng;
      params.radius = applied.radius || DEFAULT_SEARCH_RADIUS;
    }
    const res = await coachesApi.list(params);
    return asList(res.data);
  }, [JSON.stringify(applied), reloadToken]);

  useEffect(() => {
    if (!skillConflict) setSkillError(null);
  }, [skillConflict]);

  function applyLocation(nextLocation) {
    const f = filtersRef.current;
    if (skillConflictRef.current) {
      setSkillError('Maximum skill cannot be lower than minimum skill.');
      setApplied((prev) => ({
        ...prev,
        radius: f.radius,
        location: nextLocation,
      }));
      return;
    }
    setSkillError(null);
    setApplied({
      min_skill_rating: f.min_skill_rating,
      max_skill_rating: f.max_skill_rating,
      min_rating: f.min_rating,
      radius: f.radius,
      location: nextLocation,
    });
  }

  function applyFilters(nextLocation = location) {
    applyLocation(nextLocation);
  }

  function clearFilters() {
    const cleared = {
      min_skill_rating: '',
      max_skill_rating: '',
      min_rating: '',
      radius: DEFAULT_SEARCH_RADIUS,
    };
    setFilters(cleared);
    setSkillError(null);
    setApplied({
      ...cleared,
      location,
    });
  }

  function clearLocation() {
    setLocation(null);
    setLocationError(null);
    setLocationCandidates(null);
    setApplied((prev) => ({ ...prev, location: null }));
  }

  function chooseLocationResult(result) {
    const next = {
      lat: result.lat,
      lng: result.lng,
      label: result.label,
      source: 'search',
    };
    setLocationCandidates(null);
    setLocationError(null);
    setLocation(next);
    applyLocation(next);
  }

  /**
   * Single path for place text → coordinates (Search button + ?q= bootstrap).
   * Always clears locationBusy in finally.
   */
  async function runLocationQuery(q, { keepQueryText = true } = {}) {
    const trimmed = String(q || '').trim();
    if (keepQueryText) setLocationQuery(trimmed);
    setLocationError(null);
    setLocationCandidates(null);
    setLocationBusy(true);
    try {
      const outcome = await resolveLocationQuery(trimmed);
      if (outcome.status === 'invalid' || outcome.status === 'empty') {
        setLocationError(outcome.message);
        return outcome;
      }
      if (outcome.status === 'ambiguous') {
        setLocationCandidates(outcome.candidates);
        return outcome;
      }
      // resolved
      setLocation(outcome.location);
      setLocationCandidates(null);
      setLocationError(null);
      applyLocation(outcome.location);
      return outcome;
    } catch (err) {
      setLocationError(err?.message || 'Location search failed. Please try again.');
      return { status: 'error', message: err?.message };
    } finally {
      setLocationBusy(false);
    }
  }

  async function useMyLocation() {
    if (geoPermission === 'denied') return;
    setLocationError(null);
    setLocationCandidates(null);
    setLocationBusy(true);
    try {
      const next = await getBrowserPosition();
      writeSessionGeo(next);
      setGeoPermission('granted');
      setLocation(next);
      setLocationQuery('');
      applyLocation(next);
    } catch (err) {
      if (isGeolocationPermissionDenied(err)) setGeoPermission('denied');
      setLocationError(geolocationErrorMessage(err));
    } finally {
      setLocationBusy(false);
    }
  }

  async function searchLocation(e) {
    e?.preventDefault?.();
    await runLocationQuery(locationQuery, { keepQueryText: true });
  }

  // Dashboard / shareable links: ?q=… or ?lat=&lng=&label=…
  // Also: if permission already granted and no URL handoff, quietly use Near you.
  useEffect(() => {
    let cancelled = false;
    /** @type {PermissionStatus | null} */
    let permissionStatus = null;

    async function bootstrap() {
      const permission = await queryGeolocationPermission();
      if (cancelled) return;
      setGeoPermission(permission);

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

      const handoff = captureDiscoverUrlHandoff(searchParams);

      // Consume URL params once so remounts don't re-read them; handoff survives Strict Mode.
      if (searchParams.get('q') || searchParams.get('lat') || searchParams.get('lng')) {
        setSearchParams({}, { replace: true });
      }

      if (handoff) {
        if (handoff.lat != null && handoff.lng != null) {
          const next = {
            lat: handoff.lat,
            lng: handoff.lng,
            label: handoff.label || 'Selected location',
            source: handoff.label === 'Your current location' ? 'geolocation' : 'search',
          };
          if (cancelled) return;
          if (next.source === 'geolocation') writeSessionGeo(next);
          if (handoff.q) setLocationQuery(handoff.q);
          setLocation(next);
          applyLocation(next);
          markDiscoverUrlHandoffDone();
          return;
        }

        if (handoff.q) {
          // Same resolution path as Search; shared promise avoids Strict Mode double geo calls.
          await runDiscoverQHandoffOnce(() => runLocationQuery(handoff.q, { keepQueryText: true }));
          if (!cancelled) markDiscoverUrlHandoffDone();
          return;
        }

        markDiscoverUrlHandoffDone();
        return;
      }

      // No URL handoff: optional Near you when permission already granted.
      if (permission !== 'granted') return;
      const granted = await tryGetGrantedGeolocation();
      if (cancelled || !granted) return;
      setLocation(granted);
      applyLocation(granted);
    }

    bootstrap();
    return () => {
      cancelled = true;
      if (permissionStatus) permissionStatus.onchange = null;
    };
    // Mount-only: handoff module + finally cleanup handle Strict Mode remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onFilterSubmit(e) {
    e.preventDefault();
    applyFilters(location);
  }

  // UX only: dual-role coaches shouldn't see themselves as bookable in Discover.
  // Backend self-booking protection stays unchanged.
  const coaches = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    if (user?.id == null) return list;
    return list.filter((c) => String(c.id) !== String(user.id));
  }, [data, user?.id]);

  const emptyDetail = hasLocation
    ? `No coaches within ${applied.radius || DEFAULT_SEARCH_RADIUS} miles. Try a larger radius, another location, or fewer filters.`
    : 'No coaches match your current filters. Try widening skill or rating, or set a location to search nearby (default 25 miles).';

  return (
    <div className="page discover-page">
      <div className="page-header">
        <div>
          <h1>Find a coach</h1>
          <p className="muted">
            Browse marketplace coaches ready to take bookings.
            {hasLocation
              ? ` Searching within ${applied.radius || DEFAULT_SEARCH_RADIUS} miles.`
              : ' Add a location to search within 25 miles by default.'}
          </p>
        </div>
      </div>

      <section className="card discover-filters" aria-labelledby="discover-location-heading">
        <h2 id="discover-location-heading" className="discover-section-title">Location</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Find coaches near your current location, or search a ZIP, city, or address. Coordinates stay behind the scenes.
        </p>

        <div className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 4 }}>
            <button
              type="button"
              className="btn"
              onClick={useMyLocation}
              disabled={locationBusy || geoPermission === 'denied' || geoPermission === 'unsupported'}
              aria-busy={locationBusy}
              aria-describedby={
                geoPermission === 'denied'
                  ? 'discover-geo-denied'
                  : geoPermission === 'prompt' || geoPermission == null
                    ? 'discover-geo-hint'
                    : undefined
              }
            >
              {locationBusy && !locationQuery ? 'Getting location…' : 'Use my location'}
            </button>
            {geoPermission === 'prompt' || geoPermission == null ? (
              <span id="discover-geo-hint" className="muted small">{LOCATION_ALLOW_HINT}</span>
            ) : null}
          </div>
          {location ? (
            <button type="button" className="btn ghost" onClick={clearLocation} disabled={locationBusy}>
              Clear location
            </button>
          ) : null}
        </div>

        <form onSubmit={searchLocation} className="discover-location-search">
          <div className="field">
            <label htmlFor="location_query">Search another location</label>
            <div className="row" style={{ alignItems: 'stretch' }}>
              <input
                id="location_query"
                name="location_query"
                value={locationQuery}
                onChange={(e) => {
                  setLocationQuery(e.target.value);
                  if (locationCandidates) setLocationCandidates(null);
                }}
                placeholder="ZIP, city + state, or street address"
                autoComplete="street-address"
                disabled={locationBusy}
                style={{ flex: 1, minWidth: 0 }}
                aria-describedby={locationError ? 'location-error' : location ? 'location-active' : 'location-hint'}
              />
              <button className="btn secondary" type="submit" disabled={locationBusy}>
                {locationBusy && locationQuery ? 'Searching…' : 'Search'}
              </button>
            </div>
            <span id="location-hint" className="muted small">
              Examples: 33314 · Davie, FL · 123 Main St, Weston, FL
            </span>
          </div>
        </form>

        {locationBusy ? <p className="muted small" role="status">Looking up location…</p> : null}
        {geoPermission === 'denied' ? (
          <div id="discover-geo-denied" className="alert warning" role="status" style={{ marginTop: 12 }}>
            <strong>{LOCATION_ACCESS_OFF_TITLE}</strong>
            <div className="small" style={{ marginTop: 4 }}>{LOCATION_ACCESS_OFF_DETAIL}</div>
          </div>
        ) : null}
        {locationError && geoPermission !== 'denied' ? (
          <div id="location-error" className="alert error" role="alert" style={{ marginTop: 12 }}>
            {locationError}
          </div>
        ) : null}
        {locationCandidates?.length ? (
          <div className="discover-location-candidates" style={{ marginTop: 12 }} role="listbox" aria-label="Matching locations">
            <p className="small muted" style={{ marginBottom: 8 }}>
              Multiple matches — pick the correct location:
            </p>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
              {locationCandidates.map((c) => (
                <li key={`${c.lat},${c.lng},${c.label}`}>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
                    onClick={() => chooseLocationResult(c)}
                  >
                    {c.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {location && !locationError && !locationCandidates?.length ? (
          <Alert tone="success">
            <span id="location-active">
              {location.source === 'geolocation' ? (
                <>
                  <strong>Near you</strong>
                  {hasLocation
                    ? ` — Showing coaches within ${applied.radius || filters.radius} miles`
                    : null}
                </>
              ) : (
                <>
                  Searching near <strong>{location.label}</strong>
                  {hasLocation ? ` · within ${applied.radius || filters.radius} miles` : ''}
                </>
              )}
            </span>
          </Alert>
        ) : null}
        {!location && !locationError && !locationCandidates?.length ? (
          <Alert tone="info">
            No location set — showing all marketplace coaches. Distance filtering starts after you use your location or search a place.
          </Alert>
        ) : null}
      </section>

      <form className="card discover-filters" onSubmit={onFilterSubmit} style={{ marginTop: 16 }} aria-labelledby="discover-filters-heading">
        <h2 id="discover-filters-heading" className="discover-section-title">Filters</h2>
        <div className="grid-3">
          <div className={`field${skillError ? ' invalid' : ''}`}>
            <label htmlFor="min_skill_rating">Minimum skill</label>
            <select
              id="min_skill_rating"
              value={filters.min_skill_rating}
              onChange={(e) => setFilters((f) => ({ ...f, min_skill_rating: e.target.value }))}
            >
              <option value="">Any</option>
              {SKILL_OPTIONS.filter(Boolean).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className={`field${skillError ? ' invalid' : ''}`}>
            <label htmlFor="max_skill_rating">Maximum skill</label>
            <select
              id="max_skill_rating"
              value={filters.max_skill_rating}
              onChange={(e) => setFilters((f) => ({ ...f, max_skill_rating: e.target.value }))}
            >
              <option value="">Any</option>
              {SKILL_OPTIONS.filter(Boolean).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            {skillError ? <span className="error" role="alert">{skillError}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="min_rating">Minimum review rating</label>
            <select
              id="min_rating"
              value={filters.min_rating}
              onChange={(e) => setFilters((f) => ({ ...f, min_rating: e.target.value }))}
            >
              {MIN_RATING_OPTIONS.map((o) => (
                <option key={o.value || 'any'} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="radius">Search radius</label>
            <select
              id="radius"
              value={filters.radius}
              onChange={(e) => setFilters((f) => ({ ...f, radius: e.target.value }))}
              disabled={!location}
              aria-describedby="radius-hint"
            >
              {RADIUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span id="radius-hint" className="muted small">
              {location
                ? 'Miles from your search point to the coach’s nearest court. Default is 25 miles.'
                : 'Choose a location first — radius only applies with coordinates (default 25 miles).'}
            </span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" type="submit" disabled={skillConflict || locationBusy}>
            Apply filters
          </button>
          <button className="btn secondary" type="button" onClick={clearFilters} disabled={locationBusy}>
            Clear filters
          </button>
        </div>
      </form>

      <div className="discover-results" style={{ marginTop: 16 }} aria-live="polite">
        {loading ? <LoadingState label="Loading coaches…" /> : null}
        {error ? (
          <ErrorState error={error} onRetry={() => setReloadToken((n) => n + 1)} />
        ) : null}
        {!loading && !error && coaches.length === 0 ? (
          <EmptyState
            title={hasLocation ? 'No coaches in this search area' : 'No coaches match your filters'}
            detail={emptyDetail}
            action={(
              <div className="row">
                {hasLocation ? (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      const ladder = ['5', '10', '25', '50'];
                      const idx = ladder.indexOf(String(applied.radius || filters.radius));
                      const nextRadius = ladder[Math.min(ladder.length - 1, Math.max(0, idx) + 1)];
                      setFilters((f) => ({ ...f, radius: nextRadius }));
                      setApplied((prev) => ({ ...prev, radius: nextRadius }));
                    }}
                  >
                    Increase radius
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={useMyLocation}
                    disabled={geoPermission === 'denied' || geoPermission === 'unsupported'}
                  >
                    Use my location
                  </button>
                )}
                <button type="button" className="btn ghost" onClick={clearFilters}>
                  Remove filters
                </button>
              </div>
            )}
          />
        ) : null}

        {!loading && !error && coaches.length > 0 ? (
          <>
            <p className="muted small discover-results-summary">
              {coaches.length} coach{coaches.length === 1 ? '' : 'es'}
              {hasLocation
                ? (applied.location?.source === 'geolocation'
                  ? ` within ${applied.radius} miles of you`
                  : ` within ${applied.radius} miles of ${applied.location.label}`)
                : ' · set a location to filter by distance (25-mile default)'}
            </p>
            <div className="grid-2 discover-coach-grid">
              {coaches.map((coach) => {
                const teachingLocation = discoverTeachingPlaceLabel(coach, { hasLocation });
                const distanceAway = hasLocation ? formatMilesAway(coach.distance_miles) : null;
                const skillLine = formatSkillRatingLine(coach.skill_rating, coach.rating_system);
                const reliabilityLine = formatReliabilityLabel(coach.reliability_score);
                const ratingText = coach.rating_average != null
                  ? `${Number(coach.rating_average).toFixed(1)} · ${coach.rating_count || 0} review${Number(coach.rating_count) === 1 ? '' : 's'}`
                  : 'No reviews yet';
                return (
                  <Link
                    key={coach.id}
                    to={`/coaches/${coach.id}`}
                    className="card clickable discover-coach-card"
                  >
                    <div className="discover-coach-card-top">
                      <Avatar name={coach.full_name} src={coach.avatar_url} size="lg" />
                      <div className="discover-coach-card-identity">
                        <h2 className="discover-coach-name">{coach.full_name}</h2>
                        <p className="discover-coach-headline">{coach.headline || 'Pickleball coach'}</p>
                        {(teachingLocation || distanceAway) ? (
                          <p className="discover-coach-place">
                            {teachingLocation ? <span>{teachingLocation}</span> : null}
                            {teachingLocation && distanceAway ? <span aria-hidden="true"> · </span> : null}
                            {distanceAway ? <span className="discover-coach-distance">{distanceAway}</span> : null}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <ul className="discover-coach-stats" aria-label="Coach highlights">
                      <li>
                        <span className="discover-stat-label">Reviews</span>
                        <span className="discover-stat-value">
                          {coach.rating_average != null ? (
                            <>
                              <span className="discover-stat-star" aria-hidden="true">★</span>
                              {' '}
                              {ratingText}
                            </>
                          ) : ratingText}
                        </span>
                      </li>
                      {skillLine ? (
                        <li>
                          <span className="discover-stat-label">Skill</span>
                          <span className="discover-stat-value">{skillLine}</span>
                        </li>
                      ) : null}
                      {reliabilityLine ? (
                        <li title={formatReliabilityHint()}>
                          <span className="discover-stat-label">Reliability</span>
                          <span className="discover-stat-value">{reliabilityLine.replace(/^Reliability:\s*/i, '')}</span>
                        </li>
                      ) : null}
                    </ul>
                    <span className="btn secondary discover-card-cta">View profile</span>
                  </Link>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
