import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { coachesApi, lessonsApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { EmptyState, ErrorState, LoadingState, Alert } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { CharacterCounter } from '../../components/ui/CharacterLimit.jsx';
import { formatMoney } from '../../utils/format.js';
import { CHAR_LIMITS } from '../../utils/charLimits.js';
import {
  GROUP_LESSON_NOTE,
  GROUP_MAX_PLAYERS_MAX,
  GROUP_MAX_PLAYERS_MIN,
  LESSON_PRICE_MAX_USD,
  LESSON_PRICE_MIN_USD,
  durationOptionsFor,
  emptyLessonForm,
  lessonApiFieldErrors,
  lessonFormToPayload,
  lessonToForm,
  lessonTypeLabel,
  sanitizePriceInput,
  validateLessonForm,
} from '../../domain/lessonOffering.js';

const NEW_BLOCKED_HINT = 'Save or cancel the current lesson before creating a new one.';
const EDIT_BLOCKED_HINT = 'Save or cancel the current lesson before editing another lesson.';
const BLOCKED_NOTICE = 'Please save or cancel the current lesson form before continuing.';
const TITLE_TIP = (
  <><strong>Tip:</strong> Use a clear, specific name that tells students what the lesson focuses on.</>
);
const DESCRIPTION_TIP = (
  <><strong>Tip:</strong> Explain what students will learn, who the lesson is for, and what they can expect.</>
);

export function CoachLessonsPage() {
  const { data, error, loading, setData } = useAsync(async () => {
    const res = await coachesApi.myLessons();
    return asList(res.data);
  }, []);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyLessonForm);
  const [initialForm, setInitialForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [err, setErr] = useState(null);
  const [blockedNotice, setBlockedNotice] = useState(false);
  const formRef = useRef(null);

  function setField(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
    setFieldErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }

  function startEdit(lesson) {
    const next = lesson ? lessonToForm(lesson) : emptyLessonForm();
    setEditing(lesson?.id || 'new');
    setForm(next);
    setInitialForm(next);
    setFieldErrors({});
    setErr(null);
    setMessage(null);
    setBlockedNotice(false);
  }

  function cancelEdit() {
    setEditing(null);
    setInitialForm(null);
    setFieldErrors({});
    setErr(null);
    setBlockedNotice(false);
  }

  function showBlockedNotice() {
    setBlockedNotice(true);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const isDirty = Boolean(editing) && JSON.stringify(form) !== JSON.stringify(initialForm);

  useUnsavedChangesGuard(isDirty);

  // Clicking "Lessons" in the header while already here only changes location.key;
  // unsaved changes were already confirmed by the blocker above.
  const location = useLocation();
  const lastLocationKey = useRef(location.key);
  useEffect(() => {
    if (lastLocationKey.current === location.key) return;
    lastLocationKey.current = location.key;
    cancelEdit();
  }, [location.key]);

  async function save(e) {
    e.preventDefault();
    setErr(null);
    const clientErrors = validateLessonForm(form);
    if (Object.keys(clientErrors).length) {
      setFieldErrors(clientErrors);
      return;
    }
    setBusy(true);
    const body = lessonFormToPayload(form);
    try {
      if (editing === 'new') await lessonsApi.create(body);
      else await lessonsApi.update(editing, { ...body, is_active: form.is_active !== false });
      const res = await coachesApi.myLessons();
      setData(asList(res.data));
      setEditing(null);
      setInitialForm(null);
      setFieldErrors({});
      setBlockedNotice(false);
      setMessage('Lesson saved.');
    } catch (ex) {
      const { fields, general } = lessonApiFieldErrors(ex);
      setFieldErrors(fields);
      setErr(general || (Object.keys(fields).length ? null : ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this lesson?')) return;
    try {
      await lessonsApi.remove(id);
      setData((list) => (list || []).filter((l) => l.id !== id));
    } catch (ex) {
      setErr(ex.message);
    }
  }

  const isGroup = form.lesson_type === 'group';
  const isNew = editing === 'new';

  const lessonForm = editing ? (
    <form
      ref={formRef}
      className="card stack"
      onSubmit={save}
      noValidate
      style={{ maxWidth: 640, ...(isNew ? { marginBottom: 16 } : null) }}
    >
      <h2>{isNew ? 'Create lesson' : 'Edit lesson'}</h2>
      {blockedNotice ? (
        <div role="alert">
          <Alert tone="warning">{BLOCKED_NOTICE}</Alert>
        </div>
      ) : null}
      <FormField label="Title" name="title" required error={fieldErrors.title} hint={TITLE_TIP}>
        <>
          <input
            id="title"
            name="title"
            placeholder="e.g. Beginner Pickleball Lesson"
            value={form.title}
            maxLength={CHAR_LIMITS.lessonTitle}
            onChange={(e) => setField('title', e.target.value)}
          />
          <CharacterCounter value={form.title} max={CHAR_LIMITS.lessonTitle} subtle />
        </>
      </FormField>

      <fieldset className="field lesson-type-field">
        <legend>Lesson type *</legend>
        <div className="lesson-type-options" role="radiogroup">
          <label className={`lesson-type-option${!isGroup ? ' selected' : ''}`}>
            <input
              type="radio"
              name="lesson_type"
              value="private"
              checked={!isGroup}
              onChange={() => setField('lesson_type', 'private')}
            />
            <span>
              <strong>Private</strong>
              <span className="small muted">One-on-one lesson with you.</span>
            </span>
          </label>
          <label className={`lesson-type-option${isGroup ? ' selected' : ''}`}>
            <input
              type="radio"
              name="lesson_type"
              value="group"
              checked={isGroup}
              onChange={() => setField('lesson_type', 'group')}
            />
            <span>
              <strong>Group</strong>
              <span className="small muted">{GROUP_LESSON_NOTE}</span>
            </span>
          </label>
        </div>
        {fieldErrors.lesson_type ? <span className="error">{fieldErrors.lesson_type}</span> : null}
      </fieldset>

      {isGroup ? (
        <FormField
          label="Maximum players"
          name="max_players"
          required
          error={fieldErrors.max_players}
          hint={`Total people allowed at the lesson, including the student who books (${GROUP_MAX_PLAYERS_MIN}–${GROUP_MAX_PLAYERS_MAX}). Only one student books and pays.`}
        >
          <input
            id="max_players"
            name="max_players"
            type="number"
            inputMode="numeric"
            min={GROUP_MAX_PLAYERS_MIN}
            max={GROUP_MAX_PLAYERS_MAX}
            step="1"
            value={form.max_players}
            onChange={(e) => setField('max_players', e.target.value.replace(/\D/g, ''))}
            style={{ maxWidth: 140 }}
          />
        </FormField>
      ) : null}

      <FormField label="Description" name="description" error={fieldErrors.description} hint={DESCRIPTION_TIP}>
        <>
          <textarea
            id="description"
            placeholder="e.g. Learn the basics of serving, returning, positioning, and scoring."
            value={form.description}
            maxLength={CHAR_LIMITS.lessonDescription}
            onChange={(e) => setField('description', e.target.value)}
          />
          <CharacterCounter value={form.description} max={CHAR_LIMITS.lessonDescription} subtle />
        </>
      </FormField>

      <FormField label="Duration" name="duration_minutes" required error={fieldErrors.duration_minutes}>
        <select
          id="duration_minutes"
          value={form.duration_minutes}
          onChange={(e) => setField('duration_minutes', e.target.value)}
          style={{ maxWidth: 200 }}
        >
          {durationOptionsFor(form.duration_minutes).map((m) => (
            <option key={m} value={String(m)}>{m} minutes</option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Price (USD)"
        name="price"
        required
        error={fieldErrors.price}
        hint={`$${LESSON_PRICE_MIN_USD.toFixed(2)}–$${LESSON_PRICE_MAX_USD.toLocaleString('en-US')}`}
      >
        <input
          id="price"
          name="price"
          type="text"
          inputMode="decimal"
          value={form.price}
          onChange={(e) => setField('price', sanitizePriceInput(e.target.value))}
          style={{ maxWidth: 200 }}
        />
      </FormField>

      <div className="row">
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn secondary" type="button" onClick={cancelEdit}>Cancel</button>
      </div>
    </form>
  ) : null;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Lessons</h1>
        <button
          className="btn"
          type="button"
          aria-disabled={editing ? 'true' : undefined}
          title={editing ? NEW_BLOCKED_HINT : undefined}
          onClick={() => (editing ? showBlockedNotice() : startEdit(null))}
        >
          New lesson
        </button>
      </div>
      <Alert tone="success">{message}</Alert>
      <Alert tone="error">{err}</Alert>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && (!data || data.length === 0) && !editing ? (
        <EmptyState title="No lessons yet" detail="Create a lesson offering students can book." />
      ) : null}
      {isNew ? lessonForm : null}
      <div className="stack">
        {(data || []).map((l) => (editing === l.id ? (
          <div key={l.id}>{lessonForm}</div>
        ) : (
          <div key={l.id} className="card spread">
            <div>
              <strong>{l.title}</strong>
              <div className="small muted">
                {lessonTypeLabel(l)} · {l.duration_minutes} min · {formatMoney(l.price)}
                {l.is_active === false ? ' · inactive' : ''}
              </div>
            </div>
            <div className="row">
              <button
                className="btn secondary"
                type="button"
                aria-disabled={editing ? 'true' : undefined}
                title={editing ? EDIT_BLOCKED_HINT : undefined}
                onClick={() => (editing ? showBlockedNotice() : startEdit(l))}
              >
                Edit
              </button>
              <button className="btn ghost" type="button" onClick={() => remove(l.id)}>Delete</button>
            </div>
          </div>
        )))}
      </div>
      <p className="small"><Link to="/coach">Back to dashboard</Link></p>
    </div>
  );
}
