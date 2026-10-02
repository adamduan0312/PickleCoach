/**
 * Geocode service mapping / ranking / query parsing (no network).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatGeocodeLabel,
  mapNominatimResults,
  parseGeocodeQuery,
  settlementName,
  isCountyOnlyHit,
  normalizeGeocodeQuery,
  addressStreetZipFallback,
} from '../services/geocodeService.js';

describe('geocodeService Nominatim mapping', () => {
  it('formats city + state + zip labels', () => {
    const label = formatGeocodeLabel({
      display_name: 'Mission District, San Francisco, California, 94114, United States',
      address: {
        neighbourhood: 'Mission District',
        city: 'San Francisco',
        state: 'California',
        postcode: '94114',
        country: 'United States',
      },
    });
    assert.match(label, /San Francisco/);
    assert.match(label, /California|94114/);
  });

  it('labels FL towns tagged as suburb (not county)', () => {
    const label = formatGeocodeLabel({
      type: 'administrative',
      class: 'boundary',
      display_name: 'Weston, Broward County, Florida, United States',
      address: {
        suburb: 'Weston',
        county: 'Broward County',
        state: 'Florida',
        country: 'United States',
      },
    });
    assert.match(label, /Weston/);
    assert.match(label, /Florida/);
    assert.doesNotMatch(label, /^Broward County/);
  });

  it('formats ZIP centroids with locality', () => {
    const label = formatGeocodeLabel({
      type: 'postcode',
      class: 'place',
      address: {
        postcode: '33314',
        suburb: 'Davie',
        county: 'Broward County',
        state: 'Florida',
      },
    });
    assert.equal(label, '33314, Davie, Florida');
  });

  it('maps valid hits and skips bad coords', () => {
    const results = mapNominatimResults([
      {
        lat: '37.7749',
        lon: '-122.4194',
        display_name: 'San Francisco, California, United States',
        address: { city: 'San Francisco', state: 'California' },
      },
      { lat: 'nope', lon: '-122.4', display_name: 'Bad' },
      null,
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].lat, 37.7749);
    assert.equal(results[0].lng, -122.4194);
    assert.ok(results[0].label.includes('San Francisco'));
  });

  it('ranks city/suburb hits above same-named counties', () => {
    const results = mapNominatimResults([
      {
        lat: '35.9',
        lon: '-80.5',
        importance: 0.55,
        type: 'administrative',
        class: 'boundary',
        display_name: 'Davie County, North Carolina, United States',
        address: { county: 'Davie County', state: 'North Carolina' },
      },
      {
        lat: '26.07',
        lon: '-80.25',
        importance: 0.51,
        type: 'administrative',
        class: 'boundary',
        display_name: 'Davie, Broward County, Florida, United States',
        address: { suburb: 'Davie', county: 'Broward County', state: 'Florida' },
      },
    ]);
    assert.equal(results[0].label.includes('Davie') && results[0].label.includes('Florida'), true);
    assert.ok(results[0].label.includes('Davie'));
    assert.ok(!isCountyOnlyHit({
      type: 'administrative',
      address: { suburb: 'Davie', county: 'Broward County', state: 'Florida' },
    }));
    assert.ok(isCountyOnlyHit({
      type: 'administrative',
      address: { county: 'Davie County', state: 'North Carolina' },
    }));
    assert.equal(settlementName({ suburb: 'Weston', county: 'Broward County' }), 'Weston');
  });
});

describe('parseGeocodeQuery', () => {
  it('detects ZIP and ZIP+4', () => {
    assert.equal(parseGeocodeQuery('33314').kind, 'zip');
    assert.equal(parseGeocodeQuery('33314').params.postalcode, '33314');
    assert.equal(parseGeocodeQuery('33314-1234').params.postalcode, '33314');
  });

  it('detects city + state', () => {
    const a = parseGeocodeQuery('Davie, FL');
    assert.equal(a.kind, 'city_state');
    assert.equal(a.params.city, 'Davie');
    assert.match(a.params.state, /florida/i);

    const b = parseGeocodeQuery('weston florida');
    assert.equal(b.kind, 'city_state');
    assert.equal(b.params.city.toLowerCase(), 'weston');
  });

  it('keeps street addresses as free-form address search', () => {
    const a = parseGeocodeQuery('123 Main St, Davie, FL');
    assert.equal(a.kind, 'address');
    assert.equal(a.params.q, '123 Main St, Davie, FL');
    assert.equal(a.params.featureType, undefined);

    const b = parseGeocodeQuery('334 Furman Street Brooklyn NY');
    assert.equal(b.kind, 'address');
  });
});

describe('normalizeGeocodeQuery', () => {
  it('strips a leading Plus Code and repeated city/state/ZIP parts', () => {
    assert.equal(
      normalizeGeocodeQuery('3PGM+5JF, 3801 S Pine Island Rd, Davie, FL 33328, Davie, FL, 33328'),
      '3801 S Pine Island Rd, Davie, FL 33328',
    );
  });

  it('strips full and space-separated Plus Codes', () => {
    assert.equal(normalizeGeocodeQuery('76RX3PGM+5JF Davie, FL'), 'Davie, FL');
    assert.equal(normalizeGeocodeQuery('3PGM+5JF 3801 S Pine Island Rd, 33328'), '3801 S Pine Island Rd, 33328');
  });

  it('keeps a city that shares a word with the street', () => {
    assert.equal(normalizeGeocodeQuery('100 Davie Rd, Davie, FL'), '100 Davie Rd, Davie, FL');
  });

  it('leaves ordinary queries alone', () => {
    assert.equal(normalizeGeocodeQuery('33328'), '33328');
    assert.equal(normalizeGeocodeQuery('  Davie,   FL '), 'Davie, FL');
    assert.equal(normalizeGeocodeQuery('Holiday Park'), 'Holiday Park');
  });
});

describe('addressStreetZipFallback', () => {
  it('reduces a full address to street + ZIP', () => {
    assert.equal(
      addressStreetZipFallback('3801 S Pine Island Rd, Davie, FL 33328'),
      '3801 S Pine Island Rd, 33328',
    );
  });

  it('returns null without a house number, without a ZIP, or when unchanged', () => {
    assert.equal(addressStreetZipFallback('S Pine Island Rd, Davie, FL 33328'), null);
    assert.equal(addressStreetZipFallback('3801 S Pine Island Rd, Davie, FL'), null);
    assert.equal(addressStreetZipFallback('3801 S Pine Island Rd, 33328'), null);
  });
});
