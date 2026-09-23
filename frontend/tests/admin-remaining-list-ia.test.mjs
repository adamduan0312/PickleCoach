import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adminDisputeLifecycleGroup,
  sortAdminDisputesForList,
} from '../src/domain/adminDisputeList.js';
import {
  adminPaymentLifecycleGroup,
  sortAdminPaymentsForList,
} from '../src/domain/adminPaymentList.js';
import {
  adminLessonInventoryGroup,
  sortAdminLessonsForList,
} from '../src/domain/adminLessonList.js';
import { sortAdminReviewsForList } from '../src/domain/adminReviewList.js';
import { adminUsersListHint } from '../src/domain/adminUserList.js';

describe('adminDisputeList', () => {
  it('groups open/under_review as action required', () => {
    assert.equal(adminDisputeLifecycleGroup({ status: 'open' }), 0);
    assert.equal(adminDisputeLifecycleGroup({ status: 'under_review' }), 0);
    assert.equal(adminDisputeLifecycleGroup({ status: 'resolved' }), 1);
    assert.equal(adminDisputeLifecycleGroup({ status: 'rejected' }), 1);
  });

  it('Open: open before under_review, then oldest opened_at first', () => {
    const ids = sortAdminDisputesForList([
      { id: 3, status: 'under_review', opened_at: '2026-09-01T10:00:00.000Z' },
      { id: 2, status: 'open', opened_at: '2026-09-10T10:00:00.000Z' },
      { id: 1, status: 'open', opened_at: '2026-09-05T10:00:00.000Z' },
    ], 'open').map((d) => d.id);
    assert.deepEqual(ids, [1, 2, 3]);
  });

  it('All: action required before closed; resolved by resolved_at DESC', () => {
    const ids = sortAdminDisputesForList([
      { id: 10, status: 'resolved', opened_at: '2026-08-01T10:00:00.000Z', resolved_at: '2026-09-01T10:00:00.000Z' },
      { id: 11, status: 'resolved', opened_at: '2026-08-02T10:00:00.000Z', resolved_at: '2026-09-10T10:00:00.000Z' },
      { id: 1, status: 'open', opened_at: '2026-09-05T10:00:00.000Z' },
      { id: 2, status: 'rejected', opened_at: '2026-08-15T10:00:00.000Z', resolved_at: '2026-08-20T10:00:00.000Z' },
    ], 'all').map((d) => d.id);
    assert.deepEqual(ids, [1, 11, 10, 2]);
  });
});

describe('adminPaymentList', () => {
  it('bands action / in progress / settled / refunded', () => {
    assert.equal(adminPaymentLifecycleGroup({ payment_status: 'failed', escrow_status: 'pending', refund_status: 'none' }), 0);
    assert.equal(adminPaymentLifecycleGroup({ payment_status: 'captured', escrow_status: 'manual_payout_required', refund_status: 'none' }), 0);
    assert.equal(adminPaymentLifecycleGroup({ payment_status: 'authorized', escrow_status: 'pending', refund_status: 'none' }), 1);
    assert.equal(adminPaymentLifecycleGroup({ payment_status: 'captured', escrow_status: 'held', refund_status: 'none' }), 1);
    assert.equal(adminPaymentLifecycleGroup({ payment_status: 'captured', escrow_status: 'released', refund_status: 'none' }), 2);
    assert.equal(adminPaymentLifecycleGroup({ payment_status: 'refunded', escrow_status: 'refunded', refund_status: 'succeeded' }), 3);
  });

  it('All: action before in progress before settled before refunded; activity DESC within', () => {
    const ids = sortAdminPaymentsForList([
      { id: 4, payment_status: 'refunded', escrow_status: 'refunded', refund_status: 'succeeded', updated_at: '2026-09-20T10:00:00.000Z' },
      { id: 3, payment_status: 'captured', escrow_status: 'released', refund_status: 'none', updated_at: '2026-09-18T10:00:00.000Z' },
      { id: 2, payment_status: 'authorized', escrow_status: 'pending', refund_status: 'none', updated_at: '2026-09-19T10:00:00.000Z' },
      { id: 1, payment_status: 'failed', escrow_status: 'pending', refund_status: 'none', updated_at: '2026-09-10T10:00:00.000Z' },
    ], '').map((p) => p.id);
    assert.deepEqual(ids, [1, 2, 3, 4]);
  });
});

describe('adminLessonList', () => {
  it('groups active → inactive → deleted', () => {
    assert.equal(adminLessonInventoryGroup({ is_active: true }), 0);
    assert.equal(adminLessonInventoryGroup({ is_active: false }), 1);
    assert.equal(adminLessonInventoryGroup({ is_active: true, deleted_at: '2026-09-01T00:00:00.000Z' }), 2);
  });

  it('sorts by inventory group then created_at DESC', () => {
    const ids = sortAdminLessonsForList([
      { id: 3, is_active: false, created_at: '2026-09-10T10:00:00.000Z' },
      { id: 1, is_active: true, created_at: '2026-09-01T10:00:00.000Z' },
      { id: 2, is_active: true, created_at: '2026-09-15T10:00:00.000Z' },
      { id: 4, is_active: true, deleted_at: '2026-09-20T10:00:00.000Z', created_at: '2026-08-01T10:00:00.000Z' },
    ]).map((l) => l.id);
    assert.deepEqual(ids, [2, 1, 3, 4]);
  });
});

describe('adminReviewList', () => {
  it('sorts most recent created_at first', () => {
    const ids = sortAdminReviewsForList([
      { id: 1, created_at: '2026-09-01T10:00:00.000Z' },
      { id: 3, created_at: '2026-09-10T10:00:00.000Z' },
      { id: 2, created_at: '2026-09-05T10:00:00.000Z' },
    ]).map((r) => r.id);
    assert.deepEqual(ids, [3, 2, 1]);
  });
});

describe('adminUserList hint', () => {
  it('describes deleted clock', () => {
    assert.match(adminUsersListHint({ statusFilter: 'deleted', totalItems: 2 }), /recently deleted/i);
  });

  it('describes All suspended-before-active', () => {
    assert.match(adminUsersListHint({ statusFilter: '', totalItems: 10 }), /suspended before active/i);
  });
});
