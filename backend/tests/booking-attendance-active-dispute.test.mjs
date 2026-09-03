/**
 * Attendance actions must not compete with an open dispute.
 * Dispute resolve owns the outcome while disputes.status is open/under_review
 * (or bookings.status is Stripe `disputed`).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Booking, Dispute, sequelize } from '../models/index.js';
import { completeBooking, markBookingNoShow } from '../controllers/bookingController.js';

const origBookingFindByPk = Booking.findByPk;
const origDisputeFindOne = Dispute.findOne;
const origTx = sequelize.transaction;

afterEach(() => {
  Booking.findByPk = origBookingFindByPk;
  Dispute.findOne = origDisputeFindOne;
  sequelize.transaction = origTx;
});

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function bookingStub({ status = 'awaiting_verification', coachId = 7 } = {}) {
  const scheduledAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  return {
    id: 350,
    coach_id: coachId,
    primary_student_id: 100,
    status,
    attendance_finalized: false,
    scheduled_at: scheduledAt,
    duration_minutes: 60,
    toJSON() {
      return { ...this };
    },
  };
}

function installTxnMocks({ booking, openDispute = null }) {
  sequelize.transaction = async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } });
  Booking.findByPk = async () => booking;
  Dispute.findOne = async () => openDispute;
}

describe('attendance actions blocked while issue/dispute is open', () => {
  it('complete returns 409 when an in-app issue is open', async () => {
    installTxnMocks({
      booking: bookingStub({ status: 'awaiting_verification' }),
      openDispute: { id: 12, status: 'open' },
    });
    const req = { params: { id: '350' }, user: { id: 7, roles: ['coach'] }, validated: {} };
    const res = mockRes();
    await completeBooking(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload?.code, 'disputed_use_resolve_dispute');
    assert.match(res.payload?.message || '', /active dispute/i);
  });

  it('student-no-show returns 409 when an in-app issue is open', async () => {
    installTxnMocks({
      booking: bookingStub({ status: 'awaiting_verification' }),
      openDispute: { id: 12, status: 'open' },
    });
    const req = {
      params: { id: '350' },
      user: { id: 7, roles: ['coach'] },
      validated: {},
      baseUrl: '/api/bookings',
    };
    const res = mockRes();
    await markBookingNoShow(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload?.code, 'disputed_use_resolve_dispute');
  });

  it('complete returns 409 when bookings.status is Stripe disputed', async () => {
    installTxnMocks({
      booking: bookingStub({ status: 'disputed' }),
      openDispute: null,
    });
    const req = { params: { id: '350' }, user: { id: 7, roles: ['coach'] }, validated: {} };
    const res = mockRes();
    await completeBooking(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload?.code, 'disputed_use_resolve_dispute');
  });

  it('student-no-show returns 409 when bookings.status is Stripe disputed', async () => {
    installTxnMocks({
      booking: bookingStub({ status: 'disputed' }),
      openDispute: null,
    });
    const req = {
      params: { id: '350' },
      user: { id: 7, roles: ['coach'] },
      validated: {},
      baseUrl: '/api/bookings',
    };
    const res = mockRes();
    await markBookingNoShow(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload?.code, 'disputed_use_resolve_dispute');
  });

  it('complete rejects cancelled without needing dispute resolution path', async () => {
    installTxnMocks({
      booking: bookingStub({ status: 'cancelled' }),
      openDispute: null,
    });
    const req = { params: { id: '350' }, user: { id: 7, roles: ['coach'] }, validated: {} };
    const res = mockRes();
    await completeBooking(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload?.message || '', /confirmed or awaiting_verification/i);
  });

  it('student-no-show rejects cancelled', async () => {
    installTxnMocks({
      booking: bookingStub({ status: 'cancelled' }),
      openDispute: null,
    });
    const req = {
      params: { id: '350' },
      user: { id: 7, roles: ['coach'] },
      validated: {},
      baseUrl: '/api/bookings',
    };
    const res = mockRes();
    await markBookingNoShow(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload?.message || '', /confirmed or awaiting_verification/i);
  });
});
