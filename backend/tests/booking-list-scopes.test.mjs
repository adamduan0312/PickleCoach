/**
 * Booking list scopes: coach inbox / student dashboard (+ authorize middleware).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Booking, Conversation } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import {
  getCoachBookings,
  getStudentBookings,
} from '../controllers/bookingController.js';
import {
  buildAdminBookingsWhere,
  buildCoachInboxBookingsWhere,
  buildStudentBookingsWhere,
} from '../utils/bookingListQuery.js';

const origFindAndCountAll = Booking.findAndCountAll;
const origConvFindAll = Conversation.findAll;

afterEach(() => {
  Booking.findAndCountAll = origFindAndCountAll;
  Conversation.findAll = origConvFindAll;
});

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function runAuthorize(allowedRoles, userRoles) {
  const req = { user: { roles: userRoles } };
  const res = mockRes();
  let nextCalled = false;
  authorize(...allowedRoles)(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, statusCode: res.statusCode, body: res.payload };
}

function bookingRow({ id, coach_id, primary_student_id }) {
  return {
    id,
    lesson_id: 1,
    coach_id,
    primary_student_id,
    scheduled_at: '2026-07-01T10:00:00.000Z',
    duration_minutes: 60,
    price: '50.00',
    status: 'confirmed',
    court_location_id: 1,
    messaging_locked: false,
    lesson: { id: 1, title: 'Lesson' },
    coach: { id: coach_id, full_name: 'Coach', avatar_url: null },
    primaryStudent: {
      id: primary_student_id,
      full_name: 'Student',
      avatar_url: null,
      reliabilities: [{ role: 'student', reliability_score: 88 }],
    },
    courtLocation: null,
    toJSON() {
      return { ...this };
    },
  };
}

function stubListQuery(rows) {
  let capturedWhere = null;
  Booking.findAndCountAll = async (opts) => {
    capturedWhere = opts.where;
    return { rows, count: rows.length };
  };
  Conversation.findAll = async () => [];
  return () => capturedWhere;
}

describe('bookingListQuery where builders', () => {
  it('coach inbox scopes to coach_id only', () => {
    const where = buildCoachInboxBookingsWhere({ userId: 7, status: 'confirmed' });
    assert.equal(where.coach_id, 7);
    assert.equal(where.status, 'confirmed');
    assert.equal(where.primary_student_id, undefined);
  });

  it('student dashboard scopes to primary_student_id only', () => {
    const where = buildStudentBookingsWhere({ userId: 7, status: 'confirmed' });
    assert.equal(where.primary_student_id, 7);
    assert.equal(where.coach_id, undefined);
    assert.equal(where.status, 'confirmed');
  });

  it('admin list applies optional coach/student filters without self scope', () => {
    const where = buildAdminBookingsWhere({
      status: 'pending',
      coach_id: 3,
      student_id: 9,
    });
    assert.deepEqual(where, {
      status: 'pending',
      coach_id: 3,
      primary_student_id: 9,
    });
  });
});

describe('GET /api/coaches/me/bookings authorize (coach)', () => {
  it('allows coach', () => {
    const r = runAuthorize(['coach'], ['coach']);
    assert.equal(r.nextCalled, true);
  });

  it('allows dual-role student+coach', () => {
    const r = runAuthorize(['coach'], ['student', 'coach']);
    assert.equal(r.nextCalled, true);
  });

  it('denies student-only with 403', () => {
    const r = runAuthorize(['coach'], ['student']);
    assert.equal(r.nextCalled, false);
    assert.equal(r.statusCode, 403);
    assert.equal(r.body?.error, 'Insufficient permissions');
  });
});

describe('GET /api/students/me/bookings authorize (student)', () => {
  it('allows student', () => {
    const r = runAuthorize(['student'], ['student']);
    assert.equal(r.nextCalled, true);
  });

  it('allows dual-role coach+student', () => {
    const r = runAuthorize(['student'], ['coach', 'student']);
    assert.equal(r.nextCalled, true);
  });

  it('denies coach-only with 403', () => {
    const r = runAuthorize(['student'], ['coach']);
    assert.equal(r.nextCalled, false);
    assert.equal(r.statusCode, 403);
    assert.equal(r.body?.error, 'Insufficient permissions');
  });
});

describe('booking list controllers', () => {
  it('coach GET inbox only uses coach_id and always includes student reliability', async () => {
    const getWhere = stubListQuery([bookingRow({ id: 1, coach_id: 5, primary_student_id: 20 })]);
    const req = {
      validated: {},
      user: { id: 5, roles: ['coach'] },
      baseUrl: '/api/coaches',
    };
    const res = mockRes();
    await getCoachBookings(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(getWhere().coach_id, 5);
    assert.equal(getWhere().primary_student_id, undefined);
    assert.equal(res.payload.data[0].primaryStudent?.reliability_score, 88);
  });

  it('student GET dashboard only uses primary_student_id and omits student reliability', async () => {
    const getWhere = stubListQuery([bookingRow({ id: 1, coach_id: 99, primary_student_id: 10 })]);
    const req = {
      validated: {},
      user: { id: 10, roles: ['student'] },
      baseUrl: '/api/students',
    };
    const res = mockRes();
    await getStudentBookings(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(getWhere().primary_student_id, 10);
    assert.equal(getWhere().coach_id, undefined);
    assert.equal(res.payload.data[0].primaryStudent?.reliability_score, undefined);
  });
});
