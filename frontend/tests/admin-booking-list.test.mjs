import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adminBookingLifecycleGroup,
  adminBookingsListHint,
  sortAdminBookingsForList,
} from '../src/domain/adminBookingList.js';

const now = new Date('2026-09-22T16:00:00.000Z').getTime();

function b(id, status, scheduled_at, extras = {}) {
  return { id, status, scheduled_at, ...extras };
}

describe('adminBookingLifecycleGroup', () => {
  it('bands action required / upcoming / finished / closed', () => {
    assert.equal(adminBookingLifecycleGroup(b(1, 'pending', '2026-09-25T10:00:00.000Z')), 0);
    assert.equal(adminBookingLifecycleGroup(b(2, 'awaiting_verification', '2026-09-21T10:00:00.000Z')), 0);
    assert.equal(adminBookingLifecycleGroup(b(3, 'disputed', '2026-09-20T10:00:00.000Z')), 0);
    assert.equal(adminBookingLifecycleGroup(b(4, 'confirmed', '2026-09-25T10:00:00.000Z')), 1);
    assert.equal(adminBookingLifecycleGroup(b(5, 'completed', '2026-09-20T10:00:00.000Z')), 2);
    assert.equal(adminBookingLifecycleGroup(b(6, 'student_no_show', '2026-09-19T10:00:00.000Z')), 2);
    assert.equal(adminBookingLifecycleGroup(b(7, 'coach_no_show', '2026-09-18T10:00:00.000Z')), 2);
    assert.equal(adminBookingLifecycleGroup(b(8, 'cancelled', '2026-09-17T10:00:00.000Z')), 3);
  });

  it('does not promote completed + issue into action required', () => {
    assert.equal(adminBookingLifecycleGroup(b(9, 'completed', '2026-09-20T10:00:00.000Z', {
      active_issue: { id: 1 },
    })), 2);
  });
});

describe('sortAdminBookingsForList', () => {
  it('All: action required → confirmed → finished → cancelled', () => {
    const input = [
      b(737, 'cancelled', '2026-09-20T10:00:00.000Z'),
      b(743, 'completed', '2026-09-21T10:00:00.000Z'),
      b(730, 'confirmed', '2026-09-25T10:00:00.000Z'),
      b(738, 'disputed', '2026-09-19T10:00:00.000Z'),
      b(732, 'awaiting_verification', '2026-09-21T08:00:00.000Z'),
      b(703, 'pending', '2026-09-24T10:00:00.000Z', {
        coach_acceptance_deadline_at: '2026-09-23T12:00:00.000Z',
      }),
      b(735, 'student_no_show', '2026-09-18T10:00:00.000Z'),
    ];
    const ids = sortAdminBookingsForList(input, '', now).map((x) => x.id);
    assert.deepEqual(ids, [703, 732, 738, 730, 743, 735, 737]);
  });

  it('All: pending before awaiting before disputed; pending by earliest deadline', () => {
    const input = [
      b(704, 'pending', '2026-09-26T10:00:00.000Z', {
        coach_acceptance_deadline_at: '2026-09-24T18:00:00.000Z',
      }),
      b(703, 'pending', '2026-09-25T10:00:00.000Z', {
        coach_acceptance_deadline_at: '2026-09-23T12:00:00.000Z',
      }),
      b(738, 'disputed', '2026-09-18T10:00:00.000Z'),
      b(732, 'awaiting_verification', '2026-09-20T10:00:00.000Z'),
      b(731, 'awaiting_verification', '2026-09-19T10:00:00.000Z'),
    ];
    const ids = sortAdminBookingsForList(input, '', now).map((x) => x.id);
    assert.deepEqual(ids, [703, 704, 731, 732, 738]);
  });

  it('Pending tab: acceptance deadline then lesson date/time', () => {
    const input = [
      b(2, 'pending', '2026-09-28T10:00:00.000Z', {
        coach_acceptance_deadline_at: '2026-09-25T12:00:00.000Z',
      }),
      b(1, 'pending', '2026-09-27T10:00:00.000Z', {
        coach_acceptance_deadline_at: '2026-09-23T12:00:00.000Z',
      }),
      b(3, 'pending', '2026-09-26T10:00:00.000Z', {
        coach_acceptance_deadline_at: '2026-09-25T12:00:00.000Z',
      }),
    ];
    const ids = sortAdminBookingsForList(input, 'pending', now).map((x) => x.id);
    assert.deepEqual(ids, [1, 3, 2]);
  });

  it('Disputed tab: open/needs action before under_review, then age, then lesson', () => {
    const input = [
      b(3, 'disputed', '2026-09-10T10:00:00.000Z', {
        active_issue: {
          id: 3,
          status: 'under_review',
          opened_at: '2026-09-01T10:00:00.000Z',
        },
      }),
      b(2, 'disputed', '2026-09-12T10:00:00.000Z', {
        active_issue: {
          id: 2,
          status: 'open',
          opened_at: '2026-09-05T10:00:00.000Z',
        },
      }),
      b(1, 'disputed', '2026-09-11T10:00:00.000Z', {
        active_issue: {
          id: 1,
          status: 'open',
          opened_at: '2026-09-02T10:00:00.000Z',
        },
      }),
    ];
    const ids = sortAdminBookingsForList(input, 'disputed', now).map((x) => x.id);
    assert.deepEqual(ids, [1, 2, 3]);
  });

  it('Cancelled tab: most recently cancelled first (cancelled_at)', () => {
    const input = [
      b(1, 'cancelled', '2026-09-20T10:00:00.000Z', {
        cancelled_at: '2026-09-10T10:00:00.000Z',
      }),
      b(2, 'cancelled', '2026-09-15T10:00:00.000Z', {
        cancelled_at: '2026-09-18T10:00:00.000Z',
      }),
    ];
    const ids = sortAdminBookingsForList(input, 'cancelled', now).map((x) => x.id);
    assert.deepEqual(ids, [2, 1]);
  });

  it('Confirmed tab: upcoming soonest first, then started/past most recent', () => {
    const input = [
      b(3, 'confirmed', '2026-09-28T10:00:00.000Z'),
      b(1, 'confirmed', '2026-09-21T10:00:00.000Z'), // past
      b(2, 'confirmed', '2026-09-24T10:00:00.000Z'),
    ];
    const ids = sortAdminBookingsForList(input, 'confirmed', now).map((x) => x.id);
    assert.deepEqual(ids, [2, 3, 1]);
  });

  it('Awaiting verification: oldest lesson first', () => {
    const input = [
      b(2, 'awaiting_verification', '2026-09-21T12:00:00.000Z'),
      b(1, 'awaiting_verification', '2026-09-20T12:00:00.000Z'),
    ];
    const ids = sortAdminBookingsForList(input, 'awaiting_verification', now).map((x) => x.id);
    assert.deepEqual(ids, [1, 2]);
  });

  it('Completed / cancelled / no-show: most recent lesson first', () => {
    assert.deepEqual(
      sortAdminBookingsForList([
        b(1, 'completed', '2026-09-10T10:00:00.000Z'),
        b(2, 'completed', '2026-09-20T10:00:00.000Z'),
      ], 'completed', now).map((x) => x.id),
      [2, 1],
    );
    assert.deepEqual(
      sortAdminBookingsForList([
        b(1, 'cancelled', '2026-09-10T10:00:00.000Z'),
        b(2, 'cancelled', '2026-09-20T10:00:00.000Z'),
      ], 'cancelled', now).map((x) => x.id),
      [2, 1],
    );
    assert.deepEqual(
      sortAdminBookingsForList([
        b(1, 'student_no_show', '2026-09-10T10:00:00.000Z'),
        b(2, 'student_no_show', '2026-09-20T10:00:00.000Z'),
      ], 'student_no_show', now).map((x) => x.id),
      [2, 1],
    );
  });
});

describe('adminBookingsListHint', () => {
  it('summarizes action-required counts on All', () => {
    const hint = adminBookingsListHint([
      b(1, 'pending', '2026-09-25T10:00:00.000Z'),
      b(2, 'pending', '2026-09-26T10:00:00.000Z'),
      b(3, 'awaiting_verification', '2026-09-21T10:00:00.000Z'),
      b(4, 'disputed', '2026-09-20T10:00:00.000Z'),
      b(5, 'confirmed', '2026-09-27T10:00:00.000Z'),
    ], '');
    assert.match(hint, /2 pending/);
    assert.match(hint, /1 awaiting verification/);
    assert.match(hint, /1 disputed/);
  });

  it('describes pending tab sort intent', () => {
    const hint = adminBookingsListHint([
      b(1, 'pending', '2026-09-25T10:00:00.000Z'),
    ], 'pending');
    assert.match(hint, /acceptance deadline/i);
  });

  it('describes disputed tab action-first intent', () => {
    const hint = adminBookingsListHint([
      b(1, 'disputed', '2026-09-20T10:00:00.000Z'),
    ], 'disputed');
    assert.match(hint, /open\/needs action/i);
  });
});
