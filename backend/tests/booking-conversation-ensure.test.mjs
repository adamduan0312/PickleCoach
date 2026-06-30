/**
 * Auto-create booking conversation on confirmation.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Conversation } from '../models/index.js';
import { ensureBookingConversation } from '../utils/bookingConversationSummary.js';

const origFindOne = Conversation.findOne;
const origCreate = Conversation.create;

afterEach(() => {
  Conversation.findOne = origFindOne;
  Conversation.create = origCreate;
});

describe('ensureBookingConversation', () => {
  it('returns existing conversation without creating', async () => {
    const existing = { id: 15, booking_id: 5 };
    Conversation.findOne = async () => existing;
    Conversation.create = async () => {
      throw new Error('should not create');
    };

    const result = await ensureBookingConversation(5);
    assert.equal(result, existing);
  });

  it('creates conversation when missing', async () => {
    Conversation.findOne = async () => null;
    Conversation.create = async (row) => ({ id: 20, ...row });

    const result = await ensureBookingConversation(7);
    assert.equal(result.id, 20);
    assert.equal(result.booking_id, 7);
  });

  it('handles unique constraint race by re-fetching', async () => {
    let calls = 0;
    Conversation.findOne = async () => {
      calls += 1;
      return calls === 1 ? null : { id: 99, booking_id: 8 };
    };
    Conversation.create = async () => {
      const err = new Error('duplicate');
      err.name = 'SequelizeUniqueConstraintError';
      throw err;
    };

    const result = await ensureBookingConversation(8);
    assert.equal(result.id, 99);
    assert.equal(calls, 2);
  });
});
