import { initials } from '../../utils/format.js';

export function Avatar({ name, src, size }) {
  return (
    <div className={`avatar${size === 'lg' ? ' lg' : ''}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name)}
    </div>
  );
}
