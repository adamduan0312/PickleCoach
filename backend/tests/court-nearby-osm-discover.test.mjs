/**
 * Geographic nearby OSM discovery (discoverCourtsNearby) — mocked Overpass, no live network.
 * Hard invariant: incomplete addresses are never inserted into court_locations.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach, mock } from 'node:test';
import { CourtLocation } from '../models/index.js';
import {
  shouldSkipOsmCandidate,
  importFromOpenStreetMap,
  discoverCourtsNearby,
  DISCOVER_MAX_IMPORTS,
} from '../services/courtImportService.js';
import { searchCourts } from '../controllers/courtController.js';

const origFindAll = CourtLocation.findAll;
const origFindOne = CourtLocation.findOne;
const origCreate = CourtLocation.create;

afterEach(() => {
  CourtLocation.findAll = origFindAll;
  CourtLocation.findOne = origFindOne;
  CourtLocation.create = origCreate;
  mock.restoreAll();
});

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
        name: `Court ${i}`,
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

describe('searchCourts geographic discovery gate', () => {
  it('does not call discover when q is present', async () => {
    let discoverCalled = false;
    CourtLocation.findAll = async () => [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      discoverCalled = true;
      throw new Error('should not fetch when q is set');
    };
    try {
      const req = { validated: { lat: 40.7, lng: -74.0, radius: 10, q: 'Holiday' } };
      const res = { json(p) { this.payload = p; } };
      await searchCourts(req, res);
      assert.equal(discoverCalled, false);
      assert.equal(res.payload?.success, true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns local courts when Overpass fails (non-empty local)', async () => {
    CourtLocation.findAll = async () => ([
      {
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
      },
    ]);
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('overpass down'); };
    try {
      const req = { validated: { lat: 40.7128, lng: -74.006, radius: 10 } };
      const res = { json(p) { this.payload = p; } };
      await searchCourts(req, res);
      assert.equal(res.payload?.data?.length, 1);
      assert.equal(res.payload?.data?.[0]?.name, 'Local Only');
      assert.match(res.payload.message, /external discovery unavailable/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns empty array gracefully when zero local and Overpass fails', async () => {
    CourtLocation.findAll = async () => [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('overpass down'); };
    try {
      const req = { validated: { lat: 25.0, lng: -70.0, radius: 10 } };
      const res = { json(p) { this.payload = p; } };
      await searchCourts(req, res);
      assert.deepEqual(res.payload?.data, []);
      assert.match(res.payload.message, /external discovery unavailable/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('attempts discovery even when local courts already exist', async () => {
    let fetchCalls = 0;
    const seed = {
      id: 1,
      name: 'Seed',
      address_line1: '1 Main St',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      country: 'US',
      latitude: 26.13,
      longitude: -80.13,
      is_private: false,
      osm_type: null,
      osm_id: null,
      get() { return this; },
    };
    const importedRow = {
      id: 2,
      name: 'Imported',
      address_line1: '100 Test Road',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      country: 'US',
      latitude: 26.20,
      longitude: -80.20,
      is_private: false,
      osm_type: 'way',
      osm_id: 55,
      get() { return this; },
    };
    let phase = 'initial';
    CourtLocation.findAll = async () => {
      if (phase === 'afterImport') return [seed, importedRow];
      return [seed];
    };
    CourtLocation.findOne = async () => null;
    CourtLocation.create = async (row) => {
      phase = 'afterImport';
      Object.assign(importedRow, row, { id: 2, get() { return this; } });
      return importedRow;
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetchCalls += 1;
      const u = String(url);
      if (u.includes('nominatim') && u.includes('reverse')) {
        const body = {
          address: {
            house_number: '100',
            road: 'Test Road',
            city: 'Fort Lauderdale',
            state: 'Florida',
            postcode: '33304',
          },
          display_name: '100 Test Road, Fort Lauderdale, Florida',
        };
        return {
          ok: true,
          async json() { return body; },
          async text() { return JSON.stringify(body); },
        };
      }
      const body = {
        elements: [osmElComplete({ id: 55, lat: 26.20, lon: -80.20, name: 'Imported' })],
      };
      return {
        ok: true,
        async text() { return JSON.stringify(body); },
        async json() { return body; },
      };
    };
    try {
      const req = { validated: { lat: 26.13, lng: -80.13, radius: 25 } };
      const res = { json(p) { this.payload = p; } };
      await searchCourts(req, res);
      assert.ok(fetchCalls >= 1, 'Overpass must run even with existing local courts');
      assert.match(String(res.payload?.message || ''), /imported|successfully/);
      assert.ok((res.payload?.data?.length || 0) >= 2, 'combined local + imported');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
