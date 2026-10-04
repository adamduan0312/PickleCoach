import { useEffect, useMemo, useRef, useState } from 'react';
import { coachesApi, courtsApi, geoApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { CHAR_LIMITS } from '../../utils/charLimits.js';
import { courtLabel, formatCourtAddressLines, formatMiles } from '../../utils/format.js';
import {
  COURT_DISCOVERY_PENDING_NOTE,
  classifyCourtSearch,
  cleanLocationQuery,
  isCourtAlreadyLinked,
  isCourtDiscoveryPending,
  linkedCourtIdSet,
  placeFromDirectoryMatches,
  splitPastedCourtAddress,
} from '../../utils/coachCourts.js';

/** Discovery radius for location searches — does not limit where a coach may teach. */
const SEARCH_RADIUS_OPTIONS = [
  { value: '5', label: '5 miles' },
  { value: '10', label: '10 miles' },
  { value: '25', label: '25 miles' },
  { value: '50', label: '50 miles' },
  { value: '100', label: '100 miles' },
];

function CourtAddressBlock({ court }) {
  const lines = formatCourtAddressLines(court);
  if (!lines.length) {
    return <div className="small muted">Address on file is incomplete — confirm before teaching here.</div>;
  }
  return (
    <div className="small muted">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

export function CoachCourtsPage() {
  const { data, error, loading, setData } = useAsync(async () => {
    const res = await coachesApi.myCourts();
    return asList(res.data);
  }, []);

  const [searchQ, setSearchQ] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  // What the results are for: { kind: 'court', query, canSearchNear } | { kind: 'location', label, detail, radius }
  const [resultsFor, setResultsFor] = useState(null);
  const [origin, setOrigin] = useState(null); // { lat, lng, label, detail } | null
  const [discoveryPending, setDiscoveryPending] = useState(false);
  const [searchRadius, setSearchRadius] = useState('25');

  const [showCreate, setShowCreate] = useState(false);
  const createSectionRef = useRef(null);
  const [form, setForm] = useState({
    name: '',
    address_line1: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'US',
    is_private: false,
  });
  const [resolved, setResolved] = useState(null); // { label, lat, lng }
  const [geoBusy, setGeoBusy] = useState(false);
  const [dupState, setDupState] = useState(null); // { high_confidence, possible } | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [message, setMessage] = useState(null);

  function update(e) {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    setResolved(null);
    setDupState(null);
  }

  async function reloadLinks() {
    const res = await coachesApi.myCourts();
    setData(asList(res.data));
  }

  useEffect(() => {
    if (showCreate) createSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showCreate]);

  /** Runs a search with shared busy/error handling. */
  async function withSearch(fn) {
    setSearchError(null);
    setMessage(null);
    setSearchBusy(true);
    try {
      await fn();
    } catch (ex) {
      setSearchError(ex.message);
      setSearchResults(null);
      setResultsFor(null);
      setDiscoveryPending(false);
    } finally {
      setSearchBusy(false);
    }
  }

  function showDirectoryResults(q, courts, { canSearchNear = false } = {}) {
    setOrigin(null);
    setSearchResults(courts);
    setResultsFor({ kind: 'court', query: q, canSearchNear });
    setDiscoveryPending(false);
  }

  async function searchCourtFields(q) {
    const res = await courtsApi.search({ q });
    showDirectoryResults(q, asList(res.data));
  }

  /** Bare names: a city in the directory ("Weston") searches nearby; anything else is a name search. */
  async function searchPlaceOrCourt(q) {
    const res = await courtsApi.search({ q });
    const courts = asList(res.data);
    const place = placeFromDirectoryMatches(q, courts);
    if (place) {
      const label = `${place.city}, ${place.state}`;
      try {
        await searchNearPlace(label, label);
        return;
      } catch {
        // Geocoder unavailable: the directory matches below are still useful.
      }
    }
    showDirectoryResults(q, courts, { canSearchNear: courts.length === 0 });
  }

  async function searchNearOrigin(place, radius = searchRadius) {
    const miles = Number(radius) || 25;
    const res = await courtsApi.search({ lat: place.lat, lng: place.lng, radius: miles });
    setOrigin(place);
    setSearchResults(asList(res.data));
    setResultsFor({ kind: 'location', label: place.label, detail: place.detail, radius: miles });
    setDiscoveryPending(isCourtDiscoveryPending(res));
  }

  async function searchNearPlace(q, label = q) {
    const res = await geoApi.search({ q, limit: 1 });
    const best = Array.isArray(res.data?.results) ? res.data.results[0] : null;
    if (!best) {
      throw new Error('We couldn’t find that location. Try a ZIP, a city and state (e.g. Davie, FL), or a street address.');
    }
    await searchNearOrigin({ lat: best.lat, lng: best.lng, label, detail: best.label === label ? null : best.label });
  }

  function runSearch(e) {
    e?.preventDefault?.();
    const q = searchQ.trim();
    if (!q) {
      setSearchError('Enter a court name, city, ZIP code, or address.');
      return undefined;
    }
    const kind = classifyCourtSearch(q);
    return withSearch(() => {
      if (kind === 'location') return searchNearPlace(q, cleanLocationQuery(q) || q);
      if (kind === 'place_or_court') return searchPlaceOrCourt(q);
      return searchCourtFields(q);
    });
  }

  function useNearby() {
    if (!navigator.geolocation) {
      setSearchError('This browser does not support location.');
      return;
    }
    withSearch(async () => {
      let pos;
      try {
        pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 15000,
            maximumAge: 60_000,
          });
        });
      } catch {
        throw new Error('Could not get your location. Search for a city, ZIP code, or address instead.');
      }
      await searchNearOrigin({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        label: 'your current location',
        detail: null,
      });
    });
  }

  function onRadiusChange(e) {
    const next = e.target.value;
    setSearchRadius(next);
    if (origin && resultsFor?.kind === 'location') withSearch(() => searchNearOrigin(origin, next));
  }

  function clearSearch() {
    setOrigin(null);
    setSearchResults(null);
    setResultsFor(null);
    setDiscoveryPending(false);
    setSearchError(null);
  }

  function openCreate() {
    setShowCreate(true);
    setErr(null);
  }

  async function selectExisting(court) {
    setBusy(true);
    setErr(null);
    setMessage(null);
    try {
      await coachesApi.addCourt({ court_id: court.id });
      await reloadLinks();
      setMessage(`Linked ${court.name}.`);
      setShowCreate(false);
      setDupState(null);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  /** A whole address pasted into Street address (often with a Plus Code) fills the empty fields. */
  function withPastedAddressSplit(f) {
    const pasted = splitPastedCourtAddress(f.address_line1);
    if (!pasted) return f;
    return {
      ...f,
      address_line1: pasted.address_line1,
      city: f.city.trim() || pasted.city,
      state: f.state.trim() || pasted.state,
      postal_code: f.postal_code.trim() || pasted.postal_code,
    };
  }

  function onStreetBlur() {
    const f = withPastedAddressSplit(form);
    if (f === form) return;
    setForm(f);
    setResolved(null);
    setDupState(null);
  }

  async function confirmAddress(e) {
    e.preventDefault();
    setErr(null);
    setDupState(null);
    setResolved(null);

    const f = withPastedAddressSplit(form);
    if (f !== form) setForm(f);

    if (!f.name.trim() || !f.address_line1.trim() || !f.city.trim() || !f.state.trim() || !f.postal_code.trim()) {
      setErr('Fill in name and full address before confirming location.');
      return;
    }
    const q = [f.address_line1, f.city, f.state, f.postal_code].map((s) => s.trim()).join(', ');
    setGeoBusy(true);
    try {
      const res = await geoApi.search({ q, limit: 5 });
      const results = Array.isArray(res.data?.results) ? res.data.results : [];
      if (!results.length) {
        setErr(`Could not find “${q}”. Check the street number and name, city, state, and ZIP.`);
        return;
      }
      const best = results[0];
      const next = { label: best.label, lat: best.lat, lng: best.lng };
      setResolved(next);

      const check = await courtsApi.duplicateCheck({
        name: f.name.trim(),
        address_line1: f.address_line1.trim(),
        city: f.city.trim(),
        state: String(f.state).toUpperCase(),
        postal_code: f.postal_code.trim(),
        country: 'US',
        latitude: best.lat,
        longitude: best.lng,
      });
      setDupState(check.data || { high_confidence: [], possible: [] });
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setGeoBusy(false);
    }
  }

  async function createNew({ acknowledgePossible = false } = {}) {
    if (!resolved) {
      setErr('Confirm the address location before creating.');
      return;
    }
    if (dupState?.high_confidence?.length) {
      setErr('A very likely match already exists. Select that court instead of creating a new one.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await courtsApi.create({
        name: form.name.trim(),
        address_line1: form.address_line1.trim(),
        city: form.city.trim(),
        state: String(form.state).toUpperCase(),
        postal_code: form.postal_code.trim(),
        country: 'US',
        is_private: form.is_private,
        latitude: resolved.lat,
        longitude: resolved.lng,
        acknowledge_possible_duplicates: acknowledgePossible,
      });
      await reloadLinks();
      setMessage('Court saved and linked to your profile.');
      setForm({
        name: '',
        address_line1: '',
        city: '',
        state: '',
        postal_code: '',
        country: 'US',
        is_private: false,
      });
      setResolved(null);
      setDupState(null);
      setShowCreate(false);
    } catch (ex) {
      if (ex.code === 'COURT_DUPLICATE_HIGH' || ex.code === 'COURT_DUPLICATE_POSSIBLE') {
        setDupState(ex.payload?.data || { high_confidence: [], possible: [] });
        setErr(ex.message);
      } else {
        setErr(ex.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function unlink(courtId) {
    try {
      await coachesApi.removeCourt(courtId);
      await reloadLinks();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  const high = dupState?.high_confidence || [];
  const possible = dupState?.possible || [];
  const linkedIds = useMemo(() => linkedCourtIdSet(data), [data]);

  function CourtSelectAction({ court }) {
    if (isCourtAlreadyLinked(linkedIds, court)) {
      return (
        <span className="btn secondary" aria-disabled="true" style={{ pointerEvents: 'none', opacity: 0.85 }}>
          Already added
        </span>
      );
    }
    return (
      <button className="btn" type="button" disabled={busy} onClick={() => selectExisting(court)}>
        Select
      </button>
    );
  }

  return (
    <div className="page">
      <h1>Courts</h1>
      <p className="muted">
        Find the courts where you teach and link them to your profile. Only add a new location when it is not
        already listed (or when it is private/custom).
      </p>
      <Alert tone="error">{err}</Alert>
      <Alert tone="success">{message}</Alert>

      <section className="card stack" style={{ maxWidth: 720, marginBottom: 16 }}>
        <h2>Find a court</h2>
        <form onSubmit={runSearch} className="stack">
          <div className="row" style={{ gap: 8, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <FormField
                label="Search by court name, city, ZIP code, or address."
                name="court_search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="e.g. Holiday Park, Weston, or 33328"
              />
            </div>
            <button className="btn" type="submit" disabled={searchBusy}>
              {searchBusy ? 'Searching…' : 'Search'}
            </button>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button className="btn secondary" type="button" onClick={useNearby} disabled={searchBusy}>
              Use my current location
            </button>
            {resultsFor?.kind === 'location' ? (
              <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
                Radius:
                <select aria-label="Search radius" value={searchRadius} onChange={onRadiusChange} disabled={searchBusy}>
                  {SEARCH_RADIUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {searchResults ? (
              <button className="btn ghost" type="button" onClick={clearSearch}>
                Clear
              </button>
            ) : null}
          </div>
          {searchError ? <div className="alert error">{searchError}</div> : null}
        </form>

        {searchResults && resultsFor ? (
          <div className="stack">
            <div className="spread" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div>
                <strong>
                  {resultsFor.kind === 'location'
                    ? `Courts within ${resultsFor.radius} miles of ${resultsFor.label}`
                    : `Courts matching “${resultsFor.query}”`}
                </strong>
                <div className="small muted">
                  {searchResults.length} court{searchResults.length === 1 ? '' : 's'}
                  {resultsFor.kind === 'location' && resultsFor.detail ? ` · centered on ${resultsFor.detail}` : ''}
                </div>
                {resultsFor.kind === 'court' && resultsFor.canSearchNear ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={searchBusy}
                    onClick={() => withSearch(() => searchNearPlace(resultsFor.query))}
                  >
                    Search for courts near “{resultsFor.query}” instead
                  </button>
                ) : null}
              </div>
              {!showCreate ? (
                <button className="btn ghost" type="button" onClick={openCreate}>
                  Can&apos;t find your court? Add a new location
                </button>
              ) : null}
            </div>
            {discoveryPending ? <p className="small muted">{COURT_DISCOVERY_PENDING_NOTE}</p> : null}
            {searchResults.length === 0 ? (
              <EmptyState
                title="No matching courts in PickleCoach"
                detail={
                  resultsFor.kind === 'location'
                    ? 'Try a larger search radius, or add the location if this court is not in the directory yet.'
                    : 'Try another name, a city, ZIP code, or address, or add the location if this court is not in the directory yet.'
                }
              />
            ) : null}
            {searchResults.map((court) => (
              <div key={court.id} className="card spread">
                <div>
                  <strong>{court.name}</strong>
                  <CourtAddressBlock court={court} />
                  {court.distance_miles != null ? (
                    <div className="small muted">{formatMiles(court.distance_miles)}</div>
                  ) : null}
                </div>
                <CourtSelectAction court={court} />
              </div>
            ))}
          </div>
        ) : !showCreate ? (
          <button className="btn ghost" type="button" onClick={openCreate}>
            Can&apos;t find your court? Add a new location
          </button>
        ) : null}
      </section>

      {showCreate ? (
        <section ref={createSectionRef} className="card stack" style={{ maxWidth: 720, marginBottom: 16, scrollMarginTop: 16 }}>
          <div className="spread">
            <h2>Add a new location</h2>
            <button className="btn ghost" type="button" onClick={() => { setShowCreate(false); setDupState(null); setResolved(null); }}>
              Cancel
            </button>
          </div>
          <form className="stack" onSubmit={confirmAddress}>
            <FormField label="Name" name="name" value={form.name} onChange={update} required maxLength={CHAR_LIMITS.courtName} />
            <FormField
              label="Street address"
              name="address_line1"
              value={form.address_line1}
              onChange={update}
              onBlur={onStreetBlur}
              required
              maxLength={CHAR_LIMITS.courtAddress}
              hint="You can paste a full address — we’ll split it into the fields below."
            />
            <FormField label="City" name="city" value={form.city} onChange={update} required maxLength={CHAR_LIMITS.courtCity} />
            <FormField label="State (2-letter)" name="state" value={form.state} onChange={update} required maxLength={2} />
            <FormField label="ZIP" name="postal_code" value={form.postal_code} onChange={update} required />
            <label className="row">
              <input type="checkbox" name="is_private" checked={form.is_private} onChange={update} />
              Private court (exact address hidden from public directory / students until booking rules allow)
            </label>
            <button className="btn secondary" type="submit" disabled={geoBusy || busy}>
              {geoBusy ? 'Confirming address…' : 'Confirm address location'}
            </button>
          </form>

          {resolved ? (
            <Alert tone="info">
              Resolved location: <strong>{resolved.label}</strong>
            </Alert>
          ) : null}

          {high.length > 0 ? (
            <div className="stack">
              <Alert tone="warning">
                We found a court that is very likely this location. Select it instead of creating a duplicate.
              </Alert>
              {high.map((c) => (
                <div key={c.id} className="card spread">
                  <div>
                    <strong>{c.name}</strong>
                    <CourtAddressBlock court={c} />
                    {c.distance_miles != null ? <div className="small muted">{formatMiles(c.distance_miles)} away</div> : null}
                  </div>
                  {isCourtAlreadyLinked(linkedIds, c) ? (
                    <span className="btn secondary" aria-disabled="true" style={{ pointerEvents: 'none', opacity: 0.85 }}>
                      Already added
                    </span>
                  ) : (
                    <button className="btn" type="button" disabled={busy} onClick={() => selectExisting(c)}>
                      Use this court
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {high.length === 0 && possible.length > 0 ? (
            <div className="stack">
              <Alert tone="warning">
                Nearby courts may already be this location. Review them, or confirm yours is different.
              </Alert>
              {possible.map((c) => (
                <div key={c.id} className="card spread">
                  <div>
                    <strong>{c.name}</strong>
                    <CourtAddressBlock court={c} />
                    {c.distance_miles != null ? <div className="small muted">{formatMiles(c.distance_miles)} away</div> : null}
                  </div>
                  {isCourtAlreadyLinked(linkedIds, c) ? (
                    <span className="btn secondary" aria-disabled="true" style={{ pointerEvents: 'none', opacity: 0.85 }}>
                      Already added
                    </span>
                  ) : (
                    <button className="btn" type="button" disabled={busy} onClick={() => selectExisting(c)}>
                      Use this court
                    </button>
                  )}
                </div>
              ))}
              <button
                className="btn secondary"
                type="button"
                disabled={busy || !resolved}
                onClick={() => createNew({ acknowledgePossible: true })}
              >
                This is a different location — create new
              </button>
            </div>
          ) : null}

          {resolved && high.length === 0 && possible.length === 0 ? (
            <button className="btn" type="button" disabled={busy} onClick={() => createNew()}>
              {busy ? 'Saving…' : 'Create court'}
            </button>
          ) : null}
        </section>
      ) : null}

      <h2>Your teaching locations</h2>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && (!data || data.length === 0) ? <EmptyState title="No courts linked" /> : null}
      <div className="stack">
        {(data || []).map((link) => {
          const court = link.court || link;
          const courtId = link.court_id || court.id;
          return (
            <div key={link.id || courtId} className="card spread">
              <div>
                <strong>{court.name || courtLabel(court)}</strong>
                <CourtAddressBlock court={court} />
                {link.coach_notes ? <div className="small muted">{link.coach_notes}</div> : null}
              </div>
              <button className="btn ghost" type="button" onClick={() => unlink(courtId)}>Unlink</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
