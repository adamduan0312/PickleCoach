import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  sortBookingsForList,
  bookingIncludedInListFilter,
} from '../src/domain/bookingStatus.js';

const now = new Date('2026-09-01T12:00:00.000Z').getTime();

function b(id, status, scheduled_at) {
  return { id, status, scheduled_at };
}

describe('sortBookingsForList', () => {
  it('orders pending before upcoming confirmed before past before cancelled (student)', () => {
    const input = [
      b(1, 'cancelled', '2026-09-10T10:00:00.000Z'),
      b(2, 'completed', '2026-08-20T10:00:00.000Z'),
      b(3, 'confirmed', '2026-09-08T10:00:00.000Z'),
      b(4, 'pending', '2026-09-15T10:00:00.000Z'),
      b(5, 'pending', '2026-09-05T10:00:00.000Z'),
    ];
    const ids = sortBookingsForList(input, now, { audience: 'student' }).map((x) => x.id);
    assert.deepEqual(ids, [5, 4, 3, 2, 1]);
  });

  it('sorts pending and upcoming by soonest lesson, past by most recent (student)', () => {
    const input = [
      b(1, 'pending', '2026-09-20T10:00:00.000Z'),
      b(2, 'pending', '2026-09-06T10:00:00.000Z'),
      b(3, 'confirmed', '2026-09-25T10:00:00.000Z'),
      b(4, 'confirmed', '2026-09-07T10:00:00.000Z'),
      b(5, 'completed', '2026-08-01T10:00:00.000Z'),
      b(6, 'completed', '2026-08-28T10:00:00.000Z'),
    ];
    const ids = sortBookingsForList(input, now, { audience: 'student' }).map((x) => x.id);
    assert.deepEqual(ids, [2, 1, 4, 3, 6, 5]);
  });

  it('student All: action required (pending + awaiting + issues) before upcoming before completed', () => {
    const input = [
      b(1, 'cancelled', '2026-09-02T15:00:00.000Z'),
      b(2, 'cancelled', '2026-08-25T15:00:00.000Z'),
      b(3, 'completed', '2026-08-31T15:00:00.000Z'),
      b(4, 'confirmed', '2026-09-08T15:00:00.000Z'),
      b(5, 'confirmed', '2026-09-01T14:00:00.000Z'),
      b(6, 'pending', '2026-09-02T15:00:00.000Z'),
      b(7, 'awaiting_verification', '2026-09-01T10:00:00.000Z'),
      {
        id: 8,
        status: 'completed',
        scheduled_at: '2026-08-30T10:00:00.000Z',
        active_issue: { id: 99 },
      },
    ];
    const ids = sortBookingsForList(input, now, { audience: 'student' }).map((x) => x.id);
    // pending (6) → awaiting (7) → issue on completed (8) → upcoming confirmed (5,4) → completed (3) → cancelled (1,2)
    assert.deepEqual(ids, [6, 7, 8, 5, 4, 3, 1, 2]);
  });

  it('coach QA matrix: awaiting_verification boosted after pending, before upcoming', () => {
    const input = [
      b(1, 'cancelled', '2026-09-02T15:00:00.000Z'),
      b(2, 'cancelled', '2026-08-25T15:00:00.000Z'),
      b(3, 'completed', '2026-08-31T15:00:00.000Z'),
      b(4, 'confirmed', '2026-09-08T15:00:00.000Z'),
      b(5, 'confirmed', '2026-09-01T14:00:00.000Z'),
      b(6, 'pending', '2026-09-02T15:00:00.000Z'),
      b(7, 'awaiting_verification', '2026-09-01T10:00:00.000Z'),
    ];
    const ids = sortBookingsForList(input, now, { audience: 'coach' }).map((x) => x.id);
    assert.deepEqual(ids, [6, 7, 5, 4, 3, 1, 2]);
  });

  it('coach awaiting_verification sorts above older completed lessons', () => {
    const input = [
      b(1, 'completed', '2026-08-01T10:00:00.000Z'),
      b(2, 'awaiting_verification', '2026-09-01T10:00:00.000Z'),
    ];
    const ids = sortBookingsForList(input, now, { audience: 'coach' }).map((x) => x.id);
    assert.deepEqual(ids, [2, 1]);
  });
});

describe('bookingIncludedInListFilter', () => {
  it('All includes every status for student', () => {
    const awaiting = b(1, 'awaiting_verification', '2026-09-01T10:00:00.000Z');
    const disputed = b(2, 'disputed', '2026-08-31T10:00:00.000Z');
    const noShow = b(3, 'student_no_show', '2026-08-30T10:00:00.000Z');

    assert.equal(bookingIncludedInListFilter(awaiting, ''), true);
    assert.equal(bookingIncludedInListFilter(disputed, ''), true);
    assert.equal(bookingIncludedInListFilter(noShow, ''), true);
  });

  it('student Awaiting confirmation includes pending and awaiting_verification', () => {
    const opts = { audience: 'student', now };
    assert.equal(bookingIncludedInListFilter(b(1, 'pending', '2026-09-02T10:00:00.000Z'), 'awaiting_confirmation', opts), true);
    assert.equal(bookingIncludedInListFilter(b(2, 'confirmed', '2026-09-03T10:00:00.000Z'), 'awaiting_confirmation', opts), false);
    assert.equal(bookingIncludedInListFilter(b(3, 'awaiting_verification', '2026-09-01T10:00:00.000Z'), 'awaiting_confirmation', opts), true);
  });

  it('student Upcoming is confirmed lessons that have not ended', () => {
    const opts = { audience: 'student', now };
    assert.equal(bookingIncludedInListFilter(b(1, 'confirmed', '2026-09-08T10:00:00.000Z'), 'upcoming', opts), true);
    assert.equal(bookingIncludedInListFilter({
      id: 2,
      status: 'confirmed',
      scheduled_at: '2026-09-01T10:00:00.000Z',
      duration_minutes: 60,
    }, 'upcoming', opts), false);
    assert.equal(bookingIncludedInListFilter(b(3, 'pending', '2026-09-08T10:00:00.000Z'), 'upcoming', opts), false);
  });

  it('student Completed includes completed only (open issues stay under Completed by status)', () => {
    const opts = { audience: 'student', now };
    assert.equal(bookingIncludedInListFilter(b(1, 'completed', '2026-08-31T10:00:00.000Z'), 'completed', opts), true);
    assert.equal(bookingIncludedInListFilter({
      id: 2,
      status: 'completed',
      active_issue: { id: 9 },
      scheduled_at: '2026-08-31T10:00:00.000Z',
    }, 'completed', opts), true);
    assert.equal(bookingIncludedInListFilter(b(3, 'awaiting_verification', '2026-09-01T10:00:00.000Z'), 'completed', opts), false);
    assert.equal(bookingIncludedInListFilter(b(4, 'student_no_show', '2026-08-30T10:00:00.000Z'), 'completed', opts), false);
  });

  it('student Cancelled includes cancelled / declined / expired', () => {
    const opts = { audience: 'student', now };
    assert.equal(bookingIncludedInListFilter({ id: 1, status: 'cancelled' }, 'cancelled', opts), true);
    assert.equal(bookingIncludedInListFilter({ id: 2, status: 'cancelled', cancelled_by: 'system' }, 'cancelled', opts), true);
    assert.equal(bookingIncludedInListFilter({ id: 3, status: 'cancelled', declined_at: '2026-09-01T09:00:00.000Z' }, 'cancelled', opts), true);
    assert.equal(bookingIncludedInListFilter(b(4, 'completed', '2026-08-31T10:00:00.000Z'), 'cancelled', opts), false);
  });

  it('coach Action needed matches nav attention (pending, actionable verify, open issue)', () => {
    const opts = { audience: 'coach', now };
    assert.equal(bookingIncludedInListFilter(b(1, 'pending', '2026-09-02T10:00:00.000Z'), 'action_needed', opts), true);
    assert.equal(bookingIncludedInListFilter({
      id: 2,
      status: 'awaiting_verification',
      scheduled_at: '2026-09-01T10:00:00.000Z',
      duration_minutes: 60,
    }, 'action_needed', opts), true);
    assert.equal(bookingIncludedInListFilter({
      id: 3,
      status: 'completed',
      active_issue: { id: 9 },
      scheduled_at: '2026-08-31T10:00:00.000Z',
    }, 'action_needed', opts), true);
    assert.equal(bookingIncludedInListFilter(b(4, 'disputed', '2026-08-31T10:00:00.000Z'), 'action_needed', opts), true);
    assert.equal(bookingIncludedInListFilter(b(5, 'confirmed', '2026-09-08T10:00:00.000Z'), 'action_needed', opts), false);
    assert.equal(bookingIncludedInListFilter(b(6, 'completed', '2026-08-31T10:00:00.000Z'), 'action_needed', opts), false);
    // Legacy URL alias
    assert.equal(bookingIncludedInListFilter(b(7, 'pending', '2026-09-02T10:00:00.000Z'), 'needs_attention', opts), true);
  });

  it('coach Upcoming is confirmed lessons that have not ended', () => {
    const opts = { audience: 'coach', now };
    assert.equal(bookingIncludedInListFilter(b(1, 'confirmed', '2026-09-08T10:00:00.000Z'), 'upcoming', opts), true);
    assert.equal(bookingIncludedInListFilter({
      id: 2,
      status: 'confirmed',
      scheduled_at: '2026-09-01T10:00:00.000Z',
      duration_minutes: 60,
    }, 'upcoming', opts), false);
    assert.equal(bookingIncludedInListFilter(b(3, 'pending', '2026-09-08T10:00:00.000Z'), 'upcoming', opts), false);
  });

  it('coach Completed includes completed only', () => {
    const opts = { audience: 'coach', now };
    assert.equal(bookingIncludedInListFilter(b(1, 'completed', '2026-08-31T10:00:00.000Z'), 'completed', opts), true);
    assert.equal(bookingIncludedInListFilter(b(2, 'coach_no_show', '2026-08-30T10:00:00.000Z'), 'completed', opts), false);
  });
});
