import { charCounterLabel, charMaxHint } from '../../utils/charLimits.js';

/** Static maximum hint (e.g. “500 character maximum”). */
export function CharacterMaxHint({ max, className = '' }) {
  return (
    <span className={`char-limit-meta${className ? ` ${className}` : ''}`}>
      {charMaxHint(max)}
    </span>
  );
}

/** Live character counter. Use `subtle` for low-emphasis fields like messages. */
export function CharacterCounter({ value, max, subtle = false, className = '' }) {
  return (
    <span
      className={`char-limit-meta char-counter${subtle ? ' subtle' : ''}${className ? ` ${className}` : ''}`}
      aria-live="polite"
    >
      {charCounterLabel(value, max)}
    </span>
  );
}
