/**
 * Private courts are excluded from public discovery (`GET /api/courts`, `GET /api/courts/:id`)
 * via `publicCourtDirectoryWhere` and controller queries.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { Op } from 'sequelize';
import { CourtLocation, CoachCourtLocation, CoachProfile, User } from '../models/index.js';
import { searchCourts, getCourt, getCoachCourtsById, getMyCoachCourts } from '../controllers/courtController.js';
import { publicCourtDirectoryWhere } from '../utils/courtPublicDirectory.js';

const origFindAll = CourtLocation.findAll;
const origFindAndCountAll = CourtLocation.findAndCountAll;
const origFindOne = CourtLocation.findOne;
const origCoachProfileFindOne = CoachProfile.findOne;
const origCoachCourtFAC = CoachCourtLocation.findAndCountAll;
const origUserFindOne = User.findOne;

afterEach(() => {
  CourtLocation.findAll = origFindAll;
  CourtLocation.findAndCountAll = origFindAndCountAll;
  CourtLocation.findOne = origFindOne;
  CoachProfile.findOne = origCoachProfileFindOne;
  CoachCourtLocation.findAndCountAll = origCoachCourtFAC;
  User.findOne = origUserFindOne;
});

describe('publicCourtDirectoryWhere', () => {
  it('fixes deleted_at and is_private even if extra tries to override', () => {
    const w = publicCourtDirectoryWhere({ is_private: true, deleted_at: new Date('2020-01-01') });
    assert.equal(w.is_private, false);
    assert.equal(w.deleted_at, null);
  });

  it('merges id and geo constraints', () => {
    const w = publicCourtDirectoryWhere({
      id: 5,
      latitude: { [Op.between]: [1, 2] },
    });
    assert.equal(w.id, 5);
    assert.equal(w.is_private, false);
    assert.equal(w.deleted_at, null);
    assert.ok(w.latitude);
  });
});

describe('GET /api/courts (searchCourts) uses public directory where', () => {
  it('non-paginated list passes is_private: false', async () => {
    let whereArg;
    CourtLocation.findAll = async (opts) => {
      whereArg = opts.where;
      return [];
    };
    const req = { validated: {} };
    const res = { json(payload) {
      this.payload = payload;
    } };
    await searchCourts(req, res);
    assert.equal(whereArg.is_private, false);
    assert.equal(whereArg.deleted_at, null);
  });

  it('paginated list passes is_private: false', async () => {
    let whereArg;
    CourtLocation.findAndCountAll = async (opts) => {
      whereArg = opts.where;
      return { count: 0, rows: [] };
    };
    const req = { validated: { page: 1, limit: 10 } };
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(payload) {
        this.payload = payload;
      },
    };
    await searchCourts(req, res);
    assert.equal(whereArg.is_private, false);
    assert.equal(whereArg.deleted_at, null);
  });

  it('geo search passes is_private: false with bbox', async () => {
    let whereArg;
    CourtLocation.findAll = async (opts) => {
      whereArg = opts.where;
      return [
        {
          id: 1,
          name: 'Near',
          address_line1: '1 Main',
          city: 'New York',
          state: 'NY',
          postal_code: '10001',
          country: 'US',
          latitude: 40.7128,
          longitude: -74.006,
          is_private: false,
        },
      ];
    };
    // Geo search always attempts OSM discovery; fail soft so this unit test stays offline.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network disabled in unit test');
    };
    try {
      const req = { validated: { lat: 40.7128, lng: -74.006, radius: 10 } };
      const res = { json(payload) {
        this.payload = payload;
      } };
      await searchCourts(req, res);
      assert.equal(whereArg.is_private, false);
      assert.equal(whereArg.deleted_at, null);
      assert.ok(whereArg.latitude);
      assert.ok(whereArg.longitude);
      assert.equal(res.payload?.data?.length, 1);
      assert.match(String(res.payload?.message || ''), /external discovery unavailable|successfully/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('GET /api/courts/:id (getCourt)', () => {
  it('returns 404 when no public row matches (e.g. private court)', async () => {
    let whereArg;
    CourtLocation.findOne = async (opts) => {
      whereArg = opts.where;
      return null;
    };
    const req = { params: { id: '99' } };
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(payload) {
        this.payload = payload;
      },
    };
    await getCourt(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(whereArg.id, 99);
    assert.equal(whereArg.is_private, false);
    assert.equal(whereArg.deleted_at, null);
    assert.equal(res.payload?.success, false);
    assert.match(res.payload?.message || '', /not found/i);
  });

  it('returns 200 for a public directory row', async () => {
    CourtLocation.findOne = async () => ({
      id: 1,
      name: 'Public',
      address_line1: '1 Main',
      city: 'New York',
      state: 'NY',
      postal_code: '10001',
      country: 'US',
      latitude: 40,
      longitude: -74,
      is_private: false,
      source: 'manual',
      created_at: new Date(),
      updated_at: new Date(),
    });
    const req = { params: { id: '1' } };
    const res = { json(payload) {
      this.payload = payload;
    } };
    await getCourt(req, res);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.is_private, false);
  });

  it('returns 400 for invalid id', async () => {
    const req = { params: { id: 'abc' } };
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(payload) {
        this.payload = payload;
      },
    };
    await getCourt(req, res);
    assert.equal(res.statusCode, 400);
  });
});

describe('Coach court lists (no public-directory privacy filter on court rows)', () => {
  it('GET /api/coaches/:id/courts — CourtLocation include only filters deleted_at', async () => {
    let courtIncludeWhere;
    User.findOne = async () => ({
      id: 1,
      is_active: true,
      deleted_at: null,
      userRoles: [{ role: 'coach' }],
      coachProfile: { deleted_at: null },
    });
    CoachCourtLocation.findAndCountAll = async (opts) => {
      const courtInc = opts.include.find((i) => i.as === 'court');
      courtIncludeWhere = courtInc.where;
      return { rows: [], count: 0 };
    };
    const req = { params: { id: '1' }, validated: {} };
    const res = {
      status(c) {
        this.statusCode = c;
        return this;
      },
      json() {},
    };
    await getCoachCourtsById(req, res);
    assert.deepEqual(courtIncludeWhere, { deleted_at: null });
  });

  it('GET /api/coaches/:id/courts — 404 when coach is suspended', async () => {
    User.findOne = async () => null; // findPublicActiveCoach finds nothing
    const req = { params: { id: '1' }, validated: {} };
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(payload) {
        this.payload = payload;
      },
    };
    await getCoachCourtsById(req, res);
    assert.equal(res.statusCode, 404);
  });

  it('GET /api/coaches/me/courts — CourtLocation include only filters deleted_at', async () => {
    let courtIncludeWhere;
    CoachCourtLocation.findAndCountAll = async (opts) => {
      const courtInc = opts.include.find((i) => i.as === 'court');
      courtIncludeWhere = courtInc.where;
      return { rows: [], count: 0 };
    };
    const req = { user: { id: 2, roles: ['coach'] }, validated: {} };
    const res = {
      status(c) {
        this.statusCode = c;
        return this;
      },
      json() {},
    };
    await getMyCoachCourts(req, res);
    assert.deepEqual(courtIncludeWhere, { deleted_at: null });
  });
});
