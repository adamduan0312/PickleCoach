import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  COMMON_GROUP,
  buildTimezoneOptions,
  filterTimezoneOptions,
  timezoneLabel,
} from '../../domain/timezones.js';

/**
 * Searchable time zone picker. Shows friendly names; emits IANA ids via onChange(value).
 */
export function TimezoneSelect({ id, value, onChange, disabled }) {
  const listId = useId();
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const options = useMemo(() => buildTimezoneOptions({ currentValue: value }), [value]);
  const filtered = useMemo(() => filterTimezoneOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selected = filtered.findIndex((o) => o.value === value);
    setActiveIndex(selected >= 0 && !query ? selected : 0);
    // Focus after the popover renders.
    requestAnimationFrame(() => searchRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function choose(option) {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    setQuery('');
  }

  function onSearchKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  let lastGroup = null;

  return (
    <div className="tz-select" ref={rootRef}>
      <button
        id={id}
        type="button"
        className="tz-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{timezoneLabel(value) || 'Select a time zone'}</span>
        <span className="tz-select-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="tz-select-popover">
          <input
            ref={searchRef}
            type="text"
            className="tz-select-search"
            placeholder="Search city or region"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            aria-label="Search time zones"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onSearchKeyDown}
          />
          <ul className="tz-select-list" role="listbox" id={listId} ref={listRef}>
            {filtered.length === 0 ? (
              <li className="tz-select-empty muted small">No matching time zones</li>
            ) : null}
            {filtered.map((option, index) => {
              const heading = option.group !== lastGroup ? option.group : null;
              const showAllOtherLabel = heading && lastGroup === COMMON_GROUP && !query;
              lastGroup = option.group;
              return (
                <li key={option.value} role="presentation">
                  {showAllOtherLabel ? (
                    <div className="tz-select-divider" role="presentation">All other time zones</div>
                  ) : null}
                  {heading ? (
                    <div className="tz-select-group" role="presentation">{heading}</div>
                  ) : null}
                  <div
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={option.value === value}
                    className={`tz-select-option${index === activeIndex ? ' active' : ''}${option.value === value ? ' selected' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    {option.label}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
