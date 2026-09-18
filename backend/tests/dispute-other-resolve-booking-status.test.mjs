import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveDisputeResolveBookingTransitionVia,
  deriveResolvedBookingStatusFromDisputeResolve,
} from '../utils/disputeResolveBookingStatus.js';
import { BookingTransitionVia, canTransitionBookingStatus } from '../services/bookingStateMachine.js';

describe('deriveResolvedBookingStatusFromDisputeResolve — other', () => {
  const other = { disputeTypeCode: 'other' };

  it('disputed + other → completed', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({ ...other, bookingStatus: 'disputed' }),
      'completed',
    );
  });

  it('completed + other → completed', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({ ...other, bookingStatus: 'completed' }),
      'completed',
    );
  });

  it('awaiting_verification + other → awaiting_verification', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        ...other,
        bookingStatus: 'awaiting_verification',
      }),
      'awaiting_verification',
    );
  });

  it('student_no_show + other → student_no_show', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        ...other,
        bookingStatus: 'student_no_show',
      }),
      'student_no_show',
    );
  });

  it('coach_no_show + other → coach_no_show', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        ...other,
        bookingStatus: 'coach_no_show',
      }),
      'coach_no_show',
    );
  });

  it('cancelled + other → cancelled', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({ ...other, bookingStatus: 'cancelled' }),
      'cancelled',
    );
  });
});

describe('deriveResolvedBookingStatusFromDisputeResolve — behavior unchanged', () => {
  it('disputed + misconduct → completed', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        disputeTypeCode: 'misconduct',
        bookingStatus: 'disputed',
      }),
      'completed',
    );
  });

  it('completed + misconduct → completed', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        disputeTypeCode: 'misconduct',
        bookingStatus: 'completed',
      }),
      'completed',
    );
  });
});

describe('deriveDisputeResolveBookingTransitionVia — other', () => {
  it('disputed → completed uses catchall via', () => {
    assert.equal(
      deriveDisputeResolveBookingTransitionVia({
        disputeTypeCode: 'other',
        fromStatus: 'disputed',
        toStatus: 'completed',
      }),
      BookingTransitionVia.DISPUTE_RESOLVE_CATCHALL_ON_DISPUTED_BOOKING,
    );
    const r = canTransitionBookingStatus(
      'disputed',
      'completed',
      BookingTransitionVia.DISPUTE_RESOLVE_CATCHALL_ON_DISPUTED_BOOKING,
    );
    assert.equal(r.ok, true);
  });

  it('behavior disputed → completed still uses behavior via', () => {
    assert.equal(
      deriveDisputeResolveBookingTransitionVia({
        disputeTypeCode: 'misconduct',
        fromStatus: 'disputed',
        toStatus: 'completed',
      }),
      BookingTransitionVia.DISPUTE_RESOLVE_BEHAVIOR_ON_DISPUTED_BOOKING,
    );
  });
});

describe('deriveResolvedBookingStatusFromDisputeResolve — attendance unchanged', () => {
  it('disputed + coach_no_show_claim + outcome → coach_no_show', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        disputeTypeCode: 'coach_no_show_claim',
        bookingStatus: 'disputed',
        outcome: 'coach_no_show',
      }),
      'coach_no_show',
    );
  });

  it('completed + coach_no_show_claim + lesson_occurred → completed', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        disputeTypeCode: 'coach_no_show_claim',
        bookingStatus: 'completed',
        outcome: 'lesson_occurred',
      }),
      'completed',
    );
  });

  it('student_no_show + student_no_show_claim + lesson_occurred → completed', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        disputeTypeCode: 'student_no_show_claim',
        bookingStatus: 'student_no_show',
        outcome: 'lesson_occurred',
      }),
      'completed',
    );
  });

  it('awaiting_verification + coach_no_show_claim + lesson_occurred → completed', () => {
    assert.equal(
      deriveResolvedBookingStatusFromDisputeResolve({
        disputeTypeCode: 'coach_no_show_claim',
        bookingStatus: 'awaiting_verification',
        outcome: 'lesson_occurred',
      }),
      'completed',
    );
  });
});

describe('deriveDisputeResolveBookingTransitionVia — attendance neutral', () => {
  it('attendance → completed uses neutral via', () => {
    assert.equal(
      deriveDisputeResolveBookingTransitionVia({
        disputeTypeCode: 'coach_no_show_claim',
        fromStatus: 'completed',
        toStatus: 'completed',
      }),
      BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE_NEUTRAL,
    );
    assert.equal(
      deriveDisputeResolveBookingTransitionVia({
        disputeTypeCode: 'student_no_show_claim',
        fromStatus: 'coach_no_show',
        toStatus: 'completed',
      }),
      BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE_NEUTRAL,
    );
    const r = canTransitionBookingStatus(
      'coach_no_show',
      'completed',
      BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE_NEUTRAL,
    );
    assert.equal(r.ok, true);
  });
});
