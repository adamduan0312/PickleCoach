import { useLayoutEffect, useRef, useState } from 'react';

function EyeIcon({ off }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9.3 3.1 11 7.5a11.8 11.8 0 0 1-4.2 5.1" />
          <path d="M6.1 6.1A11.8 11.8 0 0 0 1 12.5C2.7 16.9 7 20 12 20c1.7 0 3.3-.4 4.7-1.1" />
        </>
      ) : (
        <>
          <path d="M1 12.5C2.7 8.1 7 5 12 5s9.3 3.1 11 7.5C21.3 16.9 17 20 12 20S2.7 16.9 1 12.5z" />
          <circle cx="12" cy="12.5" r="3" />
        </>
      )}
    </svg>
  );
}

export function PasswordField({
  label,
  name,
  value,
  onChange,
  error,
  hint,
  required,
  autoComplete,
}) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef(null);
  const selectionRef = useRef(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const sel = selectionRef.current;
    if (!input || !sel) return;
    input.focus();
    try {
      input.setSelectionRange(sel.start, sel.end);
    } catch {
      /* ignore */
    }
    selectionRef.current = null;
  }, [visible]);

  function toggle() {
    const el = inputRef.current;
    selectionRef.current = {
      start: el?.selectionStart ?? el?.value?.length ?? 0,
      end: el?.selectionEnd ?? el?.value?.length ?? 0,
    };
    setVisible((v) => !v);
  }

  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      {label ? <label htmlFor={name}>{label}{required ? ' *' : ''}</label> : null}
      <div className="password-input">
        <input
          ref={inputRef}
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          required={required}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={toggle}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          <EyeIcon off={visible} />
        </button>
      </div>
      {hint && !error ? <span className="muted small">{hint}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}
