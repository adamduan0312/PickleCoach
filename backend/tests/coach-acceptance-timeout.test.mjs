import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  assertCoachMayAcceptPending,
  assertMinBookingLeadTime,
  bookingRequestCoachTimeoutCopy,
  bookingRequestStudentAcceptanceCopy,
  getCoachAcceptanceDeadlineAt,
  getCoachAcceptanceTimeoutHours,
  getMinBookingLeadHours,
  isWithinCoachAcceptanceWindow,
} from '../utils/coachAcceptanceTimeout.js';

describe('coachAcceptanceTimeout', () => {
  const prevPrimary = process.env.COACH_ACCEPTANCE_TIMEOUT_HOURS;
  const prevAlias = process.env.PENDING_BOOKING_EXPIRY_HOURS;
  const prevLead = process.env.MIN_BOOKING_LEAD_HOURS;

  afterEach(() => {
    if (prevPrimary === undefined) delete process.env.COACH_ACCEPTANCE_TIMEOUT_HOURS;
    else process.env.COACH_ACCEPTANCE_TIMEOUT_HOURS = prevPrimary;
    if (prevAlias === undefined) delete process.env.PENDING_BOOKING_EXPIRY_HOURS;
    else process.env.PENDING_BOOKING_EXPIRY_HOURS = prevAlias;
    if (prevLead === undefined) delete process.env.MIN_BOOKING_LEAD_HOURS;
    else process.env.MIN_BOOKING_LEAD_HOURS = prevLead;
  });

  it('defaults to 24h max window and 2h min lead', () => {
    delete process.env.COACH_ACCEPTANCE_TIMEOUT_HOURS;
    delete process.env.PENDING_BOOKING_EXPIRY_HOURS;
    delete process.env.MIN_BOOKING_LEAD_HOURS;
    assert.equal(getCoachAcceptanceTimeoutHours(), 24);
    assert.equal(getMinBookingLeadHours(), 2);
  });

  it('reads COACH_ACCEPTANCE_TIMEOUT_HOURS', () => {
    process.env.COACH_ACCEPTANCE_TIMEOUT_HOURS = '12';
    assert.equal(getCoachAcceptanceTimeoutHours(), 12);
    assert.match(bookingRequestCoachTimeoutCopy(), /within 12 hours of this request/);
    assert.match(bookingRequestCoachTimeoutCopy(), /at least 2 hours before the lesson/);
  });

  it('deadline is earlier of request+24h and lesson−2h (next-day lesson)', () => {
    // Wed 10:00 request, Thu 10:00 lesson → deadline Thu 08:00
    const requestAt = new Date('2026-08-26T14:00:00.000Z'); // Wed 10am ET
    const scheduledAt = new Date('2026-08-27T14:00:00.000Z'); // Thu 10am ET
    const deadline = getCoachAcceptanceDeadlineAt({
      requestAt,
      scheduledAt,
      maxHours: 24,
      leadHours: 2,
    });
    assert.equal(deadline.toISOString(), '2026-08-27T12:00:00.000Z');
  });

  it('deadline uses 24h window when lesson is far away', () => {
    const requestAt = new Date('2026-08-26T14:00:00.000Z');
    const scheduledAt = new Date('2026-08-30T14:00:00.000Z');
    const deadline = getCoachAcceptanceDeadlineAt({
      requestAt,
      scheduledAt,
      maxHours: 24,
      leadHours: 2,
    });
    assert.equal(deadline.toISOString(), '2026-08-27T14:00:00.000Z');
  });

  it('rejects booking requests inside the min lead window', () => {
    const now = new Date('2026-08-27T13:00:00.000Z'); // 9am
    const lesson = new Date('2026-08-27T14:00:00.000Z'); // 10am — only 1h out
    const result = assertMinBookingLeadTime(lesson, now, 2);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'booking_too_soon');
  });

  it('allows booking requests at or beyond the min lead window', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const lesson = new Date('2026-08-27T14:00:00.000Z');
    assert.equal(assertMinBookingLeadTime(lesson, now, 2).ok, true);
  });

  it('blocks coach accept after the lead-before-lesson cutoff', () => {
    const booking = {
      created_at: new Date('2026-08-26T14:00:00.000Z'),
      scheduled_at: new Date('2026-08-27T14:00:00.000Z'),
    };
    // Thu 9:55 — past Thu 8:00 deadline
    const late = new Date('2026-08-27T13:55:00.000Z');
    assert.equal(
      isWithinCoachAcceptanceWindow({
        requestAt: booking.created_at,
        scheduledAt: booking.scheduled_at,
        now: late,
        maxHours: 24,
        leadHours: 2,
      }),
      false,
    );
    const blocked = assertCoachMayAcceptPending(booking, late);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'acceptance_window_closed');
  });

  it('allows coach accept before the lead-before-lesson cutoff', () => {
    const booking = {
      created_at: new Date('2026-08-26T14:00:00.000Z'),
      scheduled_at: new Date('2026-08-27T14:00:00.000Z'),
    };
    // Thu 7:55 — before Thu 8:00 deadline
    const early = new Date('2026-08-27T11:55:00.000Z');
    assert.equal(assertCoachMayAcceptPending(booking, early).ok, true);
  });

  it('student acceptance copy mentions both limits', () => {
    assert.match(bookingRequestStudentAcceptanceCopy(24, 2), /up to 24 hours/);
    assert.match(bookingRequestStudentAcceptanceCopy(24, 2), /at least 2 hours before the lesson/);
  });
});
