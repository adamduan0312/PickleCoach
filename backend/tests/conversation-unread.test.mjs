/**
 * Conversation unread helpers (mocked persistence / SQL).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConversationRead, Message, sequelize } from '../models/index.js';
import {
  getUnreadCountsByConversationIds,
  markConversationAsRead,
  resolveConversationReadCursor,
} from '../utils/conversationUnread.js';

const origQuery = sequelize.query;
const origFindOrCreate = ConversationRead.findOrCreate;
const origMsgFindOne = Message.findOne;

afterEach(() => {
  sequelize.query = origQuery;
  ConversationRead.findOrCreate = origFindOrCreate;
  Message.findOne = origMsgFindOne;
});

describe('getUnreadCountsByConversationIds', () => {
  it('returns zeros when conversation list is empty', async () => {
    sequelize.query = async () => {
      throw new Error('should not query');
    };
    const map = await getUnreadCountsByConversationIds(20, []);
    assert.equal(map.size, 0);
  });

  it('maps SQL unread counts onto conversation ids', async () => {
    sequelize.query = async () => [
      { conversation_id: 1, unread_count: 2 },
      { conversation_id: 3, unread_count: '5' },
    ];
    const map = await getUnreadCountsByConversationIds(20, [1, 2, 3]);
    assert.equal(map.get(1), 2);
    assert.equal(map.get(2), 0);
    assert.equal(map.get(3), 5);
  });
});

describe('resolveConversationReadCursor', () => {
  it('uses newest message created_at when messages exist', async () => {
    const latest = new Date('2026-07-23T12:00:00.000Z');
    Message.findOne = async () => ({ created_at: latest });
    const cursor = await resolveConversationReadCursor(7);
    assert.equal(cursor.toISOString(), latest.toISOString());
  });

  it('falls back to now when the thread is empty', async () => {
    Message.findOne = async () => null;
    const before = Date.now();
    const cursor = await resolveConversationReadCursor(7);
    const after = Date.now();
    assert.ok(cursor.getTime() >= before);
    assert.ok(cursor.getTime() <= after);
  });
});

describe('markConversationAsRead', () => {
  it('defaults cursor to newest message created_at', async () => {
    const latest = new Date('2026-07-23T14:00:00.000Z');
    Message.findOne = async () => ({ created_at: latest });
    let captured;
    ConversationRead.findOrCreate = async (args) => {
      captured = args;
      return [{ id: 9, last_read_at: args.defaults.last_read_at }, true];
    };
    const row = await markConversationAsRead(20, 7);
    assert.equal(row.id, 9);
    assert.equal(captured.where.conversation_id, 7);
    assert.equal(captured.where.user_id, 20);
    assert.equal(captured.defaults.last_read_at.toISOString(), latest.toISOString());
  });

  it('updates last_read_at when existing cursor is older', async () => {
    let updatedAt = null;
    ConversationRead.findOrCreate = async () => [
      {
        id: 9,
        last_read_at: new Date('2026-07-23T10:00:00.000Z'),
        async update(payload) {
          updatedAt = payload.last_read_at;
        },
      },
      false,
    ];
    const at = new Date('2026-07-23T15:00:00.000Z');
    await markConversationAsRead(20, 7, at);
    assert.equal(updatedAt.toISOString(), at.toISOString());
  });

  it('does not move the cursor backwards', async () => {
    let updateCalled = false;
    ConversationRead.findOrCreate = async () => [
      {
        id: 9,
        last_read_at: new Date('2026-07-23T16:00:00.000Z'),
        async update() {
          updateCalled = true;
        },
      },
      false,
    ];
    await markConversationAsRead(20, 7, new Date('2026-07-23T15:00:00.000Z'));
    assert.equal(updateCalled, false);
  });
});
