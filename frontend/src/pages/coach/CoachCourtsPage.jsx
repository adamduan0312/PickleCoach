import { useEffect, useMemo, useRef, useState } from 'react';
import { coachesApi, courtsApi, geoApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { SetupNextStep } from '../../components/coach/CoachOnboarding.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { CHAR_LIMITS } from '../../utils/charLimits.js';
import { courtLabel, formatCourtAddressLines, formatMiles } from '../../utils/format.js';
import {
  COURT_DISCOVERY_FAILED_NOTE,
  COURT_DISCOVERY_PENDING_EMPTY,
  COURT_DISCOVERY_PENDING_NOTE,
  cleanLocationQuery,
  courtDiscoveryView,
  isCourtAlreadyLinked,
  linkedCourtIdSet,
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
  const [resultsFor, setResultsFor] = useState(null); // { label, detail, radius } | null
  const [origin, setOrigin] = useState(null); // { lat, lng, label, detail } | null
  const [discovery, setDiscovery] = useState(null); // 'pending' | 'failed' | null (checked / n.a.)
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
  });
  const [resolved, setResolved] = useState(null); // { label, lat, lng }
  const [geoBusy, setGeoBusy] = useState(false);
  const [dupState, setDupState] = useState(null); // { high_confidence, possible } | null
  const [busy, setBusy] = useState(false);
  // Errors render in the section that caused them.
  const [addressErr, setAddressErr] = useState(null); // Add a new location: address / confirm step
  const [saveErr, setSaveErr] = useState(null); // Add a new location: select / create step
  const [listErr, setListErr] = useState(null); // Your teaching locations
  const [message, setMessage] = useState(null);

  function update(e) {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    setResolved(null);
    setDupState(null);
    setAddressErr(null);
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
      setDiscovery(null);
    } finally {
      setSearchBusy(false);
    }
  }

  async function searchNearOrigin(place, radius = searchRadius) {
    const miles = Number(radius) || 25;
    const res = await courtsApi.search({ lat: place.lat, lng: place.lng, radius: miles });
    setOrigin(place);
    setSearchResults(asList(res.data));
    setResultsFor({ label: place.label, detail: place.detail, radius: miles });
    setDiscovery(courtDiscoveryView(res));
  }

  /** Geocode the typed place; the header names what it resolved to ("Weston" → Weston, FL). */
  async function searchNearPlace(q) {
    const res = await geoApi.search({ q, limit: 5 });
    const best = Array.isArray(res.data?.results) ? res.data.results[0] : null;
    if (!best) {
      throw new Error('We couldn’t find that location. Try a ZIP code, a city and state (e.g. Davie, FL), or a street address.');
    }
    const label = best.place || cleanLocationQuery(q) || q;
    await searchNearOrigin({
      lat: best.lat,
      lng: best.lng,
      label,
      detail: best.label === label ? null : best.label,
    });
  }

  function runSearch(e) {
    e?.preventDefault?.();
    const q = searchQ.trim();
    if (!q) {
      setSearchError('Enter a city, ZIP code, or address.');
      return undefined;
    }
    return withSearch(() => searchNearPlace(q));
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
    if (origin) withSearch(() => searchNearOrigin(origin, next));
  }

  function clearSearch() {
    setOrigin(null);
    setSearchResults(null);
    setResultsFor(null);
    setDiscovery(null);
    setSearchError(null);
  }

  function openCreate() {
    setShowCreate(true);
    setAddressErr(null);
    setSaveErr(null);
  }

  /** `fromSearch`: picked in Find a court results (else from the duplicate list under Add a new location). */
  async function selectExisting(court, { fromSearch = false } = {}) {
    const setErr = fromSearch ? setSearchError : setSaveErr;
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
    setAddressErr(null);
    setSaveErr(null);
    setDupState(null);
    setResolved(null);

    const f = withPastedAddressSplit(form);
    if (f !== form) setForm(f);

    if (!f.name.trim() || !f.address_line1.trim() || !f.city.trim() || !f.state.trim() || !f.postal_code.trim()) {
      setAddressErr('Fill in name and full address before confirming location.');
      return;
    }
    const q = [f.address_line1, f.city, f.state, f.postal_code].map((s) => s.trim()).join(', ');
    setGeoBusy(true);
    try {
      const res = await geoApi.search({ q, limit: 5 });
      const results = Array.isArray(res.data?.results) ? res.data.results : [];
      if (!results.length) {
        setAddressErr('Could not find this address. Check the street number and name, city, state, and ZIP.');
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
      setAddressErr(ex.message);
    } finally {
      setGeoBusy(false);
    }
  }

  async function createNew({ acknowledgePossible = false } = {}) {
    if (!resolved) {
      setSaveErr('Confirm the address location before creating.');
      return;
    }
    setBusy(true);
    setSaveErr(null);
    try {
      await courtsApi.create({
        name: form.name.trim(),
        address_line1: form.address_line1.trim(),
        city: form.city.trim(),
        state: String(form.state).toUpperCase(),
        postal_code: form.postal_code.trim(),
        country: 'US',
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
      });
      setResolved(null);
      setDupState(null);
      setShowCreate(false);
    } catch (ex) {
      if (ex.code === 'COURT_DUPLICATE_HIGH' || ex.code === 'COURT_DUPLICATE_POSSIBLE') {
        setDupState(ex.payload?.data || { high_confidence: [], possible: [] });
      }
      setSaveErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(courtId) {
    setListErr(null);
    try {
      await coachesApi.removeCourt(courtId);
      await reloadLinks();
    } catch (ex) {
      setListErr(ex.message);
    }
  }

  const high = dupState?.high_confidence || [];
  const possible = dupState?.possible || [];
  const nearbyMatches = [...high, ...possible];
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
      <button className="btn" type="button" disabled={busy} onClick={() => selectExisting(court, { fromSearch: true })}>
        Select
      </button>
    );
  }

  return (
    <div className="page">
      <h1>Courts</h1>
      <p className="muted">
        Find the courts where you teach and link them to your profile. Only add a new location when it is not
        already listed.
      </p>
      <Alert tone="success">{message}</Alert>
      <SetupNextStep step="court" refreshKey={message} />

      <section className="card stack" style={{ maxWidth: 720, marginBottom: 16 }}>
        <h2>Find a court</h2>
        <form onSubmit={runSearch} className="stack">
          <div className="row" style={{ gap: 8, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <FormField
                label="Where do you teach? Search a city, ZIP code, or address."
                name="court_search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="e.g. Weston, FL or 33328"
              />
            </div>
            <label className="row small" style={{ gap: 6, alignItems: 'center', paddingBottom: 8 }}>
              Radius:
              <select aria-label="Search radius" value={searchRadius} onChange={onRadiusChange} disabled={searchBusy}>
                {SEARCH_RADIUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit" disabled={searchBusy}>
              {searchBusy ? 'Searching…' : 'Search'}
            </button>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button className="btn secondary" type="button" onClick={useNearby} disabled={searchBusy}>
              Use my current location
            </button>
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
                <strong>{`Courts within ${resultsFor.radius} miles of ${resultsFor.label}`}</strong>
                <div className="small muted">
                  {searchResults.length} court{searchResults.length === 1 ? '' : 's'}
                  {resultsFor.detail ? ` · centered on ${resultsFor.detail}` : ''}
                </div>
              </div>
              {!showCreate ? (
                <button className="btn ghost" type="button" onClick={openCreate}>
                  Can&apos;t find your court? Add a new location
                </button>
              ) : null}
            </div>
            {discovery === 'pending' && searchResults.length > 0 ? (
              <p className="small muted">{COURT_DISCOVERY_PENDING_NOTE}</p>
            ) : null}
            {discovery === 'failed' && searchResults.length > 0 ? (
              <p className="small muted">{COURT_DISCOVERY_FAILED_NOTE}</p>
            ) : null}
            {searchResults.length === 0 && discovery === 'pending' ? (
              <EmptyState title="No courts found yet" detail={COURT_DISCOVERY_PENDING_EMPTY} />
            ) : null}
            {searchResults.length === 0 && discovery === 'failed' ? (
              <EmptyState
                title="We couldn’t check this area for new courts right now"
                detail="Try again in a few minutes, or add the location if you know a court here."
              />
            ) : null}
            {searchResults.length === 0 && !discovery ? (
              <EmptyState
                title="No courts found in this area"
                detail="Try a larger search radius, or add the location if this court is not in the directory yet."
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
          <p className="small muted">Locations you add are listed in the shared court directory with their address.</p>
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
            <Alert tone="error">{addressErr}</Alert>
            <button className="btn secondary" type="submit" disabled={geoBusy || busy}>
              {geoBusy ? 'Confirming address…' : 'Confirm address location'}
            </button>
          </form>

          {resolved ? (
            <Alert tone="info">
              Resolved location: <strong>{resolved.label}</strong>
              <div className="small">
                Please double-check that the location name, address, and resolved location are correct before adding this location.
              </div>
            </Alert>
          ) : null}

          <Alert tone="error">{saveErr}</Alert>

          {nearbyMatches.length > 0 ? (
            <div className="stack">
              <Alert tone="warning">
                {high.length > 0
                  ? 'There’s already a court here that looks like the same location. Use it if it’s the same place, or create yours if it’s different.'
                  : 'There are courts nearby that may be the same location. Use one if it’s the same place, or create yours if it’s different.'}
              </Alert>
              {nearbyMatches.map((c) => (
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
                {busy ? 'Saving…' : 'This is a different location — create new'}
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
      <Alert tone="error">{listErr}</Alert>
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
