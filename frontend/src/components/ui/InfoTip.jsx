import { useId, useState } from 'react';

/**
 * Small "i" button with a short explanation. Opens on hover, focus, or tap; closes on blur,
 * mouse leave, or Escape. Must not be placed inside a link or another button.
 */
export function InfoTip({ label, children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="info-tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="info-tip-btn"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      >
        i
      </button>
      {open ? <span role="tooltip" id={id} className="info-tip-bubble">{children}</span> : null}
    </span>
  );
}
