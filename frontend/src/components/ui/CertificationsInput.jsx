import { useEffect, useRef } from 'react';
import { CharacterCounter } from './CharacterLimit.jsx';

/** Show the per-row counter only once a name gets long, to keep short rows uncluttered. */
const COUNTER_THRESHOLD = 0.8;

/**
 * One text row per certification. `value` is always a non-empty array of strings
 * (a single '' row when the coach has none).
 */
export function CertificationsInput({ id, value, onChange, maxLength, maxCount, errors = {} }) {
  const inputRefs = useRef([]);
  const focusIndexRef = useRef(null);

  useEffect(() => {
    if (focusIndexRef.current == null) return;
    inputRefs.current[focusIndexRef.current]?.focus();
    focusIndexRef.current = null;
  });

  const filledCount = value.filter((v) => v.trim() !== '').length;
  const canAdd = value.length < maxCount;

  function setRow(i, text) {
    onChange(value.map((v, j) => (j === i ? text : v)));
  }

  function removeRow(i) {
    const next = value.filter((_, j) => j !== i);
    focusIndexRef.current = Math.min(i, Math.max(next.length - 1, 0));
    onChange(next.length ? next : ['']);
  }

  function addRow() {
    const blank = value.findIndex((v) => v.trim() === '');
    if (blank !== -1) {
      inputRefs.current[blank]?.focus();
      return;
    }
    if (!canAdd) return;
    focusIndexRef.current = value.length;
    onChange([...value, '']);
  }

  function onKeyDown(e, i) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (i < value.length - 1) inputRefs.current[i + 1]?.focus();
    else if (value[i].trim() !== '') addRow();
  }

  return (
    <div className="cert-rows">
      {value.map((name, i) => {
        const rowError = errors[`certifications.${i}`];
        const showRemove = name.trim() !== '' || value.length > 1;
        return (
          <div key={i} className="cert-row">
            <div className="cert-row-main">
              <input
                id={i === 0 ? id : `${id}-${i}`}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                value={name}
                onChange={(e) => setRow(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(e, i)}
                maxLength={maxLength}
                placeholder="Certification name"
                aria-label={`Certification ${i + 1}`}
                aria-invalid={rowError ? 'true' : undefined}
                autoComplete="off"
              />
              {showRemove ? (
                <button
                  type="button"
                  className="cert-row-remove"
                  onClick={() => removeRow(i)}
                  aria-label={name.trim() ? `Remove ${name.trim()}` : `Remove certification ${i + 1}`}
                  title="Remove"
                >
                  ×
                </button>
              ) : null}
            </div>
            {rowError ? <span className="error">{rowError}</span> : null}
            {!rowError && name.length >= maxLength * COUNTER_THRESHOLD ? (
              <CharacterCounter value={name} max={maxLength} className="tight-top" />
            ) : null}
          </div>
        );
      })}
      {canAdd || filledCount < value.length ? (
        <button type="button" className="cert-add" onClick={addRow}>
          + Add certification
        </button>
      ) : (
        <span className="muted small">You can list up to {maxCount} certifications.</span>
      )}
    </div>
  );
}
