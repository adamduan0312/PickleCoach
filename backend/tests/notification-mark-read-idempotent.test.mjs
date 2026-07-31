/**
 * PUT /api/notifications/:id/read must be idempotent.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Notification } from '../models/index.js';
import { markNotificationAsRead } from '../controllers/notificationController.js';

const origFindByPk = Notification.findByPk;

afterEach(() => {
  Notification.findByPk = origFindByPk;
});

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('markNotificationAsRead idempotency', () => {
  it('sets read_at on first call', async () => {
    const before = new Date('2026-07-23T14:00:00.000Z');
    let updatedPayload = null;
    Notification.findByPk = async () => ({
      id: 5,
      user_id: 20,
      channel: 'in_app',
      status: 'sent',
      read_at: null,
      async update(payload) {
        updatedPayload = payload;
        this.read_at = payload.read_at;
        this.status = payload.status;
      },
      toJSON() {
        return { id: 5, user_id: 20, read_at: this.read_at, status: this.status };
      },
    });

    const req = { params: { id: '5' }, user: { id: 20, roles: ['student'] } };
    const res = mockRes();
    await markNotificationAsRead(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(updatedPayload.status, 'sent');
    assert.ok(updatedPayload.read_at instanceof Date);
    assert.ok(updatedPayload.read_at.getTime() >= before.getTime() - 60_000);
  });

  it('second call still returns 200 and preserves existing read_at', async () => {
    const existingReadAt = new Date('2026-07-23T14:00:00.000Z');
    let updateCalls = 0;
    let lastPayload = null;
    Notification.findByPk = async () => ({
      id: 5,
      user_id: 20,
      channel: 'in_app',
      status: 'sent',
      read_at: existingReadAt,
      async update(payload) {
        updateCalls += 1;
        lastPayload = payload;
        this.read_at = payload.read_at;
        this.status = payload.status;
      },
      toJSON() {
        return { id: 5, user_id: 20, read_at: this.read_at, status: this.status };
      },
    });

    const req = { params: { id: '5' }, user: { id: 20, roles: ['student'] } };
    const res = mockRes();
    await markNotificationAsRead(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(updateCalls, 1);
    assert.equal(lastPayload.read_at, existingReadAt);
    assert.equal(lastPayload.read_at.toISOString(), '2026-07-23T14:00:00.000Z');
  });
});
