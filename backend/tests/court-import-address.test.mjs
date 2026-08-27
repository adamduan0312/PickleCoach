/**
 * OSM import address construction + reverse-geocode enrichment (no live network).
 * Hard invariant: incomplete/placeholder addresses never invent Unknown/XX/00000.
 * Reverse hits must be geographically close to the OSM court coordinates.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  structuredAddressFromOsmTags,
  isHumanReadableCourtAddress,
  mergeCourtAddress,
  resolveImportAddress,
  enrichmentPatchForExisting,
  isReverseGeocodePlausible,
  REVERSE_GEOCODE_MAX_DISTANCE_MILES,
} from '../services/courtImportService.js';
import {
  structuredAddressFromNominatimHit,
  normalizeUsStateCode,
} from '../services/geocodeService.js';

describe('OSM address construction', () => {
  it('builds a complete address when OSM addr:* tags are present', () => {
    const addr = structuredAddressFromOsmTags({
      'addr:housenumber': '1150',
      'addr:street': 'G. Harold Martin Dr',
      'addr:city': 'Fort Lauderdale',
      'addr:state': 'FL',
      'addr:postcode': '33304',
    });
    assert.equal(addr.address_line1, '1150 G. Harold Martin Dr');
    assert.equal(addr.city, 'Fort Lauderdale');
    assert.equal(addr.state, 'FL');
    assert.equal(addr.postal_code, '33304');
    assert.equal(isHumanReadableCourtAddress(addr), true);
  });

  it('does not invent OSM way/… as a street when tags are missing', () => {
    const addr = structuredAddressFromOsmTags({}, { type: 'way', id: 12345 });
    assert.equal(addr.address_line1, null);
    assert.equal(addr.city, null);
    assert.equal(isHumanReadableCourtAddress(addr), false);
  });
});

describe('reverse geocode geographic plausibility', () => {
  it('accepts a nearby reverse pin (park-entrance scale)', () => {
    assert.equal(
      isReverseGeocodePlausible(26.133, -80.132, {
        latitude: 26.131,
        longitude: -80.132,
      }),
      true,
    );
    assert.ok(REVERSE_GEOCODE_MAX_DISTANCE_MILES >= 0.5);
  });

  it('rejects a materially distant reverse pin', () => {
    assert.equal(
      isReverseGeocodePlausible(26.133, -80.132, {
        latitude: 26.25,
        longitude: -80.132,
      }),
      false,
    );
  });

  it('rejects reverse results missing coordinates', () => {
    assert.equal(
      isReverseGeocodePlausible(26.133, -80.132, {
        address_line1: '100 Test Rd',
        city: 'Fort Lauderdale',
        state: 'FL',
        postal_code: '33304',
      }),
      false,
    );
  });
});

describe('reverse geocode merge', () => {
  it('fills gaps from Nominatim reverse without overwriting OSM street', async () => {
    const resolved = await resolveImportAddress({
      tags: {
        'addr:housenumber': '1150',
        'addr:street': 'G. Harold Martin Dr',
      },
      element: { type: 'way', id: 1 },
      latitude: 26.133,
      longitude: -80.132,
      reverseBudget: 1,
      reverseGeocodeFn: async () => ({
        address_line1: 'Something Else',
        city: 'Fort Lauderdale',
        state: 'FL',
        postal_code: '33304',
        country: 'US',
        label: 'Fort Lauderdale, FL',
        latitude: 26.1325,
        longitude: -80.1322,
      }),
    });
    assert.equal(resolved.usedReverse, true);
    assert.equal(resolved.complete, true);
    assert.equal(resolved.reverseRejectedDistant, false);
    assert.equal(resolved.address.address_line1, '1150 G. Harold Martin Dr');
    assert.equal(resolved.address.city, 'Fort Lauderdale');
    assert.equal(resolved.address.state, 'FL');
    assert.equal(resolved.address.postal_code, '33304');
    assert.equal(isHumanReadableCourtAddress(resolved.address), true);
  });

  it('uses a nearby reverse geocode when OSM has only coordinates', async () => {
    const resolved = await resolveImportAddress({
      tags: {},
      element: { type: 'way', id: 99 },
      latitude: 26.133,
      longitude: -80.132,
      reverseBudget: 1,
      reverseGeocodeFn: async () => ({
        address_line1: '1150 G Harold Martin Dr',
        city: 'Fort Lauderdale',
        state: 'FL',
        postal_code: '33304',
        country: 'US',
        label: 'x',
        latitude: 26.1331,
        longitude: -80.1321,
      }),
    });
    assert.equal(resolved.usedReverse, true);
    assert.equal(resolved.complete, true);
    assert.equal(resolved.reverseRejectedDistant, false);
    assert.equal(resolved.address.address_line1, '1150 G Harold Martin Dr');
    assert.equal(resolved.address.city, 'Fort Lauderdale');
  });

  it('does not trust a distant reverse geocode (treats as incomplete)', async () => {
    const resolved = await resolveImportAddress({
      tags: {},
      element: { type: 'way', id: 88 },
      latitude: 26.133,
      longitude: -80.132,
      reverseBudget: 1,
      reverseGeocodeFn: async () => ({
        address_line1: '1 Far Away Blvd',
        city: 'Miami',
        state: 'FL',
        postal_code: '33101',
        country: 'US',
        label: 'Miami',
        latitude: 25.7617,
        longitude: -80.1918,
      }),
    });
    assert.equal(resolved.usedReverse, false);
    assert.equal(resolved.reverseRejectedDistant, true);
    assert.equal(resolved.complete, false);
    assert.equal(resolved.address.address_line1, null);
    assert.equal(resolved.address.city, null);
  });

  it('skips reverse when budget is exhausted and leaves fields null (no placeholders)', async () => {
    let called = 0;
    const resolved = await resolveImportAddress({
      tags: {},
      element: { type: 'node', id: 2 },
      latitude: 1,
      longitude: 2,
      reverseBudget: 0,
      reverseGeocodeFn: async () => {
        called += 1;
        return null;
      },
    });
    assert.equal(called, 0);
    assert.equal(resolved.usedReverse, false);
    assert.equal(resolved.complete, false);
    assert.equal(resolved.address.address_line1, null);
    assert.equal(resolved.address.city, null);
    assert.equal(resolved.address.state, null);
    assert.equal(resolved.address.postal_code, null);
    assert.equal(isHumanReadableCourtAddress(resolved.address), false);
  });

  it('marks incomplete when reverse returns partial data', async () => {
    const resolved = await resolveImportAddress({
      tags: {},
      element: { type: 'way', id: 3 },
      latitude: 26.1,
      longitude: -80.1,
      reverseBudget: 1,
      reverseGeocodeFn: async () => ({
        address_line1: null,
        city: 'Fort Lauderdale',
        state: 'FL',
        postal_code: null,
        country: 'US',
        label: 'Fort Lauderdale, FL',
        latitude: 26.1,
        longitude: -80.1,
      }),
    });
    assert.equal(resolved.complete, false);
    assert.equal(isHumanReadableCourtAddress(resolved.address), false);
  });
});

describe('enrichmentPatchForExisting', () => {
  it('fills only placeholder fields without overwriting valid ones', () => {
    const patch = enrichmentPatchForExisting(
      {
        address_line1: 'Address pending verification',
        city: 'Unknown',
        state: 'XX',
        postal_code: '00000',
      },
      {
        address_line1: '1150 G. Harold Martin Dr',
        city: 'Fort Lauderdale',
        state: 'FL',
        postal_code: '33304',
      },
    );
    assert.deepEqual(patch, {
      address_line1: '1150 G. Harold Martin Dr',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
    });
  });

  it('keeps a valid street when only city/state/zip were placeholders', () => {
    const patch = enrichmentPatchForExisting(
      {
        address_line1: '100 Park Ave',
        city: 'Unknown',
        state: 'XX',
        postal_code: '00000',
      },
      {
        address_line1: 'Should Not Overwrite',
        city: 'Davie',
        state: 'FL',
        postal_code: '33328',
      },
    );
    assert.equal(patch.address_line1, undefined);
    assert.equal(patch.city, 'Davie');
    assert.equal(patch.state, 'FL');
    assert.equal(patch.postal_code, '33328');
  });
});

describe('Nominatim structured helpers', () => {
  it('normalizes full state names to codes', () => {
    assert.equal(normalizeUsStateCode('Florida'), 'FL');
    assert.equal(normalizeUsStateCode('fl'), 'FL');
  });

  it('maps reverse hit to structured fields', () => {
    const structured = structuredAddressFromNominatimHit({
      address: {
        house_number: '1150',
        road: 'G. Harold Martin Drive',
        city: 'Fort Lauderdale',
        state: 'Florida',
        postcode: '33304',
      },
    });
    assert.equal(structured.address_line1, '1150 G. Harold Martin Drive');
    assert.equal(structured.city, 'Fort Lauderdale');
    assert.equal(structured.state, 'FL');
    assert.equal(structured.postal_code, '33304');
  });

  it('mergeCourtAddress prefers OSM fields', () => {
    const merged = mergeCourtAddress(
      { address_line1: 'OSM St', city: null, state: 'FL', postal_code: null },
      { address_line1: 'Rev St', city: 'Davie', state: 'XX', postal_code: '33328' },
    );
    assert.equal(merged.address_line1, 'OSM St');
    assert.equal(merged.city, 'Davie');
    assert.equal(merged.state, 'FL');
    assert.equal(merged.postal_code, '33328');
  });
});
