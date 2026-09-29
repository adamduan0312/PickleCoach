import { initials } from '../../utils/format.js';
import { API_BASE_URL } from '../../api/client.js';
import { resolveMediaUrl } from '../../utils/mediaUrl.js';

export function Avatar({ name, src, size }) {
  const resolved = resolveMediaUrl(src, API_BASE_URL);
  return (
    <div className={`avatar${size === 'lg' ? ' lg' : ''}`} aria-hidden="true">
      {resolved ? <img src={resolved} alt="" /> : initials(name)}
    </div>
  );
}
