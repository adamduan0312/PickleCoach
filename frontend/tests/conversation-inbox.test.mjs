import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  conversationInboxGroup,
  sortConversationsForInbox,
} from '../src/domain/conversationInbox.js';

describe('sortConversationsForInbox', () => {
  it('bands unread → active → empty', () => {
    assert.equal(conversationInboxGroup({ unread_count: 2, latest_message: { id: 1 } }), 0);
    assert.equal(conversationInboxGroup({
      unread_count: 0,
      latest_message: { id: 1, message_text: 'hi', created_at: '2026-09-01T10:00:00.000Z' },
    }), 1);
    assert.equal(conversationInboxGroup({ unread_count: 0, latest_message: null }), 2);
  });

  it('puts conversations with messages above empty ones; unread first', () => {
    const ids = sortConversationsForInbox([
      { id: 10, unread_count: 0, created_at: '2026-09-20T10:00:00.000Z', latest_message: null },
      { id: 11, unread_count: 0, created_at: '2026-09-21T10:00:00.000Z', latest_message: null },
      {
        id: 2,
        unread_count: 0,
        created_at: '2026-09-01T10:00:00.000Z',
        latest_message: {
          id: 20,
          message_text: 'super cool',
          created_at: '2026-09-10T12:00:00.000Z',
        },
      },
      {
        id: 1,
        unread_count: 1,
        created_at: '2026-09-01T10:00:00.000Z',
        latest_message: {
          id: 21,
          message_text: 'Coach reply — got it',
          created_at: '2026-09-09T12:00:00.000Z',
        },
      },
      {
        id: 3,
        unread_count: 0,
        created_at: '2026-09-02T10:00:00.000Z',
        latest_message: {
          id: 22,
          message_text: 'older active',
          created_at: '2026-09-08T12:00:00.000Z',
        },
      },
    ]).map((c) => c.id);

    assert.deepEqual(ids, [1, 2, 3, 11, 10]);
  });
});
