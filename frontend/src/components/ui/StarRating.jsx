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
