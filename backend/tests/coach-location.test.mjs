/**
 * Coach "Based in" location: real place, normalized to city level, independent of courts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { LOCATION_NOT_FOUND_MESSAGE, resolveCoachLocation } from '../utils/coachLocation.js';
import {
  cityLevelLabelFromHit,
  citySuggestionFromPhotonFeature,
  isPlaceHit,
  mapPhotonCitySuggestions,
  placeSuggestionKind,
} from '../services/geocodeService.js';
import { placeSuggestQuerySchema } from '../config/validation.js';

const photon = (properties) => ({ type: 'Feature', properties });

describe('"Based in" suggestions (Photon mapping)', () => {
  it('classifies queries; no lookup for 1 char or partial ZIP', () => {
    assert.equal(placeSuggestionKind('D'), null);
    assert.equal(placeSuggestionKind('3331'), null);
    assert.equal(placeSuggestionKind('33314'), 'zip');
    assert.equal(placeSuggestionKind('Dav'), 'city');
    assert.equal(placeSuggestionKind('3001 W Abiaca Cir'), 'address');
  });

  it('maps US cities to "City, ST" with a detail line', () => {
    assert.deepEqual(
      citySuggestionFromPhotonFeature(photon({
        countrycode: 'US', osm_key: 'place', osm_value: 'suburb', type: 'city',
        name: 'Davie', county: 'Broward County', state: 'Florida',
      }), 'city'),
      { label: 'Davie, FL', detail: 'Davie, Broward County, Florida, United States' },
    );
  });

  it('ZIP and street results collapse to their city (never street or ZIP labels)', () => {
    assert.equal(citySuggestionFromPhotonFeature(photon({
      countrycode: 'US', osm_key: 'place', osm_value: 'postcode', type: 'other', name: '33314', city: 'Davie', state: 'Florida',
    }), 'zip').label, 'Davie, FL');
    const street = citySuggestionFromPhotonFeature(photon({
      countrycode: 'US', osm_key: 'building', osm_value: 'house', type: 'house',
      name: '3001', street: 'West Abiaca Circle', housenumber: '3001', city: 'Davie', state: 'Florida', postcode: '33328',
    }), 'address');
    assert.equal(street.label, 'Davie, FL');
    assert.doesNotMatch(street.detail, /Abiaca|3001|33328/);
  });

  it('drops non-US, stateless, and non-place results; dedupes and limits', () => {
    const list = mapPhotonCitySuggestions({
      features: [
        photon({ countrycode: 'CH', osm_key: 'place', type: 'city', name: 'Davos', state: 'Grisons' }),
        photon({ countrycode: 'US', osm_key: 'place', type: 'city', name: 'Davis', state: 'California' }),
        photon({ countrycode: 'US', osm_key: 'place', type: 'city', name: 'Davis', state: 'California' }),
        photon({ countrycode: 'US', osm_key: 'shop', type: 'house', name: 'Davis Books', state: 'Texas' }),
        photon({ countrycode: 'US', osm_key: 'place', type: 'city', name: 'Davie', state: 'Florida' }),
        photon({ countrycode: 'US', osm_key: 'place', type: 'city', name: 'Davenport', state: 'Iowa' }),
      ],
    }, 'city', 2);
    assert.deepEqual(list.map((s) => s.label), ['Davis, CA', 'Davie, FL']);
  });

  it('query schema requires 2–200 chars', () => {
    assert.ok(placeSuggestQuerySchema.validate({ q: 'D' }).error);
    assert.equal(placeSuggestQuerySchema.validate({ q: 'Dav' }).value.limit, 6);
  });

  it('route is coach/admin only and never exposes coordinates', () => {
    const routes = readFileSync(new URL('../routes/geoRoutes.js', import.meta.url), 'utf8');
    assert.match(routes, /'\/places',\s*authenticate,\s*authorize\('coach', 'admin'\),\s*validateQuery\(placeSuggestQuerySchema\)/);
    const svc = readFileSync(new URL('../services/geocodeService.js', import.meta.url), 'utf8');
    const fn = svc.slice(svc.indexOf('export function citySuggestionFromPhotonFeature'), svc.indexOf('export function mapPhotonCitySuggestions'));
    assert.doesNotMatch(fn, /coordinates|lat|lng|lon/);
  });
});

function fakeResolver(map) {
  const calls = [];
  const resolvePlace = async (q) => {
    calls.push(q);
    return map[q] ?? null;
  };
  return { resolvePlace, calls };
}

describe('cityLevelLabelFromHit', () => {
  it('uses settlement + 2-letter state, never street or ZIP', () => {
    assert.equal(cityLevelLabelFromHit({
      address: { house_number: '3001', road: 'W Abiaca Cir', suburb: 'Davie', county: 'Broward County', state: 'Florida', postcode: '33328' },
    }), 'Davie, FL');
    assert.equal(cityLevelLabelFromHit({ type: 'postcode', address: { postcode: '33314', suburb: 'Davie', state: 'Florida' } }), 'Davie, FL');
    assert.equal(cityLevelLabelFromHit({ address: { city: 'Fort Lauderdale', state: 'Florida' } }), 'Fort Lauderdale, FL');
  });
  it('falls back to county, and rejects non-US / stateless hits', () => {
    assert.equal(cityLevelLabelFromHit({ address: { county: 'Broward County', state: 'Florida' } }), 'Broward County, FL');
    assert.equal(cityLevelLabelFromHit({ address: { city: 'Toronto', state: 'Ontario' } }), null);
    assert.equal(cityLevelLabelFromHit({ address: { city: 'Nowhere' } }), null);
    assert.equal(cityLevelLabelFromHit(null), null);
  });
});

describe('isPlaceHit', () => {
  it('accepts cities, ZIPs and admin areas; rejects businesses/landmarks sharing a name', () => {
    assert.ok(isPlaceHit({ class: 'place', type: 'town' }, 'free'));
    assert.ok(isPlaceHit({ class: 'place', type: 'postcode' }, 'zip'));
    assert.ok(isPlaceHit({ class: 'boundary', type: 'administrative' }, 'city_state'));
    assert.ok(!isPlaceHit({ class: 'shop', type: 'books' }, 'free'));
    assert.ok(!isPlaceHit({ class: 'tourism', type: 'attraction' }, 'free'));
    assert.ok(!isPlaceHit({ class: 'highway', type: 'residential' }, 'free'));
  });
  it('street hits count only when the input is an address', () => {
    assert.ok(isPlaceHit({ class: 'highway', type: 'residential' }, 'address'));
    assert.ok(isPlaceHit({ class: 'building', type: 'house' }, 'address'));
    assert.ok(!isPlaceHit({ class: 'amenity', type: 'restaurant' }, 'address'));
  });
});

describe('resolveCoachLocation', () => {
  it('normalizes a real place', async () => {
    const { resolvePlace } = fakeResolver({ 'davie fl': 'Davie, FL' });
    assert.deepEqual(await resolveCoachLocation({ location: '  davie   fl ' }, null, { resolvePlace }), { ok: true, location: 'Davie, FL', changed: true });
  });
  it('rejects places that do not exist', async () => {
    const { resolvePlace } = fakeResolver({});
    assert.deepEqual(await resolveCoachLocation({ location: 'Hogwarts' }, null, { resolvePlace }), {
      ok: false,
      field: 'location',
      message: LOCATION_NOT_FOUND_MESSAGE,
    });
  });
  it('does not geocode when location is omitted or unchanged', async () => {
    const { resolvePlace, calls } = fakeResolver({});
    const existing = { location: 'Miami, FL' };
    assert.deepEqual(await resolveCoachLocation({ headline: 'x' }, existing, { resolvePlace }), { ok: true, location: 'Miami, FL', changed: false });
    assert.deepEqual(await resolveCoachLocation({ location: 'Miami, FL' }, existing, { resolvePlace }), { ok: true, location: 'Miami, FL', changed: false });
    assert.equal(calls.length, 0);
  });
  it('clearing the location stores null', async () => {
    const { resolvePlace, calls } = fakeResolver({});
    assert.deepEqual(await resolveCoachLocation({ location: '   ' }, { location: 'Miami, FL' }, { resolvePlace }), { ok: true, location: null, changed: true });
    assert.equal(calls.length, 0);
  });
  it('propagates geocoder outages (caller returns 503)', async () => {
    const err = Object.assign(new Error('Location search is temporarily unavailable. Try again in a moment.'), { code: 'GEOCODE_UNAVAILABLE', status: 503 });
    await assert.rejects(resolveCoachLocation({ location: 'Davie, FL' }, null, { resolvePlace: async () => { throw err; } }), /temporarily unavailable/);
  });
  it('stays independent of teaching courts (no court lookup, no Discover use)', () => {
    const util = readFileSync(new URL('../utils/coachLocation.js', import.meta.url), 'utf8');
    assert.doesNotMatch(util, /CourtLocation|coachCourts|distanceMiles|from '\.\.\/models/);
    const controller = readFileSync(new URL('../controllers/coachController.js', import.meta.url), 'utf8');
    const listSection = controller.slice(controller.indexOf('export const getCoaches'), controller.indexOf('export const getCoachById'));
    assert.doesNotMatch(listSection, /coachProfile\.location|resolveCoachLocation/);
    assert.match(controller, /if \(isGeocodeOutage\(error\)\) return errorResponse\(res, error\.message, error\.status \|\| 503\);/);
  });
});
