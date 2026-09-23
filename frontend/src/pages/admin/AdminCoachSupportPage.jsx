import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';

/**
 * Exception/recovery: admin unlink coach courts + delete availability slots.
 * Courts: GET/DELETE /admin/coaches/:id/courts
 * Availability: GET/DELETE /admin/coaches/:id/availability (admin — works for suspended/deleted coaches)
 */
export function AdminCoachSupportPage() {
  const { id: coachId } = useParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const { data, error, loading } = useAsync(async () => {
    const user = (await adminApi.user(coachId)).data;
    let courtRows = [];
    let courtError = null;
    let availabilityRows = [];
    let availabilityError = null;
    try {
      courtRows = asList((await adminApi.coachCourts(coachId)).data);
    } catch (err) {
      courtError = err;
    }
    try {
      availabilityRows = asList((await adminApi.coachAvailability(coachId)).data);
    } catch (err) {
      availabilityError = err;
    }
    return { user, courtRows, courtError, availabilityRows, availabilityError };
  }, [coachId, reloadTick]);

  async function unlinkCourt(courtId, label) {
    const ok = window.confirm(`Unlink court “${label || courtId}” from this coach?\n\nThis does not delete the global court record.`);
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await adminApi.deleteCoachCourt(coachId, courtId);
      setMessage('Court unlinked.');
      setReloadTick((n) => n + 1);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSlot(slotId) {
    const ok = window.confirm(`Delete availability slot #${slotId} for this coach?`);
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await adminApi.deleteCoachAvailability(coachId, slotId);
      setMessage('Availability slot deleted.');
      setReloadTick((n) => n + 1);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <ErrorState error={error} />
      </div>
    );
  }

  const user = data?.user;
  const name = user?.full_name || `Coach #${coachId}`;

  return (
    <div className="page">
      <AdminPageHeader
        title={`Coach support · ${name}`}
        subtitle="Exception recovery for courts and availability — not a replacement for coach self-serve tools."
        actions={<Link className="btn secondary" to={`/admin/users/${coachId}`}>Back to user</Link>}
      />

      {message ? <Alert tone="success">{message}</Alert> : null}
      {actionError ? <ErrorState error={actionError} /> : null}

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Linked courts</h2>
        {data?.courtError ? <ErrorState error={data.courtError} /> : null}
        {!data?.courtRows?.length && !data?.courtError ? <EmptyState title="No linked courts" /> : null}
        {data?.courtRows?.map((row) => {
          const court = row.court || row.courtLocation || row;
          const courtId = row.court_id || court.id;
          const label = court.name || court.facility_name || `Court #${courtId}`;
          return (
            <div key={courtId} className="spread" style={{ alignItems: 'flex-start' }}>
              <div>
                <strong>{label}</strong>
                <div className="small muted">
                  {[court.city, court.state, court.postal_code].filter(Boolean).join(', ') || '—'}
                </div>
              </div>
              <button type="button" className="btn danger" disabled={busy} onClick={() => unlinkCourt(courtId, label)}>
                Unlink
              </button>
            </div>
          );
        })}
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Availability</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Listed via GET /admin/coaches/:id/availability (works for active, suspended, and soft-deleted coaches).
        </p>
        {data?.availabilityError ? <ErrorState error={data.availabilityError} /> : null}
        {!data?.availabilityRows?.length && !data?.availabilityError ? (
          <EmptyState title="No availability rows" />
        ) : null}
        {data?.availabilityRows?.map((slot) => (
          <div key={slot.id} className="spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <strong>Slot #{slot.id}</strong>
              <div className="small muted">
                {slot.weekday != null ? `Weekday ${slot.weekday}` : '—'}
                {slot.start_time ? ` · ${slot.start_time}` : ''}
                {slot.end_time ? ` – ${slot.end_time}` : ''}
                {slot.start_date || slot.end_date
                  ? ` · ${slot.start_date || '…'} → ${slot.end_date || '…'}`
                  : ''}
              </div>
            </div>
            <button type="button" className="btn danger" disabled={busy} onClick={() => deleteSlot(slot.id)}>
              Delete
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
