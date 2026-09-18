import { useState } from 'react';
import { visualStarRatingParts } from '../../utils/format.js';

/**
 * Marketplace star rating display — gold filled/half stars, muted empty stars.
 * @param {{ rating?: number | null, variant?: 'visual' | 'compact', className?: string, label?: string }} props
 */
export function StarRating({ rating, variant = 'visual', className = '', label }) {
  if (variant === 'compact') {
    return (
      <span
        className={`star-rating star-rating-compact ${className}`.trim()}
        aria-hidden={label ? undefined : true}
        aria-label={label}
      >
        <span className="star-rating-gold">★</span>
      </span>
    );
  }

  const parts = visualStarRatingParts(rating);
  if (!parts) return null;

  const ariaLabel = label || `Rated ${Number(rating)} out of ${parts.maxStars}`;

  return (
    <span
      className={`star-rating star-rating-visual ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      {Array.from({ length: parts.full }, (_, i) => (
        <span key={`full-${i}`} className="star-rating-gold" aria-hidden="true">★</span>
      ))}
      {parts.hasHalf ? (
        <span className="star-rating-gold" aria-hidden="true">½</span>
      ) : null}
      {Array.from({ length: parts.empty }, (_, i) => (
        <span key={`empty-${i}`} className="star-rating-empty" aria-hidden="true">☆</span>
      ))}
    </span>
  );
}

/**
 * Clickable 1–5 star picker for leaving a review.
 * @param {{ value: number, onChange: (n: number) => void, max?: number, id?: string, disabled?: boolean, className?: string }} props
 */
export function StarRatingInput({ value, onChange, max = 5, id, disabled = false, className = '' }) {
  const [hover, setHover] = useState(null);
  const selected = Number(value) || 0;
  const display = hover ?? selected;

  return (
    <div
      id={id}
      className={`star-rating-input ${className}`.trim()}
      role="radiogroup"
      aria-label="Rating"
      aria-required="true"
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1;
        const filled = n <= display;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className={`star-rating-input-star ${filled ? 'star-rating-gold' : 'star-rating-empty'}`}
            disabled={disabled}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(null)}
            onClick={() => onChange(n)}
          >
            {filled ? '★' : '☆'}
          </button>
        );
      })}
    </div>
  );
}
