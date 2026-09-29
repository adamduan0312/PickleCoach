/**
 * Resolve avatar / media URLs for <img src>.
 * Absolute http(s)/data/blob URLs pass through; app-relative paths use the API host.
 *
 * @param {string|null|undefined} src
 * @param {string} [apiBaseUrl] — e.g. http://localhost:4000/api
 */
export function resolveMediaUrl(src, apiBaseUrl = 'http://localhost:4000/api') {
  if (src == null || src === '') return null;
  const value = String(src).trim();
  if (!value) return null;
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  const origin = String(apiBaseUrl || '').replace(/\/$/, '').replace(/\/api$/i, '');
  return `${origin}${value.startsWith('/') ? value : `/${value}`}`;
}
