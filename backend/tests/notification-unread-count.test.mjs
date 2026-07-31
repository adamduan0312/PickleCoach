/**
 * GET /api/notifications/unread-count — bell badge helper.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Notification } from '../models/index.js';
import { getUnreadNotificationCount } from '../controllers/notificationController.js';

const origCount = Notification.count;

afterEach(() => {
  Notification.count = origCount;
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

describe('getUnreadNotificationCount', () => {
  it('returns in-app unread count for the authenticated user', async () => {
    let capturedWhere;
    Notification.count = async ({ where }) => {
      capturedWhere = where;
      return 3;
    };

    const req = { user: { id: 20, roles: ['student'] } };
    const res = mockRes();
    await getUnreadNotificationCount(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, { count: 3 });
    assert.deepEqual(capturedWhere, {
      user_id: 20,
      channel: 'in_app',
      read_at: null,
    });
  });

  it('returns zero when the user has no unread in-app notifications', async () => {
    Notification.count = async () => 0;
    const req = { user: { id: 10, roles: ['coach'] } };
    const res = mockRes();
    await getUnreadNotificationCount(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { count: 0 });
  });
});
