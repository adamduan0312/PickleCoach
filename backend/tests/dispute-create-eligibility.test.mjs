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

  it('lessonHasEnded matches scheduled_at + duration_minutes', () => {
    const booking = { scheduled_at: lessonStart, duration_minutes: 60 };
    assert.equal(lessonHasEnded(booking, duringLesson), false);
    assert.equal(lessonHasEnded(booking, afterLesson), true);
  });
});
