import { useEffect, useId, useRef, useState } from 'react';
import { geoApi } from '../../api/index.js';

const DEBOUNCE_MS = 300;

/** Mirrors the server: no lookup for 1 character or a partial ZIP. */
export function shouldSuggestPlaces(text) {
  const q = String(text || '').trim();
  if (q.length < 2) return false;
  return !/^\d+$/.test(q) || /^\d{5}$/.test(q);
}

/**
 * City-level place autocomplete ("Dav" → Davie, FL). Emits the chosen label via onChange(value).
 * Free text still flows through onChange; the server re-validates on save either way.
 */
export function PlaceAutocomplete({ id, value, onChange, placeholder, maxLength, invalid }) {
  const listId = useId();
  const rootRef = useRef(null);
  /** True while the user is typing; suggestions only show for typed input, not the saved value. */
  const [typing, setTyping] = useState(false);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [activeIndex, setActiveIndex] = useState(0);
  const chosenRef = useRef(value);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!typing) return undefined;
    function onDocMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setTyping(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [typing]);

  useEffect(() => {
    if (!typing || value === chosenRef.current || !shouldSuggestPlaces(value)) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }
    const requestId = ++requestRef.current;
    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const res = await geoApi.places({ q: value.trim() });
        if (requestId !== requestRef.current) return;
        setResults(res.data?.results || []);
        setActiveIndex(0);
        setStatus('done');
      } catch {
        if (requestId !== requestRef.current) return;
        setResults([]);
        setStatus('error');
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, typing]);

  const open = typing && status !== 'idle';

  function choose(option) {
    if (!option) return;
    chosenRef.current = option.label;
    requestRef.current += 1;
    onChange(option.label);
    setTyping(false);
  }

  function onKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      choose(results[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setTyping(false);
    }
  }

  return (
    <div className="tz-select place-autocomplete" ref={rootRef}>
      <input
        id={id}
        name={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid ? 'true' : undefined}
        aria-activedescendant={open && results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => {
          setTyping(true);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTyping(false)}
      />
      {open ? (
        <div className="tz-select-popover">
          <ul className="tz-select-list" role="listbox" id={listId} aria-label="Suggested places">
            {status === 'loading' && results.length === 0 ? (
              <li className="tz-select-empty muted small">Searching…</li>
            ) : null}
            {status === 'done' && results.length === 0 ? (
              <li className="tz-select-empty muted small">No matching places. Try a city and state or a 5-digit ZIP code.</li>
            ) : null}
            {status === 'error' ? (
              <li className="tz-select-empty muted small">Suggestions are unavailable right now. You can still type your city and state.</li>
            ) : null}
            {results.map((option, index) => (
              <li
                key={option.label}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`tz-select-option${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
              >
                <strong>{option.label}</strong>
                <span className="place-autocomplete-detail muted small">{option.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
