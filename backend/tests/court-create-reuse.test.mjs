/**
 * POST /api/courts — create-or-reuse shared court + coach link.
 * Also covers POST /api/courts/duplicate-check private-court privacy.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { createCourt, checkCourtDuplicates } from '../controllers/courtController.js';
import { CourtLocation, CoachCourtLocation } from '../models/index.js';

const baseBody = {
  name: 'Central Park Courts',
  address_line1: '123 Main St',
  city: 'Miami',
  state: 'FL',
  postal_code: '33101',
  country: 'US',
  latitude: 25.78,
  longitude: -80.19,
  is_private: false,
};

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

describe('createCourt create-or-reuse', () => {
  let origFindOne;
  let origFindAll;
  let origCreate;
  let origFindByPk;
  let origLinkFindOne;
  let origLinkCreate;
  let origLinkFindByPk;
  let origLinkFindAll;

  beforeEach(() => {
    origFindOne = CourtLocation.findOne;
    origFindAll = CourtLocation.findAll;
    origCreate = CourtLocation.create;
    origFindByPk = CourtLocation.findByPk;
    origLinkFindOne = CoachCourtLocation.findOne;
    origLinkCreate = CoachCourtLocation.create;
    origLinkFindByPk = CoachCourtLocation.findByPk;
    origLinkFindAll = CoachCourtLocation.findAll;
    // Default: no nearby candidates (tests that need duplicates override findAll).
    CourtLocation.findAll = async () => [];
    CoachCourtLocation.findAll = async () => [];
  });

  afterEach(() => {
    CourtLocation.findOne = origFindOne;
    CourtLocation.findAll = origFindAll;
    CourtLocation.create = origCreate;
    CourtLocation.findByPk = origFindByPk;
    CoachCourtLocation.findOne = origLinkFindOne;
    CoachCourtLocation.create = origLinkCreate;
    CoachCourtLocation.findByPk = origLinkFindByPk;
    CoachCourtLocation.findAll = origLinkFindAll;
  });

  it('creates a new court and auto-links the coach (201)', async () => {
    CourtLocation.findOne = async () => null;
    CourtLocation.create = async (attrs) => ({ id: 10, ...attrs });
    CourtLocation.findByPk = async () => ({
      id: 10,
      name: baseBody.name,
      address_line1: baseBody.address_line1,
      city: baseBody.city,
      state: baseBody.state,
      postal_code: baseBody.postal_code,
      country: 'US',
      latitude: baseBody.latitude,
      longitude: baseBody.longitude,
      is_private: false,
    });
    CoachCourtLocation.findAll = async () => [];
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({ id: 99, coach_id: 2, court_id: 10 });
    CoachCourtLocation.findByPk = async () => ({
      id: 99,
      coach_id: 2,
      court_id: 10,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const req = {
      validated: { ...baseBody },
      body: { ...baseBody },
      user: { id: 2, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Court created successfully');
    assert.equal(res.payload.data.court.id, 10);
    assert.equal(res.payload.data.coachCourt.court_id, 10);
  });

  it('reuses an existing shared court and links the coach (201)', async () => {
    const existing = {
      id: 7,
      name: baseBody.name,
      address_line1: baseBody.address_line1,
      city: baseBody.city,
      state: baseBody.state,
      postal_code: baseBody.postal_code,
      country: 'US',
      latitude: 25.78,
      longitude: -80.19,
      is_private: false,
      deleted_at: null,
    };
    let createdCourt = false;
    CourtLocation.findOne = async () => existing;
    CourtLocation.create = async () => {
      createdCourt = true;
      throw new Error('should not create');
    };
    CourtLocation.findByPk = async () => existing;
    CoachCourtLocation.findAll = async () => [];
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({ id: 50, coach_id: 3, court_id: 7 });
    CoachCourtLocation.findByPk = async () => ({
      id: 50,
      coach_id: 3,
      court_id: 7,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const req = {
      validated: { ...baseBody },
      body: { ...baseBody },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(createdCourt, false);
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Existing court linked successfully');
    assert.equal(res.payload.data.court.id, 7);
    assert.equal(res.payload.data.coachCourt.court_id, 7);
  });

  it('returns 200 when coach is already linked to the matching court', async () => {
    const existing = {
      id: 7,
      name: baseBody.name,
      address_line1: baseBody.address_line1,
      city: baseBody.city,
      state: baseBody.state,
      postal_code: baseBody.postal_code,
      country: 'US',
      latitude: 25.78,
      longitude: -80.19,
      is_private: false,
      deleted_at: null,
    };
    CourtLocation.findOne = async () => existing;
    CourtLocation.findByPk = async () => existing;
    CoachCourtLocation.findAll = async () => [
      { court: { id: 7, latitude: 25.78, longitude: -80.19 } },
    ];
    CoachCourtLocation.findOne = async () => ({ id: 50, coach_id: 3, court_id: 7 });
    CoachCourtLocation.create = async () => {
      throw new Error('should not create link');
    };
    CoachCourtLocation.findByPk = async () => ({
      id: 50,
      coach_id: 3,
      court_id: 7,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const req = {
      validated: { ...baseBody },
      body: { ...baseBody },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.message, 'Court already linked');
    assert.equal(res.payload.data.court.id, 7);
  });

  it('admin reuses existing court without linking (200)', async () => {
    const existing = {
      id: 7,
      name: baseBody.name,
      address_line1: baseBody.address_line1,
      city: baseBody.city,
      state: baseBody.state,
      postal_code: baseBody.postal_code,
      country: 'US',
      latitude: 25.78,
      longitude: -80.19,
      is_private: false,
      deleted_at: null,
      toJSON() {
        return this;
      },
    };
    CourtLocation.findOne = async () => existing;
    CourtLocation.create = async () => {
      throw new Error('should not create');
    };
    CoachCourtLocation.create = async () => {
      throw new Error('admin should not auto-link');
    };

    const req = {
      validated: { ...baseBody },
      body: { ...baseBody },
      user: { id: 1, roles: ['admin'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.message, 'Court already exists');
    assert.equal(res.payload.data.id, 7);
  });

  it('allows same name at materially different coordinates (Holiday Park in two states)', async () => {
    // Existing: Holiday Park, Fort Lauderdale — far from the proposed Austin pin.
    // Nearby duplicate search (≈1 mi) must not surface it; name alone must not block create.
    let createdAttrs = null;
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (attrs) => {
      createdAttrs = attrs;
      return { id: 42, ...attrs };
    };
    CourtLocation.findByPk = async () => ({
      id: 42,
      name: 'Holiday Park',
      address_line1: '200 E 6th St',
      city: 'Austin',
      state: 'TX',
      postal_code: '78701',
      country: 'US',
      latitude: 30.2672,
      longitude: -97.7431,
      is_private: false,
    });
    CoachCourtLocation.findAll = async () => [];
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({ id: 70, coach_id: 3, court_id: 42 });
    CoachCourtLocation.findByPk = async () => ({
      id: 70,
      coach_id: 3,
      court_id: 42,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const req = {
      validated: {
        name: 'Holiday Park',
        address_line1: '200 E 6th St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'US',
        latitude: 30.2672,
        longitude: -97.7431,
        is_private: false,
      },
      body: {
        name: 'Holiday Park',
        address_line1: '200 E 6th St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'US',
        latitude: 30.2672,
        longitude: -97.7431,
        is_private: false,
      },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Court created successfully');
    assert.equal(createdAttrs?.name, 'Holiday Park');
    assert.equal(createdAttrs?.state, 'TX');
    assert.equal(res.payload.data.court.id, 42);
  });

  it('reuses exact Holiday Park Fort Lauderdale identity instead of creating a second row', async () => {
    const existing = {
      id: 7,
      name: 'Holiday Park',
      address_line1: '1150 G Harold Martin Dr',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      country: 'US',
      latitude: 26.1367,
      longitude: -80.141,
      is_private: false,
      deleted_at: null,
    };
    let createdCourt = false;
    CourtLocation.findOne = async () => existing;
    CourtLocation.findAll = async () => {
      throw new Error('should not run geographic duplicate search on exact identity hit');
    };
    CourtLocation.create = async () => {
      createdCourt = true;
      throw new Error('should not create');
    };
    CourtLocation.findByPk = async () => existing;
    CoachCourtLocation.findAll = async () => [];
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({ id: 50, coach_id: 3, court_id: 7 });
    CoachCourtLocation.findByPk = async () => ({
      id: 50,
      coach_id: 3,
      court_id: 7,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const body = {
      name: 'Holiday Park',
      address_line1: '1150 G Harold Martin Dr',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      country: 'US',
      latitude: 26.1367,
      longitude: -80.141,
      is_private: false,
    };
    const req = {
      validated: { ...body },
      body: { ...body },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(createdCourt, false);
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Existing court linked successfully');
    assert.equal(res.payload.data.court.id, 7);
  });

  it('409 COURT_DUPLICATE_HIGH for same name at nearby coordinates (same physical place)', async () => {
    const nearbyExisting = {
      id: 7,
      name: 'Holiday Park',
      address_line1: '1150 G Harold Martin Dr',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      country: 'US',
      latitude: 26.1367,
      longitude: -80.141,
      is_private: false,
      created_by_user_id: 99,
      deleted_at: null,
      get(opts) {
        if (opts && opts.plain) return { ...this, get: undefined };
        return this;
      },
    };
    CourtLocation.findOne = async () => null; // different street text → not exact identity
    CourtLocation.findAll = async () => [nearbyExisting];
    CourtLocation.create = async () => {
      throw new Error('should not create duplicate nearby court');
    };
    CoachCourtLocation.findAll = async () => [];

    const req = {
      validated: {
        name: 'Holiday Park',
        address_line1: '1150 G. Harold Martin Drive',
        city: 'Fort Lauderdale',
        state: 'FL',
        postal_code: '33304',
        country: 'US',
        latitude: 26.1368,
        longitude: -80.1411,
        is_private: false,
      },
      body: {
        name: 'Holiday Park',
        address_line1: '1150 G. Harold Martin Drive',
        city: 'Fort Lauderdale',
        state: 'FL',
        postal_code: '33304',
        country: 'US',
        latitude: 26.1368,
        longitude: -80.1411,
        is_private: false,
      },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.error, 'COURT_DUPLICATE_HIGH');
    assert.ok(res.payload.data?.high_confidence?.some((c) => c.id === 7));
  });

  it('409 does not leak another coach private court street/GPS to a non-owner', async () => {
    const privateOther = {
      id: 77,
      name: 'Backyard Court',
      address_line1: '999 Secret Lane',
      city: 'Coral Springs',
      state: 'FL',
      postal_code: '33065',
      country: 'US',
      latitude: 26.271,
      longitude: -80.27,
      is_private: true,
      created_by_user_id: 50,
      deleted_at: null,
      get(opts) {
        if (opts && opts.plain) {
          const { get: _g, ...rest } = this;
          return rest;
        }
        return this;
      },
    };
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [privateOther];
    CourtLocation.create = async (attrs) => ({ id: 12, ...attrs });
    CourtLocation.findByPk = async () => ({
      id: 12,
      name: 'Backyard Court',
      address_line1: '999 Secret Lane',
      city: 'Coral Springs',
      state: 'FL',
      postal_code: '33065',
      country: 'US',
      latitude: 26.271,
      longitude: -80.27,
      is_private: true,
    });
    CoachCourtLocation.findAll = async () => []; // viewer owns none
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({ id: 100, coach_id: 3, court_id: 12 });
    CoachCourtLocation.findByPk = async () => ({
      id: 100,
      coach_id: 3,
      court_id: 12,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const req = {
      validated: {
        name: 'Backyard Court',
        address_line1: '999 Secret Lane',
        city: 'Coral Springs',
        state: 'FL',
        postal_code: '33065',
        country: 'US',
        latitude: 26.2711,
        longitude: -80.2701,
        is_private: true,
      },
      body: {},
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    // Private other-coach court filtered out → create proceeds (or exact identity path).
    // Must not return 409 with the private street/GPS.
    if (res.statusCode === 409) {
      const candidates = [
        ...(res.payload?.data?.high_confidence || []),
        ...(res.payload?.data?.possible || []),
      ];
      for (const c of candidates) {
        assert.notEqual(c.address_line1, '999 Secret Lane');
        assert.notEqual(Number(c.latitude), 26.271);
      }
    } else {
      assert.ok([200, 201].includes(res.statusCode), res.payload);
    }
  });

  it('owner still sees own private court in 409 duplicate candidates', async () => {
    const privateOwn = {
      id: 88,
      name: 'My Backyard',
      address_line1: '111 Owner Way',
      city: 'Davie',
      state: 'FL',
      postal_code: '33314',
      country: 'US',
      latitude: 26.08,
      longitude: -80.23,
      is_private: true,
      created_by_user_id: 3,
      deleted_at: null,
      get(opts) {
        if (opts && opts.plain) {
          const { get: _g, ...rest } = this;
          return rest;
        }
        return this;
      },
    };
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [privateOwn];
    CourtLocation.create = async () => {
      throw new Error('should not create when owner duplicate is visible');
    };
    CoachCourtLocation.findAll = async () => [{ court_id: 88 }];

    const req = {
      validated: {
        name: 'My Backyard',
        address_line1: '111 Owner Way',
        city: 'Davie',
        state: 'FL',
        postal_code: '33314',
        country: 'US',
        latitude: 26.0801,
        longitude: -80.2301,
        is_private: true,
      },
      body: {},
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 409, JSON.stringify(res.payload));
    const hit = (res.payload?.data?.high_confidence || []).find((c) => c.id === 88);
    assert.ok(hit, 'owner must see their private court candidate');
    assert.equal(hit.address_line1, '111 Owner Way');
    assert.ok(hit.latitude != null);
  });

  it('allows different name at the same address (venue with multiple courts)', async () => {
    CourtLocation.findOne = async () => null;
    CourtLocation.create = async (attrs) => ({ id: 11, ...attrs });
    CourtLocation.findByPk = async () => ({
      id: 11,
      name: 'Central Park Court 2',
      address_line1: baseBody.address_line1,
      city: baseBody.city,
      state: baseBody.state,
      postal_code: baseBody.postal_code,
      country: 'US',
      latitude: baseBody.latitude,
      longitude: baseBody.longitude,
      is_private: false,
    });
    CoachCourtLocation.findAll = async () => [];
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({ id: 60, coach_id: 2, court_id: 11 });
    CoachCourtLocation.findByPk = async () => ({
      id: 60,
      coach_id: 2,
      court_id: 11,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const req = {
      validated: { ...baseBody, name: 'Central Park Court 2' },
      body: { ...baseBody, name: 'Central Park Court 2' },
      user: { id: 2, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Court created successfully');
    assert.equal(res.payload.data.court.name, 'Central Park Court 2');
  });

  it('restores a soft-deleted exact match and links the coach', async () => {
    let deletedAt = new Date();
    const softDeleted = {
      id: 7,
      name: baseBody.name,
      address_line1: baseBody.address_line1,
      city: baseBody.city,
      state: baseBody.state,
      postal_code: baseBody.postal_code,
      country: 'US',
      latitude: 25.78,
      longitude: -80.19,
      is_private: false,
      deleted_at: deletedAt,
      async update(patch) {
        if (Object.prototype.hasOwnProperty.call(patch, 'deleted_at')) {
          deletedAt = patch.deleted_at;
          this.deleted_at = patch.deleted_at;
        }
      },
      async reload() {
        this.deleted_at = deletedAt;
      },
    };
    let createdCourt = false;
    CourtLocation.findOne = async () => softDeleted;
    CourtLocation.create = async () => {
      createdCourt = true;
      throw new Error('should not create');
    };
    CourtLocation.findByPk = async () => ({
      ...softDeleted,
      deleted_at: null,
    });
    CoachCourtLocation.findAll = async () => [];
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({ id: 50, coach_id: 3, court_id: 7 });
    CoachCourtLocation.findByPk = async () => ({
      id: 50,
      coach_id: 3,
      court_id: 7,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const req = {
      validated: { ...baseBody },
      body: { ...baseBody },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(createdCourt, false);
    assert.equal(deletedAt, null);
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Existing court restored and linked successfully');
    assert.equal(res.payload.data.court.id, 7);
  });

  it('allows creating a court hundreds of miles from the coach existing courts', async () => {
    // Coach already teaches in Fort Lauderdale; creating in NYC must succeed (no cluster limit).
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [];
    CourtLocation.create = async (attrs) => ({ id: 88, ...attrs });
    CourtLocation.findByPk = async () => ({
      id: 88,
      name: 'Central Park Courts',
      address_line1: '1 E 59th St',
      city: 'New York',
      state: 'NY',
      postal_code: '10022',
      country: 'US',
      latitude: 40.7648,
      longitude: -73.9725,
      is_private: false,
    });
    CoachCourtLocation.findAll = async () => [
      { court: { id: 1, latitude: 26.1367, longitude: -80.141 } },
    ];
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({ id: 90, coach_id: 3, court_id: 88 });
    CoachCourtLocation.findByPk = async () => ({
      id: 90,
      coach_id: 3,
      court_id: 88,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const body = {
      name: 'Central Park Courts',
      address_line1: '1 E 59th St',
      city: 'New York',
      state: 'NY',
      postal_code: '10022',
      country: 'US',
      latitude: 40.7648,
      longitude: -73.9725,
      is_private: false,
    };
    const req = {
      validated: { ...body },
      body: { ...body },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Court created successfully');
    assert.equal(res.payload.data.court.id, 88);
  });
});

describe('POST /api/courts/duplicate-check privacy', () => {
  let origFindAll;
  let origLinkFindAll;

  beforeEach(() => {
    origFindAll = CourtLocation.findAll;
    origLinkFindAll = CoachCourtLocation.findAll;
    CoachCourtLocation.findAll = async () => [];
  });

  afterEach(() => {
    CourtLocation.findAll = origFindAll;
    CoachCourtLocation.findAll = origLinkFindAll;
  });

  it('does not return another coach private court street/GPS', async () => {
    const privateOther = {
      id: 77,
      name: 'Backyard Court',
      address_line1: '999 Secret Lane',
      city: 'Coral Springs',
      state: 'FL',
      postal_code: '33065',
      country: 'US',
      latitude: 26.271,
      longitude: -80.27,
      is_private: true,
      created_by_user_id: 50,
      deleted_at: null,
      get(opts) {
        if (opts && opts.plain) {
          const { get: _g, ...rest } = this;
          return rest;
        }
        return this;
      },
    };
    CourtLocation.findAll = async () => [privateOther];

    const req = {
      validated: {
        name: 'Backyard Court',
        address_line1: '999 Secret Lane',
        city: 'Coral Springs',
        state: 'FL',
        postal_code: '33065',
        country: 'US',
        latitude: 26.2711,
        longitude: -80.2701,
      },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await checkCourtDuplicates(req, res);

    assert.equal(res.statusCode, 200);
    const candidates = [
      ...(res.payload?.data?.high_confidence || []),
      ...(res.payload?.data?.possible || []),
    ];
    assert.equal(candidates.length, 0);
    for (const c of candidates) {
      assert.notEqual(c.address_line1, '999 Secret Lane');
      assert.notEqual(Number(c.latitude), 26.271);
    }
  });

  it('returns owner private court candidates with address', async () => {
    const privateOwn = {
      id: 88,
      name: 'My Backyard',
      address_line1: '111 Owner Way',
      city: 'Davie',
      state: 'FL',
      postal_code: '33314',
      country: 'US',
      latitude: 26.08,
      longitude: -80.23,
      is_private: true,
      created_by_user_id: 3,
      deleted_at: null,
      get(opts) {
        if (opts && opts.plain) {
          const { get: _g, ...rest } = this;
          return rest;
        }
        return this;
      },
    };
    CourtLocation.findAll = async () => [privateOwn];

    const req = {
      validated: {
        name: 'My Backyard',
        address_line1: '111 Owner Way',
        city: 'Davie',
        state: 'FL',
        postal_code: '33314',
        country: 'US',
        latitude: 26.0801,
        longitude: -80.2301,
      },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await checkCourtDuplicates(req, res);

    assert.equal(res.statusCode, 200);
    const candidates = [
      ...(res.payload?.data?.high_confidence || []),
      ...(res.payload?.data?.possible || []),
    ];
    const hit = candidates.find((c) => c.id === 88);
    assert.ok(hit, 'owner must see their private court');
    assert.equal(hit.address_line1, '111 Owner Way');
    assert.equal(Number(hit.latitude), 26.08);
  });
});
