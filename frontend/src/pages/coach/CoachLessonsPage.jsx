import { useState } from 'react';
import { Link } from 'react-router-dom';
import { coachesApi, lessonsApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, Alert } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { formatMoney } from '../../utils/format.js';

export function CoachLessonsPage() {
  const { data, error, loading, setData } = useAsync(async () => {
    const res = await coachesApi.myLessons();
    return asList(res.data);
  }, []);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', duration_minutes: '60', price: '50', max_students: '1' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [err, setErr] = useState(null);

  function startEdit(lesson) {
    setEditing(lesson?.id || 'new');
    setForm(lesson ? {
      title: lesson.title || '',
      description: lesson.description || '',
      duration_minutes: String(lesson.duration_minutes || 60),
      price: String(lesson.price || ''),
      max_students: String(lesson.max_students || 1),
      is_active: lesson.is_active !== false,
    } : { title: '', description: '', duration_minutes: '60', price: '50', max_students: '1' });
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = {
      title: form.title,
      description: form.description,
      duration_minutes: Number(form.duration_minutes),
      price: Number(form.price),
      max_students: Number(form.max_students || 1),
    };
    try {
      if (editing === 'new') await lessonsApi.create(body);
      else await lessonsApi.update(editing, { ...body, is_active: form.is_active !== false });
      const res = await coachesApi.myLessons();
      setData(asList(res.data));
      setEditing(null);
      setMessage('Lesson saved.');
    } catch (ex) {
      setErr(ex.message);
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

  return (
    <div className="page">
      <div className="page-header">
        <h1>Lessons</h1>
        <button className="btn" type="button" onClick={() => startEdit(null)}>New lesson</button>
      </div>
      <Alert tone="success">{message}</Alert>
      <Alert tone="error">{err}</Alert>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && (!data || data.length === 0) && !editing ? (
        <EmptyState title="No lessons yet" detail="Create a lesson offering students can book." />
      ) : null}
      {editing ? (
        <form className="card stack" onSubmit={save} style={{ marginBottom: 16, maxWidth: 640 }}>
          <h2>{editing === 'new' ? 'Create lesson' : 'Edit lesson'}</h2>
          <FormField label="Title" name="title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          <FormField label="Description" name="description">
            <textarea id="description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </FormField>
          <FormField label="Duration (minutes)" name="duration_minutes" type="number" min="15" value={form.duration_minutes} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))} required />
          <FormField label="Price (USD)" name="price" type="number" min="1" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} required />
          <div className="row">
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="btn secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
      <div className="stack">
        {(data || []).map((l) => (
          <div key={l.id} className="card spread">
            <div>
              <strong>{l.title}</strong>
              <div className="small muted">{l.duration_minutes} min · {formatMoney(l.price)} {l.is_active === false ? '· inactive' : ''}</div>
            </div>
            <div className="row">
              <button className="btn secondary" type="button" onClick={() => startEdit(l)}>Edit</button>
              <button className="btn ghost" type="button" onClick={() => remove(l.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      <p className="small"><Link to="/coach">Back to dashboard</Link></p>
    </div>
  );
}
