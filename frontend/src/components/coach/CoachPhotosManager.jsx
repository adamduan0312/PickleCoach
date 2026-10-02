import { useEffect, useRef, useState } from 'react';
import { coachesApi, resolveMediaUrl, API_BASE_URL } from '../../api/index.js';
import { Alert } from '../ui/States.jsx';
import {
  COACH_PHOTO_ACCEPT,
  COACH_PHOTO_LIMITS_HINT,
  COACH_PHOTO_MAX,
  COACH_PHOTO_TARGET,
  GALLERY_TITLE,
  moveItem,
  planCoachPhotoUpload,
} from '../../domain/coachPhotos.js';

/**
 * Coach "On the court" gallery management. Every change saves immediately (independent of the
 * profile form's Save button). The first photo is the cover.
 */
export function CoachPhotosManager() {
  const inputRef = useRef(null);
  const sectionRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState([]);
  const [message, setMessage] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  useEffect(() => {
    let alive = true;
    coachesApi.myPhotos()
      .then((res) => { if (alive) setPhotos(res.data?.photos || []); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (loaded && window.location.hash === '#coaching-photos') {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loaded]);

  async function run(action, successMessage, { optimistic } = {}) {
    const previous = photos;
    if (optimistic) setPhotos(optimistic);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await action();
      setPhotos(res.data?.photos || []);
      setMessage(successMessage);
    } catch (err) {
      if (optimistic) setPhotos(previous);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const { accepted, problems } = planCoachPhotoUpload(files, photos.length);
    setNotes(problems);
    if (!accepted.length) return;
    run(() => coachesApi.uploadPhotos(accepted), accepted.length === 1 ? 'Photo added.' : `${accepted.length} photos added.`);
  }

  function reorder(from, to) {
    if (from === to) return;
    const next = moveItem(photos, from, to);
    setNotes([]);
    run(() => coachesApi.reorderPhotos(next.map((p) => p.id)), to === 0 ? 'Cover photo updated.' : 'Photo order saved.', { optimistic: next });
  }

  function setCover(photo) {
    setNotes([]);
    const index = photos.findIndex((p) => p.id === photo.id);
    run(() => coachesApi.setCoverPhoto(photo.id), 'Cover photo updated.', { optimistic: moveItem(photos, index, 0) });
  }

  function remove(photo) {
    if (!window.confirm('Delete this photo? It will be removed from your public profile.')) return;
    setNotes([]);
    run(() => coachesApi.deletePhoto(photo.id), 'Photo deleted.', { optimistic: photos.filter((p) => p.id !== photo.id) });
  }

  function onDrop(index) {
    if (dragIndex != null) reorder(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  }

  const full = photos.length >= COACH_PHOTO_MAX;

  return (
    <section ref={sectionRef} className="card stack coach-photos-manager" id="coaching-photos" aria-labelledby="coaching-photos-title">
      <div className="coach-photos-manager-head">
        <div>
          <h2 id="coaching-photos-title">Coaching photos</h2>
          <p className="small muted">
            Shown as “{GALLERY_TITLE}” on your public profile. Aim for about {COACH_PHOTO_TARGET}: coaching a student,
            demonstrating a shot, a group session, on-court action, and a portrait. Optional — you can be listed without photos.
          </p>
        </div>
        <span className="small muted coach-photos-count">{photos.length} of {COACH_PHOTO_MAX}</span>
      </div>

      {loaded && photos.length > 0 ? (
        <>
          <ol className="coach-photos-grid">
            {photos.map((p, i) => (
              <li
                key={p.id}
                className={`coach-photo-tile${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== i ? ' drop-target' : ''}`}
                draggable={!busy}
                onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); setOverIndex(i); }}
                onDragLeave={() => setOverIndex((o) => (o === i ? null : o))}
                onDrop={(e) => { e.preventDefault(); onDrop(i); }}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              >
                <div className="coach-photo-thumb">
                  <img src={resolveMediaUrl(p.url, API_BASE_URL)} alt={`Coaching photo ${i + 1}`} loading="lazy" />
                  {i === 0 ? <span className="badge success coach-photo-cover-badge">Cover</span> : null}
                </div>
                <div className="coach-photo-actions">
                  {i === 0 ? (
                    <span className="small muted">Featured first</span>
                  ) : (
                    <button type="button" className="btn ghost coach-photo-btn" disabled={busy} onClick={() => setCover(p)} aria-label={`Set photo ${i + 1} as cover`}>
                      Set as cover
                    </button>
                  )}
                  <div className="coach-photo-move">
                    <button
                      type="button"
                      className="btn ghost coach-photo-btn"
                      disabled={busy || i === 0}
                      onClick={() => reorder(i, i - 1)}
                      aria-label={`Move photo ${i + 1} earlier`}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="btn ghost coach-photo-btn"
                      disabled={busy || i === photos.length - 1}
                      onClick={() => reorder(i, i + 1)}
                      aria-label={`Move photo ${i + 1} later`}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      className="btn ghost coach-photo-btn delete"
                      disabled={busy}
                      onClick={() => remove(p)}
                      aria-label={`Delete photo ${i + 1}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {photos.length > 1 ? <p className="small muted coach-photos-tip">Drag photos to reorder. The first photo is your cover.</p> : null}
        </>
      ) : loaded ? (
        <p className="muted small coach-photos-empty">No photos yet. Students will see your gallery once you add some.</p>
      ) : null}

      <div className="row coach-photos-add">
        <input
          ref={inputRef}
          type="file"
          accept={COACH_PHOTO_ACCEPT}
          multiple
          hidden
          onChange={onFilesSelected}
          aria-label="Add coaching photos"
        />
        <button type="button" className="btn secondary" disabled={busy || full || !loaded} onClick={() => inputRef.current?.click()}>
          {busy ? 'Saving…' : '+ Add photos'}
        </button>
        <span className="muted small">{full ? `You've reached ${COACH_PHOTO_MAX} photos. Delete one to add another.` : COACH_PHOTO_LIMITS_HINT}</span>
      </div>

      <div aria-live="polite" className="stack">
        <Alert tone="error">{error}</Alert>
        {notes.length ? <Alert tone="warning">{notes.join(' ')}</Alert> : null}
        <Alert tone="success">{message}</Alert>
      </div>
    </section>
  );
}
