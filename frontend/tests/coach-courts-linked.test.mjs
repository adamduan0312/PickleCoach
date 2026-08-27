import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCourtAlreadyLinked, linkedCourtIdSet } from '../src/utils/coachCourts.js';

describe('linkedCourtIdSet / isCourtAlreadyLinked', () => {
  it('collects court_id and nested court.id from my-courts links', () => {
    const ids = linkedCourtIdSet([
      { id: 99, court_id: 10, court: { id: 10, name: 'Holiday Park' } },
      { court: { id: 22, name: 'Bamford' } },
      { court_id: '33' },
      { id: 44 }, // link row id only — ignore
    ]);
    assert.deepEqual([...ids].sort((a, b) => a - b), [10, 22, 33]);
  });

  it('marks already-linked search results', () => {
    const linked = linkedCourtIdSet([{ court_id: 7 }]);
    assert.equal(isCourtAlreadyLinked(linked, { id: 7 }), true);
    assert.equal(isCourtAlreadyLinked(linked, { id: 8 }), false);
  });
});
