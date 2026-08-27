import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDisputeCreateBookingEligibility,
  DISPUTE_CREATE_ALLOWED_BOOKING_STATUSES,
  lessonHasEnded,
} from '../utils/disputeCreateEligibility.js';

const lessonStart = new Date('2026-07-01T15:00:00.000Z');
const duringLesson = new Date('2026-07-01T15:30:00.000Z');
const afterLesson = new Date('2026-07-01T16:05:00.000Z');

const baseBooking = {
  scheduled_at: lessonStart,
  duration_minutes: 60,
};

describe('disputeCreateEligibility', () => {
  it('allows post-lesson terminal and verification statuses', () => {
    for (const status of DISPUTE_CREATE_ALLOWED_BOOKING_STATUSES) {
      const r = checkDisputeCreateBookingEligibility({ ...baseBooking, status }, afterLesson);
      assert.equal(r.ok, true, status);
    }
  });

  it('allows confirmed only after lesson end time', () => {
    assert.equal(
      checkDisputeCreateBookingEligibility({ ...baseBooking, status: 'confirmed' }, duringLesson).ok,
      false,
    );
    assert.equal(
      checkDisputeCreateBookingEligibility({ ...baseBooking, status: 'confirmed' }, afterLesson).ok,
      true,
    );
  });

  it('blocks pending bookings', () => {
    const r = checkDisputeCreateBookingEligibility({ ...baseBooking, status: 'pending' }, afterLesson);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'dispute_create_pre_lesson_booking');
  });

  it('blocks cancelled bookings', () => {
    const r = checkDisputeCreateBookingEligibility({ ...baseBooking, status: 'cancelled' }, afterLesson);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'dispute_create_cancelled_booking');
  });

  it('blocks student/coach creates after the 24h review window', () => {
    const afterWindow = new Date('2026-07-02T16:05:00.000Z');
    const r = checkDisputeCreateBookingEligibility(
      { ...baseBooking, status: 'completed' },
      afterWindow,
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'dispute_create_financial_review_closed');
  });

  it('allows admin creates after the 24h review window', () => {
    const afterWindow = new Date('2026-07-02T16:05:00.000Z');
    const r = checkDisputeCreateBookingEligibility(
      { ...baseBooking, status: 'completed' },
      afterWindow,
      { isAdmin: true },
    );
    assert.equal(r.ok, true);
  });

  it('allows student/coach creates during the 24h window', () => {
    const duringWindow = new Date('2026-07-01T20:00:00.000Z');
    const r = checkDisputeCreateBookingEligibility(
      { ...baseBooking, status: 'awaiting_verification' },
      duringWindow,
    );
    assert.equal(r.ok, true);
  });

  it('lessonHasEnded matches scheduled_at + duration_minutes', () => {
    const booking = { scheduled_at: lessonStart, duration_minutes: 60 };
    assert.equal(lessonHasEnded(booking, duringLesson), false);
    assert.equal(lessonHasEnded(booking, afterLesson), true);
  });
});
