/**
 * GET /api/messages/conversations inbox shape and access (mocked persistence).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Conversation, Booking, sequelize } from '../models/index.js';
import { getConversations } from '../controllers/messageController.js';
import {
  serializeBookingForMessaging,
  serializeConversationInboxItem,
  serializeLatestMessage,
} from '../utils/conversationInboxDto.js';

const origBookingFindAll = Booking.findAll;
const origConvFindAndCountAll = Conversation.findAndCountAll;
const origSequelizeQuery = sequelize.query;

afterEach(() => {
  Booking.findAll = origBookingFindAll;
  Conversation.findAndCountAll = origConvFindAndCountAll;
  sequelize.query = origSequelizeQuery;
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

const fullBooking = {
  id: 5,
  lesson_id: 12,
  coach_id: 10,
  primary_student_id: 20,
  scheduled_at: '2026-06-01T10:00:00.000Z',
  duration_minutes: 60,
  price: '50.00',
  status: 'confirmed',
  court_location_id: 3,
  messaging_locked: false,
  cancelled_by: 'student',
  cancelled_at: '2026-05-30T12:00:00.000Z',
  deleted_at: null,
  decline_message_to_student: 'Sorry',
  decline_reason_code: 'schedule_conflict',
  idempotency_key: 'idem-abc',
  payout_status: 'none',
  attendance_finalized: false,
  created_at: '2026-05-28T08:00:00.000Z',
  updated_at: '2026-05-28T08:00:00.000Z',
  toJSON() {
    return { ...this };
  },
};

describe('conversationInboxDto serialization', () => {
  it('serializeLatestMessage returns object for newest message', () => {
    const latest = serializeLatestMessage([
      {
        id: 99,
        conversation_id: 1,
        sender_id: 20,
        message_text: 'See you at court',
        created_at: '2026-06-01T09:00:00.000Z',
        updated_at: '2026-06-01T09:00:00.000Z',
        sender: { id: 20, full_name: 'Student', avatar_url: null },
      },
    ]);
    assert.equal(latest.id, 99);
    assert.equal(latest.message_text, 'See you at court');
    assert.equal(latest.sender.full_name, 'Student');
  });

  it('serializeLatestMessage returns null when no messages', () => {
    assert.equal(serializeLatestMessage([]), null);
    assert.equal(serializeLatestMessage(undefined), null);
  });

  it('serializeBookingForMessaging keeps only messaging UI booking fields', () => {
    const dto = serializeBookingForMessaging(fullBooking);
    assert.deepEqual(Object.keys(dto).sort(), [
      'id',
      'lesson_id',
      'messaging_locked',
      'scheduled_at',
      'status',
    ]);
    assert.equal(dto.id, 5);
    assert.equal(dto.lesson_id, 12);
    assert.equal(dto.status, 'confirmed');
    assert.equal(dto.messaging_locked, false);
    assert.equal(dto.coach_id, undefined);
    assert.equal(dto.duration_minutes, undefined);
    assert.equal(dto.price, undefined);
    assert.equal(dto.court_location_id, undefined);
    assert.equal(dto.cancelled_by, undefined);
    assert.equal(dto.idempotency_key, undefined);
  });

  it('serializeConversationInboxItem uses latest_message not messages array', () => {
    const row = {
      id: 1,
      booking_id: 5,
      created_at: '2026-05-29T10:00:00.000Z',
      updated_at: '2026-06-01T09:00:00.000Z',
      booking: fullBooking,
      messages: [
        {
          id: 7,
          conversation_id: 1,
          sender_id: 10,
          message_text: 'Ready?',
          created_at: '2026-06-01T08:00:00.000Z',
          updated_at: '2026-06-01T08:00:00.000Z',
          sender: { id: 10, full_name: 'Coach', avatar_url: '/a.png' },
        },
      ],
      toJSON() {
        return { ...this };
      },
    };
    const item = serializeConversationInboxItem(row, { unreadCount: 2 });
    assert.equal(item.messages, undefined);
    assert.equal(item.latest_message.id, 7);
    assert.equal(item.booking.lesson_id, 12);
    assert.equal(item.booking.coach_id, undefined);
    assert.equal(item.booking.messaging_locked, false);
    assert.equal(item.unread_count, 2);
  });

  it('serializeConversationInboxItem defaults unread_count to 0', () => {
    const row = {
      id: 2,
      booking_id: 6,
      created_at: '2026-05-29T10:00:00.000Z',
      updated_at: '2026-05-29T10:00:00.000Z',
      booking: fullBooking,
      messages: [],
      toJSON() {
        return { ...this };
      },
    };
    const item = serializeConversationInboxItem(row);
    assert.equal(item.unread_count, 0);
  });

  it('serializeConversationInboxItem sets latest_message null when thread empty', () => {
    const row = {
      id: 2,
      booking_id: 6,
      created_at: '2026-05-29T10:00:00.000Z',
      updated_at: '2026-05-29T10:00:00.000Z',
      booking: fullBooking,
      messages: [],
      toJSON() {
        return { ...this };
      },
    };
    const item = serializeConversationInboxItem(row);
    assert.equal(item.latest_message, null);
  });
});

describe('getConversations inbox list', () => {
  it('returns latest_message preview and trimmed booking for participant', async () => {
    Booking.findAll = async () => [{ id: 5 }];
    Conversation.findAndCountAll = async () => ({
      count: 1,
      rows: [
        {
          id: 1,
          booking_id: 5,
          created_at: '2026-06-02T12:00:00.000Z',
          updated_at: '2026-06-02T13:00:00.000Z',
          booking: fullBooking,
          messages: [
            {
              id: 42,
              conversation_id: 1,
              sender_id: 20,
              message_text: 'Thanks!',
              created_at: '2026-06-02T13:00:00.000Z',
              updated_at: '2026-06-02T13:00:00.000Z',
              sender: { id: 20, full_name: 'Student', avatar_url: null },
            },
          ],
          toJSON() {
            return {
              id: this.id,
              booking_id: this.booking_id,
              created_at: this.created_at,
              updated_at: this.updated_at,
              booking: this.booking,
              messages: this.messages,
            };
          },
        },
      ],
    });
    sequelize.query = async () => [{ conversation_id: 1, unread_count: 3 }];

    const req = { validated: {}, user: { id: 10, roles: ['coach'] } };
    const res = mockRes();
    await getConversations(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.length, 1);
    const row = res.body.data[0];
    assert.equal(row.latest_message.message_text, 'Thanks!');
    assert.equal(row.messages, undefined);
    assert.equal(row.booking.lesson_id, 12);
    assert.equal(row.booking.cancelled_by, undefined);
    assert.equal(row.unread_count, 3);
  });

  it('returns empty array when booking_id filter is not participant booking', async () => {
    Booking.findAll = async () => [{ id: 5 }];
    Conversation.findAndCountAll = async () => {
      throw new Error('should not query conversations');
    };

    const req = { validated: { booking_id: 999 }, user: { id: 10, roles: ['coach'] } };
    const res = mockRes();
    await getConversations(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, []);
  });

  it('preserves conversation sort order from query', async () => {
    Booking.findAll = async () => [{ id: 5 }, { id: 6 }];
    Conversation.findAndCountAll = async () => ({
      count: 2,
      rows: [
        {
          id: 2,
          booking_id: 6,
          created_at: '2026-06-03T12:00:00.000Z',
          updated_at: '2026-06-03T12:00:00.000Z',
          booking: { ...fullBooking, id: 6 },
          messages: [],
          toJSON() {
            return {
              id: this.id,
              booking_id: this.booking_id,
              created_at: this.created_at,
              updated_at: this.updated_at,
              booking: this.booking,
              messages: this.messages,
            };
          },
        },
        {
          id: 1,
          booking_id: 5,
          created_at: '2026-06-02T12:00:00.000Z',
          updated_at: '2026-06-02T12:00:00.000Z',
          booking: fullBooking,
          messages: [],
          toJSON() {
            return {
              id: this.id,
              booking_id: this.booking_id,
              created_at: this.created_at,
              updated_at: this.updated_at,
              booking: this.booking,
              messages: this.messages,
            };
          },
        },
      ],
    });
    sequelize.query = async () => [];

    const req = { validated: {}, user: { id: 10, roles: ['coach'] } };
    const res = mockRes();
    await getConversations(req, res);

    assert.deepEqual(
      res.body.data.map((r) => r.id),
      [2, 1],
    );
    assert.deepEqual(
      res.body.data.map((r) => r.unread_count),
      [0, 0],
    );
  });

  it('admin skips participant booking filter', async () => {
    let bookingFindAllCalled = false;
    Booking.findAll = async () => {
      bookingFindAllCalled = true;
      return [];
    };
    Conversation.findAndCountAll = async () => ({ count: 0, rows: [] });
    sequelize.query = async () => {
      throw new Error('should not query unread for empty inbox');
    };

    const req = { validated: {}, user: { id: 1, roles: ['admin'] } };
    const res = mockRes();
    await getConversations(req, res);

    assert.equal(bookingFindAllCalled, false);
    assert.equal(res.statusCode, 200);
  });
});
