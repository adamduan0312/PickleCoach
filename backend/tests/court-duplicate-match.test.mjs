/**
 * Court duplicate matching (pure, no DB).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeCourtText,
  stringSimilarity,
  classifyCourtDuplicate,
  rankCourtDuplicateCandidates,
  filterCourtsForDuplicateCheck,
  isCourtVisibleInDuplicateCheck,
} from '../utils/courtDuplicateMatch.js';

describe('courtDuplicateMatch', () => {
  it('normalizes street abbreviations and noise words', () => {
    assert.equal(normalizeCourtText('Holiday Park Pickleball Courts'), 'holiday park');
    assert.match(normalizeCourtText('1150 G. Harold Martin Drive'), /harold martin dr/);
  });

  it('scores similar names highly', () => {
    assert.ok(stringSimilarity('Holiday Park', 'Holiday Pak') > 0.7);
    assert.ok(stringSimilarity('Holiday Park', 'Weston Regional') < 0.4);
  });

  it('flags high-confidence when close + similar name', () => {
    const proposed = {
      name: 'Holiday Park',
      address_line1: '1150 G Harold Martin Dr',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      latitude: 26.13303,
      longitude: -80.13231,
    };
    const existing = {
      id: 1,
      name: 'Holiday Park',
      address_line1: '1150 G. Harold Martin Dr',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      latitude: 26.1331,
      longitude: -80.1324,
    };
    assert.equal(classifyCourtDuplicate(proposed, existing), 'high');
  });

  it('flags possible when same pin different name', () => {
    const proposed = {
      name: 'Abiaca Community Courts',
      address_line1: '3001 W Abiaca Cir',
      city: 'Davie',
      state: 'FL',
      postal_code: '33328',
      latitude: 26.08565,
      longitude: -80.28074,
    };
    const existing = {
      id: 2,
      name: 'Tree Tops Park',
      address_line1: '3900 SW 100th Ave',
      city: 'Davie',
      state: 'FL',
      postal_code: '33328',
      latitude: 26.0857,
      longitude: -80.2808,
    };
    assert.equal(classifyCourtDuplicate(proposed, existing), 'possible');
  });

  it('ranks into high and possible buckets', () => {
    const proposed = {
      name: 'Holiday Park',
      address_line1: '1150 G Harold Martin Dr',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      latitude: 26.13303,
      longitude: -80.13231,
    };
    const ranked = rankCourtDuplicateCandidates(proposed, [
      {
        id: 1,
        name: 'Holiday Pak',
        address_line1: '1150 G Harold Martin Dr',
        city: 'Fort Lauderdale',
        state: 'FL',
        postal_code: '33304',
        latitude: 26.1331,
        longitude: -80.1324,
      },
      {
        id: 99,
        name: 'Far Away Courts',
        address_line1: '1 Main St',
        city: 'Miami',
        state: 'FL',
        postal_code: '33101',
        latitude: 25.76,
        longitude: -80.19,
      },
    ]);
    assert.ok(ranked.high_confidence.length + ranked.possible.length >= 1);
    assert.ok(!ranked.high_confidence.find((c) => c.id === 99));
    assert.ok(!ranked.possible.find((c) => c.id === 99));
  });
});

describe('private court visibility in duplicate check', () => {
  const privateCourt = {
    id: 9,
    name: 'Secret',
    address_line1: '1 Hidden Rd',
    is_private: true,
    created_by_user_id: 10,
    latitude: 26.2,
    longitude: -80.2,
  };
  const publicCourt = {
    id: 1,
    name: 'Public',
    address_line1: '2 Main St',
    is_private: false,
    created_by_user_id: 99,
  };

  it('public courts always visible; private hidden from non-owners', () => {
    assert.equal(
      isCourtVisibleInDuplicateCheck(publicCourt, { viewerUserId: 3, ownedCourtIds: new Set() }),
      true,
    );
    assert.equal(
      isCourtVisibleInDuplicateCheck(privateCourt, { viewerUserId: 3, ownedCourtIds: new Set() }),
      false,
    );
  });

  it('private courts visible to creator, linked coach, or admin', () => {
    assert.equal(
      isCourtVisibleInDuplicateCheck(privateCourt, { viewerUserId: 10, ownedCourtIds: new Set() }),
      true,
    );
    assert.equal(
      isCourtVisibleInDuplicateCheck(privateCourt, {
        viewerUserId: 3,
        ownedCourtIds: new Set([9]),
      }),
      true,
    );
    assert.equal(
      isCourtVisibleInDuplicateCheck(privateCourt, { viewerIsAdmin: true, viewerUserId: 1 }),
      true,
    );
  });

  it('filterCourtsForDuplicateCheck drops non-owned private', () => {
    const out = filterCourtsForDuplicateCheck([publicCourt, privateCourt], {
      viewerUserId: 3,
      ownedCourtIds: new Set(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 1);
  });
});
