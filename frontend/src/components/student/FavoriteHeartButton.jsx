export const FAVORITE_ADD_LABEL = 'Add to favorites';
export const FAVORITE_REMOVE_LABEL = 'Remove from favorites';

/**
 * Save / unsave a coach. Callers stop this click from also opening the coach's profile.
 * The accessible name says what a click will do; the hover tip repeats it for mouse users.
 */
export function FavoriteHeartButton({ saved, busy, onClick, className = '' }) {
  const label = saved ? FAVORITE_REMOVE_LABEL : FAVORITE_ADD_LABEL;
  return (
    <button
      type="button"
      className={`favorite-heart${saved ? ' is-saved' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      <HeartIcon filled={saved} />
      <span className="favorite-heart-tip" aria-hidden="true">{label}</span>
    </button>
  );
}

function HeartIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 20.2s-6.6-4.1-6.6-8.7C5.4 8.4 7.2 6.6 9.5 6.6c1.3 0 2.3.6 2.5 1.6.2-1 1.2-1.6 2.5-1.6 2.3 0 4.1 1.8 4.1 4.9 0 4.6-6.6 8.7-6.6 8.7z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
