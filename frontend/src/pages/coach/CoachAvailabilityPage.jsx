import { useState } from 'react';
import { coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { WEEKDAYS } from '../../utils/datetime.js';
import { useAuth } from '../../auth/AuthContext.jsx';

export function CoachAvailabilityPage() {
  const { user } = useAuth();
  const { data, error, loading, setData } = useAsync(async () => {
    const res = await coachesApi.myAvailability();
    return asList(res.data);
  }, []);
  const [form, setForm] = useState({ weekday: '1', start_time: '09:00', end_time: '12:00', start_date: '', end_date: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [message, setMessage] = useState(null);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = {
      weekday: Number(form.weekday),
      start_time: form.start_time,
      end_time: form.end_time,
    };
    if (form.start_date) body.start_date = form.start_date;
    if (form.end_date) body.end_date = form.end_date;
    try {
      await coachesApi.createAvailability(body);
      const res = await coachesApi.myAvailability();
      setData(asList(res.data));
      setMessage('Availability added.');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    try {
      await coachesApi.deleteAvailability(id);
      setData((rows) => (rows || []).filter((r) => r.id !== id));
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div className="page">
      <h1>Availability</h1>
      <p className="muted">Recurring weekly windows in your coach timezone ({user?.timezone || 'UTC'}). Students pick a slot; the API stores the time in UTC.</p>
      <Alert tone="error">{err}</Alert>
      <Alert tone="success">{message}</Alert>
      <form className="card grid-3" onSubmit={create} style={{ marginBottom: 16 }}>
        <FormField label="Weekday" name="weekday">
          <select id="weekday" value={form.weekday} onChange={(e) => setForm((f) => ({ ...f, weekday: e.target.value }))}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </FormField>
        <FormField label="Start time" name="start_time" type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} required />
        <FormField label="End time" name="end_time" type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} required />
        <FormField label="Start date (optional)" name="start_date" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
        <FormField label="End date (optional)" name="end_date" type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
        <div style={{ alignSelf: 'end' }}>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add window'}</button>
        </div>
      </form>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && (!data || data.length === 0) ? (
        <EmptyState
          title="No availability yet"
          detail="Add weekly windows so students can pick a time when they book."
        />
      ) : null}
      <div className="stack">
        {(data || []).map((row) => (
          <div key={row.id} className="card spread">
            <div>
              <strong>{WEEKDAYS[row.weekday] || row.weekday}</strong>
              <div className="small muted">{row.start_time} – {row.end_time} {row.start_date || row.end_date ? `· ${row.start_date || '…'} to ${row.end_date || '…'}` : ''}</div>
            </div>
            <button className="btn ghost" type="button" onClick={() => remove(row.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
