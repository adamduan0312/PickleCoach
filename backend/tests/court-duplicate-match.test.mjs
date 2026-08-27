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
