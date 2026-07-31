/**
 * POST /api/courts — create-or-reuse shared court + coach link.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { createCourt } from '../controllers/courtController.js';
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
  let origCreate;
  let origFindByPk;
  let origLinkFindOne;
  let origLinkCreate;
  let origLinkFindByPk;
  let origLinkFindAll;

  beforeEach(() => {
    origFindOne = CourtLocation.findOne;
    origCreate = CourtLocation.create;
    origFindByPk = CourtLocation.findByPk;
    origLinkFindOne = CoachCourtLocation.findOne;
    origLinkCreate = CoachCourtLocation.create;
    origLinkFindByPk = CoachCourtLocation.findByPk;
    origLinkFindAll = CoachCourtLocation.findAll;
  });

  afterEach(() => {
    CourtLocation.findOne = origFindOne;
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

  it('409 COURT_NAME_CONFLICT when same name exists at a different address', async () => {
    const otherAddress = {
      id: 7,
      name: baseBody.name,
      address_line1: '123 Main St',
      city: 'Miami',
      state: 'FL',
      postal_code: '33101',
      country: 'US',
      deleted_at: null,
    };
    CourtLocation.findOne = async (opts) => {
      const w = opts?.where || {};
      // Exact identity miss (different street)
      if (w.address_line1 === '456 Other St') return null;
      // Name conflict lookup
      if (w.name === baseBody.name && w.deleted_at === null && w.address_line1 == null) {
        return otherAddress;
      }
      return null;
    };
    CourtLocation.create = async () => {
      throw new Error('should not create');
    };

    const req = {
      validated: {
        ...baseBody,
        address_line1: '456 Other St',
      },
      body: {
        ...baseBody,
        address_line1: '456 Other St',
      },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await createCourt(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.error, 'COURT_NAME_CONFLICT');
    assert.match(res.payload.message, /different location/i);
    assert.match(res.payload.message, /verify the address or choose a different court name/i);
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
});
