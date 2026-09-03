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

  it('student QA matrix: awaiting_verification after upcoming, before completed', () => {
    const input = [
      b(1, 'cancelled', '2026-09-02T15:00:00.000Z'),
      b(2, 'cancelled', '2026-08-25T15:00:00.000Z'),
      b(3, 'completed', '2026-08-31T15:00:00.000Z'),
      b(4, 'confirmed', '2026-09-08T15:00:00.000Z'),
      b(5, 'confirmed', '2026-09-01T14:00:00.000Z'),
      b(6, 'pending', '2026-09-02T15:00:00.000Z'),
      b(7, 'awaiting_verification', '2026-09-01T10:00:00.000Z'),
    ];
    const ids = sortBookingsForList(input, now, { audience: 'student' }).map((x) => x.id);
    assert.deepEqual(ids, [6, 5, 4, 7, 3, 1, 2]);
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
  it('All includes every status; explicit filters match status exactly', () => {
    const awaiting = b(1, 'awaiting_verification', '2026-09-01T10:00:00.000Z');
    const disputed = b(2, 'disputed', '2026-08-31T10:00:00.000Z');
    const noShow = b(3, 'student_no_show', '2026-08-30T10:00:00.000Z');

    assert.equal(bookingIncludedInListFilter(awaiting, ''), true);
    assert.equal(bookingIncludedInListFilter(disputed, ''), true);
    assert.equal(bookingIncludedInListFilter(noShow, ''), true);

    assert.equal(bookingIncludedInListFilter(awaiting, 'completed'), false);
    assert.equal(bookingIncludedInListFilter(awaiting, 'confirmed'), false);
    assert.equal(bookingIncludedInListFilter(disputed, 'completed'), false);
    assert.equal(bookingIncludedInListFilter(noShow, 'cancelled'), false);

    assert.equal(bookingIncludedInListFilter(b(4, 'completed', '2026-08-31T10:00:00.000Z'), 'completed'), true);
    assert.equal(bookingIncludedInListFilter(b(5, 'pending', '2026-09-02T10:00:00.000Z'), 'pending'), true);
  });
});
