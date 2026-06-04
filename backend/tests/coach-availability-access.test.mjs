/**
 * RBAC for coach availability browsing: `GET /api/coaches/:id/availability` uses
 * `authenticate` + `authorize('student', 'admin')` — coach-only sessions are denied (403).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authorize } from '../middleware/auth.js';

function runAuthorize(roles) {
  const req = { user: { roles } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
    },
  };
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  authorize('student', 'admin')(req, res, next);
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

describe('GET /api/coaches/:id/availability policy (authorize student or admin)', () => {
  it('allows student', () => {
    const r = runAuthorize(['student']);
    assert.equal(r.nextCalled, true);
    assert.equal(r.statusCode, 200);
  });

  it('allows admin', () => {
    const r = runAuthorize(['admin']);
    assert.equal(r.nextCalled, true);
  });

  it('allows student+coach (student flow / dual role)', () => {
    const r = runAuthorize(['student', 'coach']);
    assert.equal(r.nextCalled, true);
  });

  it('denies coach-only with 403', () => {
    const r = runAuthorize(['coach']);
    assert.equal(r.nextCalled, false);
    assert.equal(r.statusCode, 403);
    assert.equal(r.body?.error, 'Insufficient permissions');
  });
});
