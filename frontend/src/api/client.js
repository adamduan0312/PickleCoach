const TOKEN_KEY = 'pc.token';

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'
).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, details = null, code = null, payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.code = code;
    this.payload = payload;
  }
}

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearStoredToken() {
  setStoredToken(null);
}

let unauthorizedHandler = null;

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

function extractMessage(body, fallback) {
  if (!body || typeof body !== 'object') return fallback;
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  return fallback;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/**
 * Low-level fetch against the PickleCoach API.
 * Returns `{ data, message, pagination }` on success.
 */
export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    token = getStoredToken(),
    headers: extraHeaders,
    skipAuth = false,
    signal,
  } = options;

  const headers = {
    Accept: 'application/json',
    ...(extraHeaders || {}),
  };

  let payload = body;
  if (body != null && !(body instanceof FormData) && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (!skipAuth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal });
  } catch (err) {
    throw new ApiError(err?.message || 'Network error. Is the backend running on port 4000?', {
      status: 0,
    });
  }

  const parsed = await parseBody(res);

  if (!res.ok) {
    const details = parsed?.details || parsed?.errors || null;
    const error = new ApiError(extractMessage(parsed, res.statusText || 'Request failed'), {
      status: res.status,
      details,
      code: parsed?.code || (typeof parsed?.error === 'string' ? parsed.error : null),
      payload: parsed,
    });
    if (res.status === 401 && unauthorizedHandler && !options.ignoreUnauthorized) {
      unauthorizedHandler(error);
    }
    throw error;
  }

  return {
    data: parsed?.data,
    message: parsed?.message || 'OK',
    pagination: parsed?.pagination || null,
    raw: parsed,
  };
}

export function qs(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function asList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}
