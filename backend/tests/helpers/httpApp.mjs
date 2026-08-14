/**
 * HTTP helpers for integration tests against createApp() on an ephemeral port.
 */
import http from 'node:http';
import { createApp } from '../../app.js';

/**
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void>, app: import('express').Express }>}
 */
export async function startTestServer() {
  const app = createApp({ env: 'test' });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    app,
    baseUrl,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * @param {string} baseUrl
 * @param {string} method
 * @param {string} path
 * @param {{ token?: string, body?: object, rawBody?: string|Buffer, headers?: Record<string, string> }} [opts]
 */
export async function api(baseUrl, method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let body;
  if (opts.rawBody != null) {
    body = opts.rawBody;
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  } else if (opts.body != null) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

/**
 * POST /api/webhooks/stripe with a synthetic Stripe Event (test double verifies signature loosely).
 * @param {string} baseUrl
 * @param {object} event Stripe-shaped event `{ id, type, data }`
 */
export async function postStripeWebhook(baseUrl, event) {
  return api(baseUrl, 'POST', '/api/webhooks/stripe', {
    rawBody: JSON.stringify(event),
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 't=1,v1=test_integration_signature',
    },
  });
}
