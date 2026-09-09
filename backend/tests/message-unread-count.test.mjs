/**
 * GET /api/messages/unread-count — Messages nav attention route wiring.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('messages unread-count route contract', () => {
  it('mounts GET /unread-count before parameterized conversation routes', () => {
    const routesSrc = readFileSync(join(__dirname, '../routes/messageRoutes.js'), 'utf8');
    const controllerSrc = readFileSync(join(__dirname, '../controllers/messageController.js'), 'utf8');
    const unreadIdx = routesSrc.indexOf("'/unread-count'");
    const convIdx = routesSrc.indexOf("'/conversations/:id'");
    assert.ok(unreadIdx > -1, 'expected /unread-count route');
    assert.ok(convIdx > unreadIdx, '/unread-count must be registered before /conversations/:id');
    assert.match(routesSrc, /getUnreadMessageCount/);
    assert.match(controllerSrc, /countUnreadMessagesForUser/);
    assert.match(controllerSrc, /export const getUnreadMessageCount/);
  });
});
