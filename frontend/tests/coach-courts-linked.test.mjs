import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyCourtSearch,
  cleanLocationQuery,
  isCourtAlreadyLinked,
  isCourtDiscoveryPending,
  linkedCourtIdSet,
  placeFromDirectoryMatches,
  recognizedPlaceFromGeocode,
  splitPastedCourtAddress,
} from '../src/utils/coachCourts.js';

describe('classifyCourtSearch', () => {
  it('treats ZIPs, city + state, and street addresses as locations', () => {
    for (const q of [
      '33328',
      '33328-1234',
      'Davie, FL',
      'Davie FL',
      'fort lauderdale, fl',
      'Davie, FL 33328',
      '3801 S Pine Island Rd',
      '3801 S Pine Island Rd, Davie, FL 33328',
      '3PGM+5JF, 3801 S Pine Island Rd, Davie, FL 33328',
      '100 Main, Weston',
    ]) {
      assert.equal(classifyCourtSearch(q), 'location', q);
    }
  });

  it('treats court names (even with a state) as court searches', () => {
    for (const q of [
      'Tropical Park',
      'Holiday Park',
      'Holiday Park FL',
      'Bamford Pickleball Courts, FL',
      'Weston Regional Pickleball Court',
      'Pine Island Park Courts',
      '10 Pin Park',
      'Court #3',
      '',
      '   ',
    ]) {
      assert.equal(classifyCourtSearch(q), 'court', q);
    }
  });

  it('leaves bare names (possible city or court) to the place check', () => {
    for (const q of ['Austin', 'Davie', 'Weston', 'fort lauderdale', 'Pine Island', 'Tropical']) {
      assert.equal(classifyCourtSearch(q), 'place_or_court', q);
    }
    assert.equal(classifyCourtSearch('One Two Three Four'), 'court');
  });
});

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

describe('recognizedPlaceFromGeocode', () => {
  it('accepts a geocoded city/town whose name is what was typed', () => {
    const austin = { lat: 30.27, lng: -97.74, place: 'Austin, TX' };
    assert.equal(recognizedPlaceFromGeocode(' austin ', [austin]), austin);
    const davie = { lat: 26.07, lng: -80.25, place: 'Davie, FL' };
    assert.equal(recognizedPlaceFromGeocode('Davie', [{ lat: 35.9, lng: -80.5, place: null }, davie]), davie);
  });

  it('rejects non-places and places named differently', () => {
    assert.equal(recognizedPlaceFromGeocode('Tropical', [{ lat: 26, lng: -98, place: 'Alton, TX' }]), null);
    assert.equal(recognizedPlaceFromGeocode('Weston Regional', [{ lat: 26, lng: -80, place: null }]), null);
    assert.equal(recognizedPlaceFromGeocode('Austin', []), null);
    assert.equal(recognizedPlaceFromGeocode('Austin', undefined), null);
  });
});

describe('placeFromDirectoryMatches', () => {
  const courts = [
    { name: 'Weston Regional Park', city: 'Weston', state: 'FL' },
    { name: 'Vista Park', city: 'Weston', state: 'FL' },
    { name: 'Weston Commons', city: 'Weston', state: 'MA' },
    { name: 'Pine Island Park Courts', city: 'Davie', state: 'FL' },
  ];

  it('recognizes a city listed on directory courts and picks its most common state', () => {
    assert.deepEqual(placeFromDirectoryMatches('weston', courts), { city: 'Weston', state: 'FL' });
    assert.deepEqual(placeFromDirectoryMatches(' Davie ', courts), { city: 'Davie', state: 'FL' });
  });

  it('does not treat a court-name match as a place', () => {
    assert.equal(placeFromDirectoryMatches('Pine Island', courts), null);
    assert.equal(placeFromDirectoryMatches('Tropical', courts), null);
    assert.equal(placeFromDirectoryMatches('Weston', []), null);
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
