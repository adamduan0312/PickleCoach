import { useRef, useState } from 'react';
import { coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { WEEKDAYS } from '../../utils/datetime.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { timezoneLabel } from '../../domain/timezones.js';
import {
  availabilityApiErrors,
  availabilityRowLabel,
  availabilityVisibilityNote,
  latestAvailabilityDate,
  todayInZone,
  weekdayLabel,
} from '../../domain/availability.js';

const EMPTY_FORM = { weekday: '1', start_time: '09:00', end_time: '12:00', start_date: '', end_date: '' };
const EDIT_BLOCKED_HINT = 'Save or cancel the window you’re editing before editing another one.';
const BLOCKED_NOTICE = 'Please save or cancel this window before editing another one.';

function rowToForm(row) {
  return {
    weekday: String(row.weekday),
    start_time: String(row.start_time || '').slice(0, 5),
    end_time: String(row.end_time || '').slice(0, 5),
    start_date: row.start_date || '',
    end_date: row.end_date || '',
  };
}

function formToBody(form) {
  return {
    weekday: Number(form.weekday),
    start_time: form.start_time,
    end_time: form.end_time,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
  };
}

function formNote(form, today) {
  return availabilityVisibilityNote(
    { weekday: Number(form.weekday), start_date: form.start_date || null, end_date: form.end_date || null },
    today,
  );
}

function TimeFields({ idPrefix, form, errors, onChange }) {
  return (
    <>
      <FormField
        label="Start time"
        name={`${idPrefix}start_time`}
        type="time"
        value={form.start_time}
        onChange={(e) => onChange('start_time', e.target.value)}
        error={errors.start_time}
        required
      />
      <FormField
        label="End time"
        name={`${idPrefix}end_time`}
        type="time"
        value={form.end_time}
        onChange={(e) => onChange('end_time', e.target.value)}
        hint="Must be later the same day. For late sessions past midnight, add a window on the next day."
        error={errors.end_time}
        required
      />
    </>
  );
}

function DateFields({ idPrefix, form, errors, onChange, today, latestDate }) {
  return (
    <>
      <FormField
        label="Start date (optional)"
        name={`${idPrefix}start_date`}
        type="date"
        value={form.start_date}
        onChange={(e) => onChange('start_date', e.target.value)}
        max={latestDate}
        error={errors.start_date}
      />
      <FormField
        label="End date (optional)"
        name={`${idPrefix}end_date`}
        type="date"
        value={form.end_date}
        onChange={(e) => onChange('end_date', e.target.value)}
        min={form.start_date && form.start_date > today ? form.start_date : today}
        max={latestDate}
        hint="Leave blank to repeat every week."
        error={errors.end_date}
      />
    </>
  );
}

export function CoachAvailabilityPage() {
  const { user } = useAuth();
  const coachTimezone = user?.timezone || 'UTC';
  const today = todayInZone(coachTimezone);
  const latestDate = latestAvailabilityDate(today);
  const { data, error, loading, setData } = useAsync(async () => {
    const res = await coachesApi.myAvailability();
    return asList(res.data);
  }, []);
  const [message, setMessage] = useState(null);
  const [listErr, setListErr] = useState(null);

  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addErrors, setAddErrors] = useState({});
  const [addErr, setAddErr] = useState(null);
  const [addBusy, setAddBusy] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editInitial, setEditInitial] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [editErr, setEditErr] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState(false);
  const editRef = useRef(null);

  const isEditDirty = Boolean(editingId) && JSON.stringify(editForm) !== JSON.stringify(editInitial);
  useUnsavedChangesGuard(isEditDirty);

  function setAddField(name, value) {
    setAddForm((f) => ({ ...f, [name]: value }));
    setAddErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }

  function setEditField(name, value) {
    setEditForm((f) => ({ ...f, [name]: value }));
    setEditErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }

  async function reload() {
    const res = await coachesApi.myAvailability();
    setData(asList(res.data));
  }

  function startEdit(row) {
    const next = rowToForm(row);
    setEditingId(row.id);
    setEditForm(next);
    setEditInitial(next);
    setEditErrors({});
    setEditErr(null);
    setBlockedNotice(false);
    setMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditInitial(null);
    setEditErrors({});
    setEditErr(null);
    setBlockedNotice(false);
  }

  function showBlockedNotice() {
    setBlockedNotice(true);
    editRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submitAdd(e) {
    e.preventDefault();
    setAddBusy(true);
    setAddErr(null);
    setAddErrors({});
    setMessage(null);
    const body = formToBody(addForm);
    try {
      await coachesApi.createAvailability(body);
      await reload();
      const note = availabilityVisibilityNote(body, today);
      setMessage(`Availability added.${note ? ` ${note}` : ''}`);
      setAddForm(EMPTY_FORM);
    } catch (ex) {
      const { fields, general } = availabilityApiErrors(ex);
      setAddErrors(fields);
      setAddErr(general);
    } finally {
      setAddBusy(false);
    }
  }

  async function submitEdit(e) {
    e.preventDefault();
    setEditBusy(true);
    setEditErr(null);
    setEditErrors({});
    setMessage(null);
    const body = formToBody(editForm);
    try {
      await coachesApi.updateAvailability(editingId, body);
      await reload();
      const note = availabilityVisibilityNote(body, today);
      setMessage(`Availability updated.${note ? ` ${note}` : ''}`);
      cancelEdit();
    } catch (ex) {
      const { fields, general } = availabilityApiErrors(ex);
      setEditErrors(fields);
      setEditErr(general);
    } finally {
      setEditBusy(false);
    }
  }

  async function remove(id) {
    setMessage(null);
    setListErr(null);
    try {
      await coachesApi.deleteAvailability(id);
      setData((rows) => (rows || []).filter((r) => r.id !== id));
    } catch (ex) {
      setListErr(ex.message);
    }
  }

  const addNote = formNote(addForm, today);
  const editNote = editingId ? formNote(editForm, today) : null;

  return (
    <div className="page">
      <h1>Availability</h1>
      <p className="muted">
        Recurring weekly windows in your time zone ({timezoneLabel(coachTimezone)}). Students
        see these times converted to their own time zone and can book up to 60 days ahead.
      </p>
      <Alert tone="success">{message}</Alert>
      <form className="card stack" onSubmit={submitAdd} noValidate style={{ marginBottom: 16 }}>
        <strong>Add availability</strong>
        <Alert tone="error">{addErr}</Alert>
        <div className="grid-3">
          <FormField label="Weekday" name="weekday" error={addErrors.weekday}>
            <select id="weekday" value={addForm.weekday} onChange={(e) => setAddField('weekday', e.target.value)}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{weekdayLabel(i)}</option>)}
            </select>
          </FormField>
          <TimeFields idPrefix="" form={addForm} errors={addErrors} onChange={setAddField} />
          <DateFields
            idPrefix=""
            form={addForm}
            errors={addErrors}
            onChange={setAddField}
            today={today}
            latestDate={latestDate}
          />
        </div>
        {addNote ? <p className="small muted availability-note">{addNote}</p> : null}
        <div className="row">
          <button className="btn" type="submit" disabled={addBusy}>{addBusy ? 'Saving…' : 'Add window'}</button>
        </div>
      </form>
      <Alert tone="error">{listErr}</Alert>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && (!data || data.length === 0) ? (
        <EmptyState
          title="No availability yet"
          detail="Add weekly windows so students can pick a time when they book."
        />
      ) : null}
      <div className="stack">
        {(data || []).map((row) => {
          if (editingId === row.id) {
            return (
              <form
                key={row.id}
                ref={editRef}
                className="card stack availability-editing"
                onSubmit={submitEdit}
                noValidate
                aria-label={`Edit ${weekdayLabel(row.weekday)} window`}
              >
                <strong>{weekdayLabel(row.weekday)}</strong>
                {blockedNotice ? (
                  <div role="alert"><Alert tone="warning">{BLOCKED_NOTICE}</Alert></div>
                ) : null}
                <Alert tone="error">{editErr}</Alert>
                <div className="grid-2">
                  <TimeFields idPrefix="edit-" form={editForm} errors={editErrors} onChange={setEditField} />
                </div>
                <div className="grid-2">
                  <DateFields
                    idPrefix="edit-"
                    form={editForm}
                    errors={editErrors}
                    onChange={setEditField}
                    today={today}
                    latestDate={latestDate}
                  />
                </div>
                {editNote ? <p className="small availability-note">{editNote}</p> : null}
                <div className="row">
                  <button className="btn" type="submit" disabled={editBusy}>{editBusy ? 'Saving…' : 'Save'}</button>
                  <button className="btn secondary" type="button" onClick={cancelEdit}>Cancel</button>
                </div>
              </form>
            );
          }
          const note = availabilityVisibilityNote(row, today);
          return (
            <div key={row.id} className="card spread">
              <div>
                <strong>{weekdayLabel(row.weekday)}</strong>
                <div className="small muted">{availabilityRowLabel(row)}</div>
                {note ? <div className="small availability-note">{note}</div> : null}
              </div>
              <div className="row">
                <button
                  className="btn secondary"
                  type="button"
                  aria-disabled={editingId ? 'true' : undefined}
                  title={editingId ? EDIT_BLOCKED_HINT : undefined}
                  onClick={() => (editingId ? showBlockedNotice() : startEdit(row))}
                >
                  Edit
                </button>
                <button className="btn ghost" type="button" onClick={() => remove(row.id)}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
