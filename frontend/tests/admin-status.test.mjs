import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adminBookingMoneyStatusItems,
  adminBookingStatusView,
  adminDisputeStatusView,
  adminEscrowStatusView,
  adminIssueStatusView,
  adminPaymentStatusView,
  adminPayoutStatusView,
  adminPayoutViewForPaymentRow,
  adminRefundStatusView,
  disputeAgeLabel,
  formatReliabilityPercent,
} from '../src/domain/adminStatus.js';

describe('admin status separation', () => {
  it('keeps booking lifecycle separate from open in-app issue', () => {
    const booking = {
      status: 'completed',
      payout_status: 'pending',
      active_issue: { id: 30, status: 'open', opened_by: 'student' },
    };
    const payment = {
      payment_status: 'captured',
      escrow_status: 'held',
      refund_status: 'none',
    };

    assert.equal(adminBookingStatusView(booking).value, 'Completed');
    assert.equal(adminIssueStatusView(booking).value, 'Issue reported');
    assert.equal(adminPaymentStatusView(payment).value, 'Captured');
    assert.equal(adminEscrowStatusView(payment).value, 'Held');
    assert.equal(adminPayoutStatusView(booking).value, 'Pending');
    assert.equal(adminRefundStatusView(payment).value, 'None');

    const stack = adminBookingMoneyStatusItems({ booking, payment });
    assert.deepEqual(
      stack.map((row) => `${row.label}:${row.value}`),
      [
        'Booking:Completed',
        'Issue:Issue reported',
        'Payment:Captured',
        'Escrow:Held',
        'Payout:Pending',
      ],
    );
  });

  it('does not relabel Stripe disputed booking as Issue reported', () => {
    const booking = {
      status: 'disputed',
      payout_status: 'none',
      active_issue: null,
    };
    assert.equal(adminBookingStatusView(booking).value, 'Disputed');
    assert.equal(adminIssueStatusView(booking).value, 'None');
  });

  it('labels dispute and reliability helpers', () => {
    assert.equal(adminDisputeStatusView({ status: 'under_review' }).value, 'Under review');
    assert.equal(formatReliabilityPercent({ reliability_score: 96.4 }), '96%');
    const age = disputeAgeLabel(new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString());
    assert.equal(age, '5h');
  });

  it('does not treat a student charge as a coach payout', () => {
    const held = adminPayoutViewForPaymentRow({
      charge_id: 'ch_123',
      escrow_status: 'held',
      payment_status: 'captured',
      transfer_id: null,
    });
    assert.equal(held.value, 'Not released');
    assert.notEqual(held.value, 'Captured');

    const transferred = adminPayoutViewForPaymentRow({
      charge_id: 'ch_123',
      escrow_status: 'released',
      transfer_id: 'tr_abc',
    });
    assert.equal(transferred.value, 'Transfer created');
  });
});
