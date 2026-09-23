import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adminCancelBlockedMessage,
  adminNoShowEligibility,
  adminRefundEligibility,
  canAdminCancelBooking,
  canAdminCreateDispute,
  formatAdminBookingActionError,
  refundableRemainingAmount,
  ADMIN_REFUND_REASONS,
} from '../src/domain/adminBookingActions.js';

const futureStart = '2099-06-01T15:00:00.000Z';
const pastStart = '2020-06-01T15:00:00.000Z';

describe('admin booking action eligibility', () => {
  it('allows cancel only for pending/confirmed before lesson start', () => {
    assert.equal(canAdminCancelBooking({ status: 'pending', scheduled_at: futureStart }), true);
    assert.equal(canAdminCancelBooking({ status: 'confirmed', scheduled_at: futureStart }), true);
    assert.equal(canAdminCancelBooking({ status: 'confirmed', scheduled_at: pastStart }), false);
    assert.equal(canAdminCancelBooking({ status: 'completed', scheduled_at: futureStart }), false);
    assert.equal(canAdminCancelBooking({ status: 'disputed', scheduled_at: futureStart }), false);
  });

  it('blocks refund when an active issue exists', () => {
    const r = adminRefundEligibility(
      { status: 'completed', active_issue: { id: 9 }, financial_review: { window_open: false } },
      { payment_status: 'captured', total_charge_to_student: 50 },
    );
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'refund_requires_dispute_resolution');
  });

  it('blocks refund while financial review window is open', () => {
    const now = Date.parse('2026-06-02T12:00:00.000Z');
    const r = adminRefundEligibility(
      {
        status: 'completed',
        financial_review: {
          lesson_ended_at: '2026-06-01T16:00:00.000Z',
          review_until: '2026-06-02T16:00:00.000Z',
          window_open: true,
        },
      },
      { payment_status: 'captured', total_charge_to_student: 50 },
      now,
    );
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'financial_review_window_open');
  });

  it('blocks refund when payment already refunded', () => {
    const r = adminRefundEligibility(
      { status: 'completed', financial_review: { window_open: false } },
      { payment_status: 'refunded', refunded_amount: 50, total_charge_to_student: 50 },
    );
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'refund_path_already_used');
  });

  it('allows refund when captured, no issue, review closed and exposes remaining', () => {
    const now = Date.parse('2026-06-03T12:00:00.000Z');
    const r = adminRefundEligibility(
      {
        status: 'completed',
        financial_review: {
          lesson_ended_at: '2026-06-01T16:00:00.000Z',
          review_until: '2026-06-02T16:00:00.000Z',
          window_open: false,
        },
      },
      { payment_status: 'captured', refunded_amount: 0, total_charge_to_student: 80 },
      now,
    );
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 80);
    assert.equal(refundableRemainingAmount({ total_charge_to_student: 80, refunded_amount: 20 }), 60);
  });

  it('exposes the three Stripe refund reasons supported by the backend', () => {
    assert.deepEqual(
      ADMIN_REFUND_REASONS.map((r) => r.value),
      ['requested_by_customer', 'duplicate', 'fraudulent'],
    );
  });

  it('gates admin no-show on status, lesson end, dispute, and finalized', () => {
    const ended = {
      status: 'completed',
      scheduled_at: pastStart,
      duration_minutes: 60,
      attendance_finalized: false,
    };
    // completed is NOT in ADMIN_MARK_NO_SHOW_SOURCE_STATUSES
    assert.equal(adminNoShowEligibility(ended, { payment_status: 'captured' }, 'student_no_show').allowed, false);

    const eligible = {
      status: 'awaiting_verification',
      scheduled_at: pastStart,
      duration_minutes: 60,
      attendance_finalized: false,
    };
    assert.equal(
      adminNoShowEligibility(eligible, { payment_status: 'captured', escrow_status: 'held' }, 'student_no_show').allowed,
      true,
    );
    assert.equal(
      adminNoShowEligibility(
        { ...eligible, active_issue: { id: 1 } },
        { payment_status: 'captured' },
        'coach_no_show',
      ).allowed,
      false,
    );
  });

  it('allows admin create dispute after lesson for completed bookings without open issue', () => {
    assert.equal(
      canAdminCreateDispute({ status: 'completed', scheduled_at: pastStart, duration_minutes: 60 }),
      true,
    );
    assert.equal(
      canAdminCreateDispute({
        status: 'completed',
        scheduled_at: pastStart,
        duration_minutes: 60,
        active_issue: { id: 3 },
      }),
      false,
    );
  });

  it('maps admin booking action API codes', () => {
    assert.match(
      formatAdminBookingActionError({ code: 'refund_requires_dispute_resolution', message: 'x' }),
      /active dispute/i,
    );
    assert.match(
      formatAdminBookingActionError({ code: 'financial_review_window_open', message: 'x' }),
      /24-hour/i,
    );
    assert.match(
      formatAdminBookingActionError({ code: 'cancel_pre_lesson_only', message: 'x' }),
      /pending or confirmed/i,
    );
    assert.match(
      formatAdminBookingActionError({ code: 'disputed_use_resolve_dispute', message: 'x' }),
      /dispute/i,
    );
    assert.match(
      adminCancelBlockedMessage({ status: 'completed', scheduled_at: pastStart }),
      /Completed bookings cannot be cancelled/i,
    );
  });
});
