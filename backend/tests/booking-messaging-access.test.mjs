/**
 * Controller-level booking messaging access (mocked persistence).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Message, Conversation, Booking } from '../models/index.js';
import {
  getConversationById,
  sendMessage,
} from '../controllers/messageController.js';

const origConvFindByPk = Conversation.findByPk;
const origMsgFindAndCountAll = Message.findAndCountAll;
const origMsgCreate = Message.create;
const origConvUpdate = Conversation.update;

afterEach(() => {
  Conversation.findByPk = origConvFindByPk;
  Message.findAndCountAll = origMsgFindAndCountAll;
  Message.create = origMsgCreate;
  Conversation.update = origConvUpdate;
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

const baseBooking = {
  id: 5,
  coach_id: 10,
  primary_student_id: 20,
  status: 'confirmed',
  messaging_locked: false,
  toJSON() {
    return { ...this };
  },
};

describe('getConversationById access', () => {
  it('admin can view conversation', async () => {
    Conversation.findByPk = async () => ({
      id: 1,
      booking_id: 5,
      booking: baseBooking,
      toJSON() {
        return { id: 1, booking_id: 5 };
      },
    });
    Message.findAndCountAll = async () => ({ count: 1, rows: [{ id: 99, message_text: 'Hi' }] });

    const req = { params: { id: '1' }, validated: {}, user: { id: 1, roles: ['admin'] } };
    const res = mockRes();
    await getConversationById(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.messages.length, 1);
  });

  it('non-participant receives 403', async () => {
    Conversation.findByPk = async () => ({
      id: 1,
      booking_id: 5,
      booking: baseBooking,
      toJSON() {
        return { id: 1, booking_id: 5 };
      },
    });

    const req = { params: { id: '1' }, validated: {}, user: { id: 99, roles: ['student'] } };
    const res = mockRes();
    await getConversationById(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
  });

  it('messaging history readable after cancellation', async () => {
    Conversation.findByPk = async () => ({
      id: 1,
      booking_id: 5,
      booking: {
        ...baseBooking,
        status: 'cancelled',
        messaging_locked: true,
        toJSON() {
          return { ...this };
        },
      },
      toJSON() {
        return { id: 1, booking_id: 5 };
      },
    });
    Message.findAndCountAll = async () => ({
      count: 2,
      rows: [
        { id: 1, message_text: 'See you tomorrow' },
        { id: 2, message_text: 'Sounds good' },
      ],
    });

    const req = { params: { id: '1' }, validated: {}, user: { id: 20, roles: ['student'] } };
    const res = mockRes();
    await getConversationById(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.booking.messaging_locked, true);
    assert.equal(res.body.data.messaging_locked, undefined);
    assert.equal(res.body.data.booking.idempotency_key, undefined);
    assert.equal(res.body.data.booking.cancelled_by, undefined);
    assert.equal(res.body.data.messages.length, 2);
  });
});

describe('sendMessage enforcement', () => {
  it('participant can message confirmed booking', async () => {
    Conversation.findByPk = async () => ({
      id: 1,
      booking_id: 5,
      booking: baseBooking,
      update: async () => {},
    });
    Message.create = async (row) => ({ id: 7, ...row });
    Conversation.update = async () => {};

    const req = {
      body: { conversation_id: 1, message_text: 'Can we start 5 minutes early?' },
      user: { id: 20, roles: ['student'] },
    };
    const res = mockRes();
    await sendMessage(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.message_text, 'Can we start 5 minutes early?');
  });

  it('participant cannot message cancelled booking', async () => {
    Conversation.findByPk = async () => ({
      id: 1,
      booking_id: 5,
      booking: { ...baseBooking, status: 'cancelled', messaging_locked: true },
    });

    const req = {
      body: { conversation_id: 1, message_text: 'Hello?' },
      user: { id: 20, roles: ['student'] },
    };
    const res = mockRes();
    await sendMessage(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, 'Messaging is unavailable for this booking');
  });

  it('participant cannot message completed booking', async () => {
    Conversation.findByPk = async () => ({
      id: 1,
      booking_id: 5,
      booking: { ...baseBooking, status: 'completed', messaging_locked: true },
    });

    const req = {
      body: { conversation_id: 1, message_text: 'Thanks!' },
      user: { id: 10, roles: ['coach'] },
    };
    const res = mockRes();
    await sendMessage(req, res);
    assert.equal(res.statusCode, 409);
  });
});
