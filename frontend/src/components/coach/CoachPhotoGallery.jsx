import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveMediaUrl, API_BASE_URL } from '../../api/index.js';
import { GALLERY_TITLE, galleryIntro, galleryLayout, wrapIndex } from '../../domain/coachPhotos.js';

const SWIPE_PX = 40;
const src = (photo) => resolveMediaUrl(photo?.url, API_BASE_URL);

/** Full-screen photo viewer: arrows / swipe to move, Esc or the close button to exit. */
function PhotoLightbox({ photos, index, coachName, onIndex, onClose }) {
  const closeRef = useRef(null);
  const touchX = useRef(null);
  const count = photos.length;
  const go = useCallback((delta) => onIndex(wrapIndex(index + delta, count)), [index, count, onIndex]);

  useEffect(() => {
    const opener = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  return (
    <div
      className="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Photos of ${coachName}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > SWIPE_PX) go(dx < 0 ? 1 : -1);
      }}
    >
      <button ref={closeRef} type="button" className="photo-lightbox-close" onClick={onClose} aria-label="Close photos">
        ×
      </button>
      {count > 1 ? (
        <button type="button" className="photo-lightbox-nav prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
      ) : null}
      <img className="photo-lightbox-img" src={src(photos[index])} alt={`${coachName} — photo ${index + 1} of ${count}`} />
      {count > 1 ? (
        <button type="button" className="photo-lightbox-nav next" onClick={() => go(1)} aria-label="Next photo">›</button>
      ) : null}
      <p className="photo-lightbox-count" aria-live="polite">{index + 1} / {count}</p>
    </div>
  );
}

/**
 * Public "On the court" gallery: featured cover + side tiles on desktop, swipeable carousel with
 * dots on mobile. Any photo opens the lightbox.
 */
export function CoachPhotoGallery({ photos, coachName }) {
  const [open, setOpen] = useState(null);
  const [slide, setSlide] = useState(0);
  const trackRef = useRef(null);
  const list = Array.isArray(photos) ? photos : [];
  if (!list.length) return null;

  const { featured, side, moreCount } = galleryLayout(list);
  const alt = (i) => `${coachName} — photo ${i + 1} of ${list.length}`;

  function onTrackScroll() {
    const el = trackRef.current;
    if (el?.clientWidth) setSlide(Math.round(el.scrollLeft / el.clientWidth));
  }

  function scrollToSlide(i) {
    const el = trackRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }

  return (
    <section className="card coach-profile-section coach-gallery-section" aria-labelledby="coach-gallery-title">
      <h2 id="coach-gallery-title">{GALLERY_TITLE}</h2>
      <p className="muted small coach-section-intro">{galleryIntro(coachName)}</p>

      <div className={`coach-gallery-grid count-${Math.min(list.length, 3)}`}>
        <button type="button" className="coach-gallery-tile featured" onClick={() => setOpen(0)} aria-label={`Open ${alt(0)}`}>
          <img src={src(featured)} alt="" />
        </button>
        {side.map((p, i) => {
          const index = i + 1;
          const showMore = moreCount > 0 && index === side.length;
          return (
            <button
              key={p.id}
              type="button"
              className="coach-gallery-tile"
              onClick={() => setOpen(index)}
              aria-label={showMore ? `Open ${alt(index)} (${moreCount} more)` : `Open ${alt(index)}`}
            >
              <img src={src(p)} alt="" loading="lazy" />
              {showMore ? <span className="coach-gallery-more" aria-hidden="true">+{moreCount}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="coach-gallery-carousel">
        <div className="coach-gallery-track" ref={trackRef} onScroll={onTrackScroll}>
          {list.map((p, i) => (
            <button key={p.id} type="button" className="coach-gallery-slide" onClick={() => setOpen(i)} aria-label={`Open ${alt(i)}`}>
              <img src={src(p)} alt="" loading={i === 0 ? undefined : 'lazy'} />
            </button>
          ))}
        </div>
        {list.length > 1 ? (
          <div className="coach-gallery-dots">
            {list.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`coach-gallery-dot${i === slide ? ' active' : ''}`}
                onClick={() => scrollToSlide(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === slide ? 'true' : undefined}
              />
            ))}
          </div>
        ) : null}
      </div>

      {open != null ? (
        <PhotoLightbox photos={list} index={open} coachName={coachName} onIndex={setOpen} onClose={() => setOpen(null)} />
      ) : null}
    </section>
  );
}
