/**
 * Geographic nearby OSM discovery (discoverCourtsNearby) — mocked Overpass, no live network.
 * Hard invariant: incomplete addresses are never inserted into court_locations.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { CourtLocation, OsmCourtImportAttempt } from '../models/index.js';
import {
  shouldSkipOsmCandidate,
  importFromOpenStreetMap,
  discoverCourtsNearby,
  dbOsmImportAttemptStore,
  DISCOVER_MAX_IMPORTS,
  OSM_IMPORT_RETRY_AFTER_DAYS,
  buildPickleballOverpassQuery,
  buildOsmFeaturesFacilityQuery,
  groupCourtsWithFacilities,
  osmCourtName,
  isPlaceholderOsmCourtName,
} from '../services/courtImportService.js';
import { searchCourts } from '../controllers/courtController.js';
import { courtDiscovery } from '../services/courtDiscoveryScheduler.js';

const origFindAll = CourtLocation.findAll;
const origFindOne = CourtLocation.findOne;
const origCreate = CourtLocation.create;
const origAttemptFindAll = OsmCourtImportAttempt.findAll;
const origAttemptUpsert = OsmCourtImportAttempt.upsert;
const origSchedule = courtDiscovery.schedule;

beforeEach(() => {
  OsmCourtImportAttempt.findAll = async () => [];
  OsmCourtImportAttempt.upsert = async () => {};
});

afterEach(() => {
  CourtLocation.findAll = origFindAll;
  CourtLocation.findOne = origFindOne;
  CourtLocation.create = origCreate;
  OsmCourtImportAttempt.findAll = origAttemptFindAll;
  OsmCourtImportAttempt.upsert = origAttemptUpsert;
  courtDiscovery.schedule = origSchedule;
  mock.restoreAll();
});

function memoryAttemptStore(failedKeys = []) {
  const failed = new Set(failedKeys);
  const recorded = [];
  return {
    recorded,
    async recentlyFailedKeys() { return failed; },
    async recordFailure(candidate, outcome) {
      recorded.push({ key: `${candidate.osmType}/${candidate.osmId}`, outcome });
    },
  };
}

const COMPLETE_ADDR = {
  'addr:housenumber': '100',
  'addr:street': 'Test Road',
  'addr:city': 'Fort Lauderdale',
  'addr:state': 'FL',
  'addr:postcode': '33304',
};

function osmEl({ type = 'way', id, lat, lon, name, tags = {} }) {
  return {
    type,
    id,
    center: { lat, lon },
    tags: {
      sport: 'pickleball',
      ...(name ? { name } : {}),
      ...tags,
    },
  };
}

/** OSM element with complete addr:* tags (no reverse geocode needed). */
function osmElComplete(opts) {
  return osmEl({ ...opts, tags: { ...COMPLETE_ADDR, ...(opts.tags || {}) } });
}

const goodReverse = async (lat, lng) => ({
  address_line1: '100 Test Road',
  city: 'Fort Lauderdale',
  state: 'FL',
  postal_code: '33304',
  country: 'US',
  label: '100 Test Road, Fort Lauderdale, FL',
  latitude: Number(lat),
  longitude: Number(lng),
});

const distantReverse = async () => ({
  address_line1: '1 Far Away Blvd',
  city: 'Miami',
  state: 'FL',
  postal_code: '33101',
  country: 'US',
  label: 'Miami, FL',
  latitude: 25.7617,
  longitude: -80.1918,
});

describe('shouldSkipOsmCandidate', () => {
  it('skips when osm_type+osm_id already exists', async () => {
    CourtLocation.findOne = async () => ({ id: 1, osm_type: 'way', osm_id: 111 });
    CourtLocation.findAll = async () => [];
    const skip = await shouldSkipOsmCandidate({
      name: 'A',
      latitude: 26.13,
      longitude: -80.13,
      osmType: 'way',
      osmId: 111,
    });
    assert.equal(skip, true);
  });

  it('does not collapse two different OSM ids that are physically close', async () => {
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [
      {
        id: 1,
        name: 'Court A',
        osm_type: 'way',
        osm_id: 111,
        latitude: 26.13001,
        longitude: -80.13001,
      },
    ];
    const skip = await shouldSkipOsmCandidate({
      name: 'Court B',
      latitude: 26.13002,
      longitude: -80.13002,
      osmType: 'way',
      osmId: 222,
    });
    assert.equal(skip, false);
  });

  it('still proximity-skips against a nearby manual court (no osm id)', async () => {
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [
      {
        id: 9,
        name: 'Holiday Park',
        osm_type: null,
        osm_id: null,
        latitude: 26.1331,
        longitude: -80.1324,
      },
    ];
    const skip = await shouldSkipOsmCandidate({
      name: 'Holiday Park Pitch',
      latitude: 26.13315,
      longitude: -80.13245,
      osmType: 'way',
      osmId: 999,
    });
    assert.equal(skip, true);
  });
});

describe('importFromOpenStreetMap / discoverCourtsNearby', () => {
  it('imports when OSM has a complete address', async () => {
    const created = [];
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (row) => {
      const court = { id: created.length + 1, ...row };
      created.push(court);
      return court;
    };

    const result = await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 0,
      fetchOverpassFn: async () => ({
        elements: [osmElComplete({ id: 1, lat: 26.13, lon: -80.13, name: 'Holiday Park' })],
      }),
    });
    assert.equal(result.imported.length, 1);
    assert.equal(result.skippedIncomplete, 0);
    assert.equal(created[0].address_line1, '100 Test Road');
    assert.equal(created[0].city, 'Fort Lauderdale');
    assert.equal(created[0].state, 'FL');
    assert.equal(created[0].postal_code, '33304');
  });

  it('imports when incomplete OSM address + successful nearby reverse geocode', async () => {
    const created = [];
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (row) => {
      const court = { id: created.length + 1, ...row };
      created.push(court);
      return court;
    };

    const result = await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 1,
      reverseGeocodeFn: goodReverse,
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 2, lat: 26.13, lon: -80.13, name: 'Bare OSM' })],
      }),
    });
    assert.equal(result.imported.length, 1);
    assert.equal(result.skippedIncomplete, 0);
    assert.equal(created[0].address_line1, '100 Test Road');
    assert.equal(created[0].postal_code, '33304');
  });

  it('does not import when reverse geocode pin is materially distant from OSM coords', async () => {
    const created = [];
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (row) => {
      created.push(row);
      return { id: 1, ...row };
    };

    const result = await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 1,
      reverseGeocodeFn: distantReverse,
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 7, lat: 26.13, lon: -80.13, name: 'Mismatch' })],
      }),
    });
    assert.equal(result.imported.length, 0);
    assert.equal(result.skippedIncomplete, 1);
    assert.equal(created.length, 0);
  });

  it('does not import when incomplete OSM address + failed/incomplete reverse', async () => {
    const created = [];
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (row) => {
      created.push(row);
      return { id: 1, ...row };
    };

    const result = await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 1,
      reverseGeocodeFn: async () => null,
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 3, lat: 26.13, lon: -80.13, name: 'Unaddressable' })],
      }),
    });
    assert.equal(result.imported.length, 0);
    assert.equal(result.skippedIncomplete, 1);
    assert.equal(created.length, 0);
  });

  it('does not import when reverse budget is exhausted and OSM tags are incomplete', async () => {
    const created = [];
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (row) => {
      created.push(row);
      return { id: 1, ...row };
    };

    const result = await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 0,
      reverseGeocodeFn: goodReverse,
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 4, lat: 26.13, lon: -80.13, name: 'No Budget' })],
      }),
    });
    assert.equal(result.imported.length, 0);
    assert.equal(result.skippedIncomplete, 1);
    assert.equal(created.length, 0);
  });

  it('enriches an existing incomplete OSM court on rediscovery without overwriting valid data', async () => {
    const existing = {
      id: 99,
      name: 'Pickleball Court (way/123)',
      address_line1: 'Address pending verification',
      city: 'Unknown',
      state: 'XX',
      postal_code: '00000',
      latitude: 26.13,
      longitude: -80.13,
      osm_type: 'way',
      osm_id: 123,
      updates: [],
      get({ plain } = {}) {
        if (plain) {
          return {
            id: this.id,
            name: this.name,
            address_line1: this.address_line1,
            city: this.city,
            state: this.state,
            postal_code: this.postal_code,
            osm_type: this.osm_type,
            osm_id: this.osm_id,
          };
        }
        return this;
      },
      async update(patch) {
        Object.assign(this, patch);
        this.updates.push(patch);
        return this;
      },
    };

    CourtLocation.findOne = async ({ where }) => {
      if (
        where.osm_type === 'way'
        && Number(where.osm_id) === 123
      ) {
        return existing;
      }
      return null;
    };
    CourtLocation.findAll = async () => [existing];
    CourtLocation.create = async () => {
      throw new Error('should not create when enriching');
    };

    const result = await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 1,
      reverseGeocodeFn: goodReverse,
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 123, lat: 26.13, lon: -80.13, name: 'Holiday Park' })],
      }),
    });
    assert.equal(result.imported.length, 0);
    assert.equal(result.enriched.length, 1);
    assert.equal(existing.address_line1, '100 Test Road');
    assert.equal(existing.city, 'Fort Lauderdale');
    assert.equal(existing.state, 'FL');
    assert.equal(existing.postal_code, '33304');
    assert.equal(existing.updates.length, 1);
  });

  it('imports empty area results and prefers closest when over maxImports', async () => {
    const created = [];
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (row) => {
      const court = { id: created.length + 1, ...row };
      created.push(court);
      return court;
    };

    const centerLat = 41.25;
    const centerLng = -95.93;
    const elements = [];
    for (let i = 1; i <= 5; i++) {
      elements.push(osmElComplete({
        id: 1000 + i,
        lat: centerLat + i * 0.01,
        lon: centerLng,
        name: `Park ${i}`,
      }));
    }

    const result = await importFromOpenStreetMap(centerLat, centerLng, 25, {
      maxImports: 3,
      maxReverseGeocodes: 0,
      fetchOverpassFn: async () => ({ elements }),
    });
    assert.equal(result.imported.length, 3);
    assert.deepEqual(
      created.map((c) => c.osm_id),
      [1001, 1002, 1003],
    );
    assert.ok(DISCOVER_MAX_IMPORTS >= 1);
  });

  it('does not create duplicates when Overpass returns the same OSM courts again', async () => {
    const existing = new Map();
    CourtLocation.findOne = async ({ where }) => {
      if (where.osm_type != null && where.osm_id != null) {
        const key = `${where.osm_type}:${where.osm_id}`;
        return existing.get(key) || null;
      }
      return null;
    };
    CourtLocation.findAll = async () => [...existing.values()];
    CourtLocation.create = async (row) => {
      const key = `${row.osm_type}:${row.osm_id}`;
      if (existing.has(key)) throw new Error('unique_court_osm');
      const court = { id: existing.size + 1, ...row };
      existing.set(key, court);
      return court;
    };

    const elements = [
      osmElComplete({ id: 10, lat: 40.71, lon: -74.0, name: 'One' }),
      osmElComplete({ id: 11, lat: 40.72, lon: -74.01, name: 'Two' }),
    ];
    const fetchOverpassFn = async () => ({ elements });

    const first = await discoverCourtsNearby(40.71, -74.0, 10, { fetchOverpassFn });
    assert.equal(first.length, 2);
    assert.equal(existing.size, 2);

    const second = await discoverCourtsNearby(40.71, -74.0, 10, { fetchOverpassFn });
    assert.equal(second.length, 0);
    assert.equal(existing.size, 2);
  });

  it('imports only genuinely new OSM courts when locals already exist', async () => {
    const store = new Map([
      ['manual:1', {
        id: 1,
        name: 'Manual Local',
        address_line1: '1 Main St',
        city: 'New York',
        state: 'NY',
        postal_code: '10001',
        osm_type: null,
        osm_id: null,
        latitude: 40.7128,
        longitude: -74.006,
      }],
    ]);
    CourtLocation.findOne = async ({ where }) => {
      if (where.osm_type != null && where.osm_id != null) {
        for (const v of store.values()) {
          if (v.osm_type === where.osm_type && Number(v.osm_id) === Number(where.osm_id)) return v;
        }
      }
      return null;
    };
    CourtLocation.findAll = async () => [...store.values()].filter((c) => c.deleted_at == null);
    CourtLocation.create = async (row) => {
      const court = { id: store.size + 10, ...row };
      store.set(`osm:${row.osm_id}`, court);
      return court;
    };

    const result = await importFromOpenStreetMap(40.7128, -74.006, 10, {
      maxReverseGeocodes: 0,
      fetchOverpassFn: async () => ({
        elements: [
          osmElComplete({ id: 50, lat: 40.72, lon: -74.01, name: 'OSM New A' }),
          osmElComplete({ id: 51, lat: 40.73, lon: -74.02, name: 'OSM New B' }),
        ],
      }),
    });
    assert.equal(result.imported.length, 2);
    assert.equal([...store.values()].filter((c) => c.osm_id != null).length, 2);
  });

  it('imports an 11th court when Overpass later returns one more', async () => {
    const store = new Map();
    CourtLocation.findOne = async ({ where }) => {
      if (where.osm_type != null && where.osm_id != null) {
        return store.get(`${where.osm_type}:${where.osm_id}`) || null;
      }
      return null;
    };
    CourtLocation.findAll = async () => [...store.values()];
    CourtLocation.create = async (row) => {
      const court = { id: store.size + 1, ...row };
      store.set(`${row.osm_type}:${row.osm_id}`, court);
      return court;
    };

    const ten = Array.from({ length: 10 }, (_, i) => osmElComplete({
      id: 200 + i,
      lat: 41.0 + i * 0.001,
      lon: -95.0,
      name: `C${i}`,
    }));
    await discoverCourtsNearby(41.0, -95.0, 10, {
      maxReverseGeocodes: 0,
      fetchOverpassFn: async () => ({ elements: ten }),
    });
    assert.equal(store.size, 10);

    const eleven = [...ten, osmElComplete({ id: 299, lat: 41.02, lon: -95.01, name: 'New' })];
    const added = await discoverCourtsNearby(41.0, -95.0, 10, {
      maxReverseGeocodes: 0,
      fetchOverpassFn: async () => ({ elements: eleven }),
    });
    assert.equal(added.length, 1);
    assert.equal(store.size, 11);
  });

  it('radius expansion imports courts only seen in the larger Overpass result', async () => {
    const store = new Map();
    CourtLocation.findOne = async ({ where }) => {
      if (where.osm_type != null && where.osm_id != null) {
        return store.get(`${where.osm_type}:${where.osm_id}`) || null;
      }
      return null;
    };
    CourtLocation.findAll = async () => [...store.values()];
    CourtLocation.create = async (row) => {
      const court = { id: store.size + 1, ...row };
      store.set(`${row.osm_type}:${row.osm_id}`, court);
      return court;
    };

    const near = Array.from({ length: 5 }, (_, i) => osmElComplete({
      id: 300 + i,
      lat: 35.08 + i * 0.001,
      lon: -106.65,
      name: `Near ${i}`,
    }));
    const farExtra = Array.from({ length: 15 }, (_, i) => osmElComplete({
      id: 400 + i,
      lat: 35.20 + i * 0.002,
      lon: -106.70,
      name: `Far ${i}`,
    }));

    const r5 = await discoverCourtsNearby(35.08, -106.65, 5, {
      maxReverseGeocodes: 0,
      fetchOverpassFn: async () => ({ elements: near }),
    });
    assert.equal(r5.length, 5);

    const r25 = await discoverCourtsNearby(35.08, -106.65, 25, {
      maxReverseGeocodes: 0,
      fetchOverpassFn: async () => ({ elements: [...near, ...farExtra] }),
    });
    assert.equal(r25.length, 15);
    assert.equal(store.size, 20);

    const r25again = await discoverCourtsNearby(35.08, -106.65, 25, {
      maxReverseGeocodes: 0,
      fetchOverpassFn: async () => ({ elements: [...near, ...farExtra] }),
    });
    assert.equal(r25again.length, 0);
    assert.equal(store.size, 20);
  });
});

describe('OSM import attempt tracking', () => {
  function captureCreates() {
    const created = [];
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (row) => {
      const court = { id: created.length + 1, ...row };
      created.push(court);
      return court;
    };
    return created;
  }

  it('skips recently failed OSM features without spending reverse-geocode budget', async () => {
    const created = captureCreates();
    let reverseCalls = 0;
    const attemptStore = memoryAttemptStore(['way/31']);
    const result = await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 5,
      reverseGeocodeFn: async (...args) => { reverseCalls += 1; return goodReverse(...args); },
      attemptStore,
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 31, lat: 26.13, lon: -80.13, name: 'Failed Before' })],
      }),
    });
    assert.equal(reverseCalls, 0);
    assert.equal(result.skippedRecentlyFailed, 1);
    assert.equal(result.imported.length, 0);
    assert.equal(created.length, 0);
    assert.deepEqual(attemptStore.recorded, []);
  });

  it('records a failure when reverse geocode answers with an unusable address', async () => {
    captureCreates();
    const attemptStore = memoryAttemptStore();
    await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 1,
      reverseGeocodeFn: distantReverse,
      attemptStore,
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 32, lat: 26.13, lon: -80.13, name: 'Mismatch' })],
      }),
    });
    assert.deepEqual(attemptStore.recorded, [{ key: 'way/32', outcome: 'incomplete_address' }]);
  });

  it('does not record a failure when reverse geocode errored, timed out, or budget ran out', async () => {
    captureCreates();
    const attemptStore = memoryAttemptStore();
    const result = await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 1,
      reverseGeocodeFn: async () => null,
      attemptStore,
      fetchOverpassFn: async () => ({
        elements: [
          osmEl({ id: 33, lat: 26.13, lon: -80.13, name: 'Lookup Failed' }),
          osmEl({ id: 34, lat: 26.2, lon: -80.2, name: 'No Budget Left' }),
        ],
      }),
    });
    assert.equal(result.skippedIncomplete, 2);
    assert.deepEqual(attemptStore.recorded, []);
  });

  it('does not record a failure for a successful import', async () => {
    const created = captureCreates();
    const attemptStore = memoryAttemptStore();
    await importFromOpenStreetMap(26.13, -80.13, 10, {
      maxReverseGeocodes: 1,
      reverseGeocodeFn: goodReverse,
      attemptStore,
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 35, lat: 26.13, lon: -80.13, name: 'Good' })],
      }),
    });
    assert.equal(created.length, 1);
    assert.deepEqual(attemptStore.recorded, []);
  });

  it('proximity-skipped candidates do not consume reverse-geocode budget', async () => {
    const created = [];
    const manual = {
      id: 9,
      name: 'Holiday Park',
      osm_type: null,
      osm_id: null,
      latitude: 26.1331,
      longitude: -80.1324,
    };
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [manual];
    CourtLocation.create = async (row) => {
      const court = { id: created.length + 10, ...row };
      created.push(court);
      return court;
    };
    let reverseCalls = 0;
    const result = await importFromOpenStreetMap(26.1331, -80.1324, 10, {
      maxReverseGeocodes: 1,
      reverseGeocodeFn: async (...args) => { reverseCalls += 1; return goodReverse(...args); },
      attemptStore: memoryAttemptStore(),
      fetchOverpassFn: async () => ({
        elements: [
          osmEl({ id: 36, lat: 26.13315, lon: -80.13245, name: 'Holiday Park Pitch' }),
          osmEl({ id: 37, lat: 26.2, lon: -80.2, name: 'Elsewhere' }),
        ],
      }),
    });
    assert.equal(reverseCalls, 1);
    assert.equal(result.imported.length, 1);
    assert.equal(created[0].osm_id, 37);
  });

  it('db store queries only attempts inside the retry window and returns osm keys', async () => {
    let query;
    OsmCourtImportAttempt.findAll = async (q) => {
      query = q;
      return [{ osm_type: 'way', osm_id: 41 }];
    };
    const now = new Date('2026-10-01T12:00:00Z');
    const keys = await dbOsmImportAttemptStore.recentlyFailedKeys(
      [{ osmType: 'way', osmId: 41 }, { osmType: 'node', osmId: 42 }],
      now,
    );
    assert.deepEqual([...keys], ['way/41']);
    const since = Object.getOwnPropertySymbols(query.where.attempted_at)
      .map((s) => query.where.attempted_at[s])[0];
    assert.equal(now.getTime() - since.getTime(), OSM_IMPORT_RETRY_AFTER_DAYS * 86400000);
  });

  it('db store failures never break discovery', async () => {
    OsmCourtImportAttempt.findAll = async () => { throw new Error('no such table'); };
    OsmCourtImportAttempt.upsert = async () => { throw new Error('no such table'); };
    const keys = await dbOsmImportAttemptStore.recentlyFailedKeys([{ osmType: 'way', osmId: 1 }]);
    assert.equal(keys.size, 0);
    await dbOsmImportAttemptStore.recordFailure({ osmType: 'way', osmId: 1 }, 'incomplete_address');
  });
});

/** A tag-only enclosing facility, as Overpass outputs it after the court it contains. */
function facility(name, tags = { leisure: 'park' }, type = 'way') {
  return { type, id: Math.floor(Math.random() * 1e9), tags: { name, ...tags } };
}

describe('OSM court names: own name, else enclosing facility, else withheld', () => {
  it('pairs each court with the facilities that follow it', () => {
    const grouped = groupCourtsWithFacilities([
      osmEl({ id: 1, lat: 26.1, lon: -80.3 }),
      facility('Weston Regional Park'),
      facility('Broward County', { boundary: 'administrative' }, 'area'),
      osmEl({ id: 2, lat: 26.2, lon: -80.3 }),
      { type: 'node', id: 3, lat: 26.3, lon: -80.3, tags: { sport: 'pickleball' } },
      facility('Tequesta Trace Middle School', { amenity: 'school' }, 'area'),
    ]);
    assert.deepEqual(grouped.map((g) => [g.element.id, g.facilityAreas.map((t) => t.name)]), [
      [1, ['Weston Regional Park', 'Broward County']],
      [2, []],
      [3, ['Tequesta Trace Middle School']],
    ]);
  });

  it('prefers the court’s own name, then the most specific facility; generic names do not count', () => {
    const park = { name: 'Indian Trace Park', leisure: 'park' };
    const centre = { name: 'Weston Tennis Center', leisure: 'sports_centre' };
    assert.deepEqual(osmCourtName({ name: 'Holiday Park Courts' }, [park]), { name: 'Holiday Park Courts', source: 'osm' });
    assert.deepEqual(osmCourtName({}, [park]), { name: 'Indian Trace Park', source: 'facility' });
    assert.deepEqual(osmCourtName({}, [park, centre]), { name: 'Weston Tennis Center', source: 'facility' });
    for (const generic of ['Pickleball Court', 'Pickleball Courts', 'Court 3', 'pickleball', 'Pickleball Court (way/123)']) {
      assert.deepEqual(osmCourtName({ name: generic }, [park]), { name: 'Indian Trace Park', source: 'facility' }, generic);
      assert.equal(osmCourtName({ name: generic }, []), null, generic);
    }
    // Operator/brand are not court names; admin boundaries are not facilities.
    assert.equal(osmCourtName({ operator: 'City of Miami' }, [{ name: 'Miami', boundary: 'administrative' }]), null);
    assert.equal(isPlaceholderOsmCourtName('Pickleball Court (way/1215492783)'), true);
    assert.equal(isPlaceholderOsmCourtName('Indian Trace Park'), false);
  });

  it('Overpass queries look up enclosing facilities for each court', () => {
    for (const q of [buildPickleballOverpassQuery(26.1, -80.36, 10), buildOsmFeaturesFacilityQuery({ way: [1, 2] })]) {
      assert.match(q, /foreach\.courts->\.c\(/);
      assert.match(q, /\.c out center tags;/);
      assert.match(q, /\.n is_in->\.a;/);
      assert.match(q, /way\.a\["name"\]\["leisure"~"\^\(sports_centre\|recreation_ground\|stadium\|park\)\$"\];/);
      assert.match(q, /area\.a\["name"\]\["amenity"~/);
    }
    assert.match(buildPickleballOverpassQuery(26.1, -80.36, 10), /nwr\["sport"="pickleball"\]\(around:16093,26\.1,-80\.36\)->\.courts;/);
    assert.match(buildOsmFeaturesFacilityQuery({ way: [1, 2], node: [] }), /\(way\(id:1,2\);\)->\.courts;/);
  });

  /** In-memory court table so duplicate checks see rows created earlier in the same run. */
  function memoryCourts(initial = []) {
    const rows = [...initial];
    CourtLocation.findOne = async ({ where }) => rows.find(
      (r) => r.osm_type === where.osm_type && Number(r.osm_id) === Number(where.osm_id),
    ) || null;
    CourtLocation.findAll = async () => rows;
    CourtLocation.create = async (row) => {
      const court = { id: rows.length + 100, ...row };
      rows.push(court);
      return court;
    };
    return rows;
  }

  it('withholds an unnamed court outside any named facility (no reverse-geocode spent)', async () => {
    const rows = memoryCourts();
    let reverseCalls = 0;
    const result = await importFromOpenStreetMap(26.07, -80.23, 10, {
      maxReverseGeocodes: 5,
      reverseGeocodeFn: async (...args) => { reverseCalls += 1; return goodReverse(...args); },
      attemptStore: memoryAttemptStore(),
      fetchOverpassFn: async () => ({
        elements: [osmEl({ id: 1215492783, lat: 26.07, lon: -80.23 }), facility('Davie', { boundary: 'administrative' }, 'area')],
      }),
    });
    assert.equal(result.imported.length, 0);
    assert.equal(result.skippedUnnamed, 1);
    assert.equal(reverseCalls, 0);
    assert.equal(rows.length, 0);
  });

  it('names an unnamed court after its park, and several pitches in one park become one listing', async () => {
    const rows = memoryCourts();
    const result = await importFromOpenStreetMap(26.1, -80.36, 10, {
      maxReverseGeocodes: 0,
      attemptStore: memoryAttemptStore(),
      fetchOverpassFn: async () => ({
        elements: [
          osmElComplete({ id: 1, lat: 26.1, lon: -80.36 }), facility('Weston Regional Park'),
          osmElComplete({ id: 2, lat: 26.1001, lon: -80.36 }), facility('Weston Regional Park'),
          osmElComplete({ id: 3, lat: 26.1002, lon: -80.36 }), facility('Weston Regional Park'),
        ],
      }),
    });
    assert.equal(result.imported.length, 1);
    assert.deepEqual(rows.map((r) => [r.name, r.osm_id]), [['Weston Regional Park', 1]]);
    assert.ok(rows.every((r) => !isPlaceholderOsmCourtName(r.name)));
  });

  it('a facility name never duplicates a court already listed right there', async () => {
    const rows = memoryCourts([{
      id: 280, name: 'Weston Regional Pickleball Court', osm_type: 'way', osm_id: 9, latitude: 26.1, longitude: -80.36,
    }]);
    const result = await importFromOpenStreetMap(26.1, -80.36, 10, {
      maxReverseGeocodes: 0,
      attemptStore: memoryAttemptStore(),
      fetchOverpassFn: async () => ({
        elements: [
          osmElComplete({ id: 10, lat: 26.1005, lon: -80.36 }), facility('Weston Regional Park'),
          // A separately named court nearby is still its own listing.
          osmElComplete({ id: 11, lat: 26.1006, lon: -80.36, name: 'Weston Tennis Center' }),
        ],
      }),
    });
    assert.deepEqual(result.imported.map((c) => c.name), ['Weston Tennis Center']);
    assert.equal(rows.length, 2);
  });
});

describe('searchCourts geographic discovery (non-blocking)', () => {
  const localCourt = {
    id: 7,
    name: 'Local Only',
    address_line1: '1 St',
    city: 'NY',
    state: 'NY',
    postal_code: '10001',
    country: 'US',
    latitude: 40.7128,
    longitude: -74.006,
    is_private: false,
    get() { return this; },
  };

  function stubSchedule(status = 'started') {
    const calls = [];
    courtDiscovery.schedule = (...args) => {
      calls.push(args);
      return { status };
    };
    return calls;
  }

  it('does not schedule discovery when q is present', async () => {
    const calls = stubSchedule();
    CourtLocation.findAll = async () => [];
    const req = { validated: { lat: 40.7, lng: -74.0, radius: 10, q: 'Holiday' } };
    const res = { json(p) { this.payload = p; } };
    await searchCourts(req, res);
    assert.equal(calls.length, 0);
    assert.equal(res.payload?.success, true);
    assert.equal(res.payload?.discovery, undefined);
  });

  it('returns local courts immediately and schedules background discovery', async () => {
    const calls = stubSchedule('started');
    CourtLocation.findAll = async () => [localCourt];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('search must not call external APIs'); };
    try {
      const req = { validated: { lat: 40.7128, lng: -74.006, radius: 10 } };
      const res = { json(p) { this.payload = p; } };
      await searchCourts(req, res);
      assert.deepEqual(calls, [[40.7128, -74.006, 10]]);
      assert.equal(res.payload?.data?.length, 1);
      assert.equal(res.payload?.data?.[0]?.name, 'Local Only');
      assert.equal(res.payload?.message, 'Courts retrieved successfully');
      assert.deepEqual(res.payload?.discovery, { status: 'started' });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns an empty list (not an error) when there are no local courts yet', async () => {
    stubSchedule('running');
    CourtLocation.findAll = async () => [];
    const req = { validated: { lat: 25.0, lng: -70.0, radius: 10 } };
    const res = { json(p) { this.payload = p; } };
    await searchCourts(req, res);
    assert.deepEqual(res.payload?.data, []);
    assert.deepEqual(res.payload?.discovery, { status: 'running' });
  });

  it('keeps only courts within the radius and orders the query by distance before the cap', async () => {
    stubSchedule('recent');
    let findAllOpts;
    const corner = {
      ...localCourt,
      id: 8,
      name: 'Box Corner',
      latitude: 40.7128 + 0.14,
      longitude: -74.006 + 0.18,
    };
    CourtLocation.findAll = async (opts) => {
      findAllOpts = opts;
      return [corner, localCourt];
    };
    const req = { validated: { lat: 40.7128, lng: -74.006, radius: 10 } };
    const res = { json(p) { this.payload = p; } };
    await searchCourts(req, res);
    assert.deepEqual(res.payload.data.map((c) => c.name), ['Local Only']);
    assert.equal(findAllOpts.limit, 100);
    assert.equal(findAllOpts.order?.[0]?.[1], 'ASC');
    assert.match(String(findAllOpts.order?.[0]?.[0]?.val), /POW\(latitude - 40\.7128000, 2\)/);
  });

  it('reports recent when the area was discovered lately', async () => {
    stubSchedule('recent');
    CourtLocation.findAll = async () => [localCourt];
    const req = { validated: { lat: 40.7128, lng: -74.006, radius: 10 } };
    const res = { json(p) { this.payload = p; } };
    await searchCourts(req, res);
    assert.deepEqual(res.payload?.discovery, { status: 'recent' });
  });
});
