import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cleanLocationQuery,
  isCourtAlreadyLinked,
  courtDiscoveryView,
  isCourtDiscoveryPending,
  linkedCourtIdSet,
  splitPastedCourtAddress,
} from '../src/utils/coachCourts.js';

describe('cleanLocationQuery', () => {
  it('drops Plus Codes and repeated parts for the results header', () => {
    assert.equal(
      cleanLocationQuery('3PGM+5JF, 3801 S Pine Island Rd, Davie, FL 33328, Davie, FL'),
      '3801 S Pine Island Rd, Davie, FL 33328',
    );
    assert.equal(cleanLocationQuery('33328'), '33328');
    assert.equal(cleanLocationQuery('Davie,  FL'), 'Davie, FL');
  });
});

describe('splitPastedCourtAddress', () => {
  it('splits a pasted line with a Plus Code and repeated parts', () => {
    assert.deepEqual(
      splitPastedCourtAddress('3PGM+5JF, 3801 S Pine Island Rd, Davie, FL 33328, Davie, FL, 33328'),
      { address_line1: '3801 S Pine Island Rd', city: 'Davie', state: 'FL', postal_code: '33328' },
    );
  });

  it('handles multi-word cities, a trailing country, and lowercase state', () => {
    assert.deepEqual(
      splitPastedCourtAddress('1350 W Broward Blvd, Fort Lauderdale, fl 33312, USA'),
      { address_line1: '1350 W Broward Blvd', city: 'Fort Lauderdale', state: 'FL', postal_code: '33312' },
    );
  });

  it('strips a Plus Code from a street-only value', () => {
    assert.deepEqual(
      splitPastedCourtAddress('3PGM+5JF 3801 S Pine Island Rd'),
      { address_line1: '3801 S Pine Island Rd', city: '', state: '', postal_code: '' },
    );
  });

  it('returns null for a plain street address', () => {
    assert.equal(splitPastedCourtAddress('3801 S Pine Island Rd'), null);
  });
});

describe('isCourtDiscoveryPending', () => {
  it('is true only while discovery is started or running', () => {
    assert.equal(isCourtDiscoveryPending({ discovery: { status: 'started' } }), true);
    assert.equal(isCourtDiscoveryPending({ discovery: { status: 'running' } }), true);
    assert.equal(isCourtDiscoveryPending({ discovery: { status: 'recent' } }), false);
    assert.equal(isCourtDiscoveryPending({}), false);
    assert.equal(isCourtDiscoveryPending({ data: [], raw: { discovery: { status: 'started' } } }), true);
    assert.equal(isCourtDiscoveryPending({ data: [], raw: { discovery: { status: 'recent' } } }), false);
  });

  it('distinguishes still checking, failed, and checked', () => {
    const view = (status) => courtDiscoveryView({ data: [], raw: { discovery: { status } } });
    assert.equal(view('started'), 'pending');
    assert.equal(view('running'), 'pending');
    assert.equal(view('failed'), 'failed');
    assert.equal(view('recent'), null);
    assert.equal(courtDiscoveryView({ data: [] }), null);
  });
});

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
