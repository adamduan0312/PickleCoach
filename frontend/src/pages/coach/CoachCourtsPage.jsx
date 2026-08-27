import { useMemo, useState } from 'react';
import { coachesApi, courtsApi, geoApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { courtLabel, formatCourtAddressLines, formatMiles } from '../../utils/format.js';
import { isCourtAlreadyLinked, linkedCourtIdSet } from '../../utils/coachCourts.js';

/** Discovery radius for Courts near me / text+geo search — does not limit where a coach may teach. */
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
  const [nearMe, setNearMe] = useState(null); // { lat, lng } | null
  const [searchRadius, setSearchRadius] = useState('25');

  const [showCreate, setShowCreate] = useState(false);
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

  async function runSearch(e) {
    e?.preventDefault?.();
    const q = searchQ.trim();
    setSearchError(null);
    setMessage(null);
    if (!q && !nearMe) {
      setSearchError('Enter a court name, ZIP, city, or address — or use Courts near me.');
      return;
    }
    setSearchBusy(true);
    try {
      const params = {};
      if (q) params.q = q;
      if (nearMe) {
        params.lat = nearMe.lat;
        params.lng = nearMe.lng;
        params.radius = Number(searchRadius) || 25;
      }
      const res = await courtsApi.search(params);
      setSearchResults(asList(res.data));
    } catch (ex) {
      setSearchError(ex.message);
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
    }
  }

  async function searchNearCoords(coords, { q = searchQ.trim(), radius = searchRadius } = {}) {
    const params = {
      lat: coords.lat,
      lng: coords.lng,
      radius: Number(radius) || 25,
    };
    if (q) params.q = q;
    const res = await courtsApi.search(params);
    setSearchResults(asList(res.data));
  }

  async function useNearby() {
    setSearchError(null);
    setMessage(null);
    if (!navigator.geolocation) {
      setSearchError('This browser does not support location.');
      return;
    }
    setSearchBusy(true);
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60_000,
        });
      });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setNearMe(coords);
      await searchNearCoords(coords);
    } catch {
      setSearchError('Could not get your location. Search by name, ZIP, city, or address instead.');
    } finally {
      setSearchBusy(false);
    }
  }

  async function onRadiusChange(e) {
    const next = e.target.value;
    setSearchRadius(next);
    if (!nearMe) return;
    setSearchError(null);
    setSearchBusy(true);
    try {
      await searchNearCoords(nearMe, { radius: next });
    } catch (ex) {
      setSearchError(ex.message);
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
    }
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

  async function confirmAddress(e) {
    e.preventDefault();
    setErr(null);
    setDupState(null);
    setResolved(null);
    const q = [form.address_line1, form.city, form.state, form.postal_code].filter(Boolean).join(', ');
    if (!form.name.trim() || !form.address_line1.trim() || !form.city.trim() || !form.state.trim() || !form.postal_code.trim()) {
      setErr('Fill in name and full address before confirming location.');
      return;
    }
    setGeoBusy(true);
    try {
      const res = await geoApi.search({ q, limit: 5 });
      const results = Array.isArray(res.data?.results) ? res.data.results : [];
      if (!results.length) {
        setErr('Could not resolve that address. Check spelling or try a fuller street address.');
        return;
      }
      const best = results[0];
      const next = { label: best.label, lat: best.lat, lng: best.lng };
      setResolved(next);

      const check = await courtsApi.duplicateCheck({
        name: form.name.trim(),
        address_line1: form.address_line1.trim(),
        city: form.city.trim(),
        state: String(form.state).toUpperCase(),
        postal_code: form.postal_code.trim(),
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
        Search PickleCoach courts and link any court where you teach. Use Courts near me with a search radius
        to browse nearby, or search by name/ZIP/city/address. Only add a new location when it is not already
        listed (or when it is private/custom).
      </p>
      <Alert tone="error">{err}</Alert>
      <Alert tone="success">{message}</Alert>

      <section className="card stack" style={{ maxWidth: 720, marginBottom: 16 }}>
        <h2>Find a court</h2>
        <form onSubmit={runSearch} className="stack">
          <FormField
            label="Search by court name, ZIP, city, or address"
            name="court_search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="e.g. Holiday Park or 33328"
          />
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
            <button className="btn" type="submit" disabled={searchBusy}>
              {searchBusy ? 'Searching…' : 'Search'}
            </button>
            <button className="btn secondary" type="button" onClick={useNearby} disabled={searchBusy}>
              {searchBusy && nearMe ? 'Finding courts…' : 'Courts near me'}
            </button>
            <div className="stack" style={{ gap: 4 }}>
              <label htmlFor="court-search-radius" className="small muted">
                Search radius
              </label>
              <select
                id="court-search-radius"
                value={searchRadius}
                onChange={onRadiusChange}
                disabled={searchBusy}
                aria-describedby="court-search-radius-hint"
              >
                {SEARCH_RADIUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {nearMe ? (
              <button
                className="btn ghost"
                type="button"
                onClick={() => { setNearMe(null); setSearchResults(null); }}
              >
                Clear nearby
              </button>
            ) : null}
          </div>
          <p id="court-search-radius-hint" className="small muted">
            {nearMe
              ? `Showing public courts within about ${searchRadius} miles of your current location. Search radius is for discovery only — you can still link any court you teach at.`
              : 'Radius applies after you use Courts near me (or with an active nearby location). Text search without nearby looks up the PickleCoach directory by name/address.'}
          </p>
          {searchError ? <div className="alert error">{searchError}</div> : null}
        </form>

        {searchResults ? (
          searchResults.length === 0 ? (
            <EmptyState
              title="No matching courts in PickleCoach"
              detail={
                nearMe
                  ? 'Try a larger search radius, another name, or add a location manually if this court is not in the directory yet.'
                  : 'Try another search, Courts near me, or add a new location if this court is not in the directory yet.'
              }
            />
          ) : (
            <div className="stack">
              <p className="small muted">{searchResults.length} match{searchResults.length === 1 ? '' : 'es'}</p>
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
          )
        ) : null}

        {!showCreate ? (
          <button className="btn ghost" type="button" onClick={() => { setShowCreate(true); setErr(null); }}>
            Can&apos;t find your court? Add a new location
          </button>
        ) : null}
      </section>

      {showCreate ? (
        <section className="card stack" style={{ maxWidth: 720, marginBottom: 16 }}>
          <div className="spread">
            <h2>Add a new location</h2>
            <button className="btn ghost" type="button" onClick={() => { setShowCreate(false); setDupState(null); setResolved(null); }}>
              Cancel
            </button>
          </div>
          <form className="stack" onSubmit={confirmAddress}>
            <FormField label="Name" name="name" value={form.name} onChange={update} required />
            <FormField label="Street address" name="address_line1" value={form.address_line1} onChange={update} required />
            <FormField label="City" name="city" value={form.city} onChange={update} required />
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
