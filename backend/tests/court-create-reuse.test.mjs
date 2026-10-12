/**
 * POST /api/courts — create-or-reuse shared court + coach link.
 * Also covers POST /api/courts/duplicate-check.
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
      },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.error, 'COURT_DUPLICATE_HIGH');
    assert.ok(res.payload.data?.high_confidence?.some((c) => c.id === 7));
  });

  it('creates and links a court next to a very likely match once the coach confirms it is different', async () => {
    const nearbyExisting = {
      id: 7, name: 'Holiday Park', address_line1: '1150 G Harold Martin Dr', city: 'Fort Lauderdale',
      state: 'FL', postal_code: '33304', country: 'US', latitude: 26.1367, longitude: -80.141,
      created_by_user_id: 99, deleted_at: null,
      get(opts) {
        if (opts && opts.plain) return { ...this, get: undefined };
        return this;
      },
    };
    let createdAttrs = null;
    let linked = null;
    CourtLocation.findOne = async () => null;
    CourtLocation.findAll = async () => [nearbyExisting];
    CourtLocation.create = async (attrs) => {
      createdAttrs = attrs;
      return { id: 43, ...attrs };
    };
    CourtLocation.findByPk = async () => ({ id: 43, name: 'Holiday Park' });
    CoachCourtLocation.findAll = async () => [];
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async (attrs) => {
      linked = attrs;
      return { id: 71, ...attrs };
    };
    CoachCourtLocation.findByPk = async () => ({ id: 71, coach_id: 3, court_id: 43 });

    const fields = {
      name: 'Holiday Park', address_line1: '1150 G. Harold Martin Drive', city: 'Fort Lauderdale',
      state: 'FL', postal_code: '33304', country: 'US', latitude: 26.1368, longitude: -80.1411,
      acknowledge_possible_duplicates: true,
    };
    const res = mockRes();
    await createCourt({ validated: fields, body: fields, user: { id: 3, roles: ['coach'] } }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Court created successfully');
    assert.equal(createdAttrs?.name, 'Holiday Park');
    assert.deepEqual(linked, { coach_id: 3, court_id: 43 });
  });

  it('409 lists a nearby court created by another coach, with its address', async () => {
    const otherCoachCourt = {
      id: 88,
      name: 'Backyard Court',
      address_line1: '999 Oak Lane',
      city: 'Coral Springs',
      state: 'FL',
      postal_code: '33065',
      country: 'US',
      latitude: 26.271,
      longitude: -80.27,
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
    CourtLocation.findAll = async () => [otherCoachCourt];
    CourtLocation.create = async () => {
      throw new Error('should not create when a duplicate exists');
    };

    const req = {
      validated: {
        name: 'Backyard Court',
        address_line1: '999 Oak Lane',
        city: 'Coral Springs',
        state: 'FL',
        postal_code: '33065',
        country: 'US',
        latitude: 26.2711,
        longitude: -80.2701,
      },
      body: {},
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 409, JSON.stringify(res.payload));
    const hit = (res.payload?.data?.high_confidence || []).find((c) => c.id === 88);
    assert.ok(hit);
    assert.equal(hit.address_line1, '999 Oak Lane');
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

describe('POST /api/courts/duplicate-check', () => {
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

  it('returns nearby courts created by any coach, with address', async () => {
    const nearbyCourt = {
      id: 88,
      name: 'My Backyard',
      address_line1: '111 Owner Way',
      city: 'Davie',
      state: 'FL',
      postal_code: '33314',
      country: 'US',
      latitude: 26.08,
      longitude: -80.23,
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
    CourtLocation.findAll = async () => [nearbyCourt];

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
    assert.ok(hit);
    assert.equal(hit.address_line1, '111 Owner Way');
    assert.equal(Number(hit.latitude), 26.08);
  });
});
