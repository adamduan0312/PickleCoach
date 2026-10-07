/**
 * Court privacy is per coach (coach_court_locations.is_private), not per shared court.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { createCourt, addCoachCourt, getCoachCourtsById } from '../controllers/courtController.js';
import { CourtLocation, CoachCourtLocation, User } from '../models/index.js';
import {
  coachCourtIsPrivate,
  courtForCoachLink,
  serializeCourtForPublicViewer,
} from '../utils/courtAddressVisibility.js';
import { serializeCoachListItem } from '../utils/userDto.js';

const facility = {
  id: 7,
  name: 'Weston Regional Park',
  address_line1: '20200 Saddle Club Rd',
  city: 'Weston',
  state: 'FL',
  postal_code: '33327',
  country: 'US',
  latitude: 26.1,
  longitude: -80.4,
  is_private: false,
  deleted_at: null,
};

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
}

describe('coachCourtIsPrivate / courtForCoachLink', () => {
  it('uses the coach link; a court added as private stays private for every coach', () => {
    assert.equal(coachCourtIsPrivate({ is_private: true }, facility), true);
    assert.equal(coachCourtIsPrivate({ is_private: false }, facility), false);
    assert.equal(coachCourtIsPrivate({ is_private: false }, { ...facility, is_private: true }), true);
  });

  it('same shared court: redacted for the private coach, full address for the public coach', () => {
    const forA = serializeCourtForPublicViewer(courtForCoachLink({ is_private: true }, facility));
    const forB = serializeCourtForPublicViewer(courtForCoachLink({ is_private: false }, facility));
    assert.equal(forA.is_private, true);
    assert.equal(forA.address_line1, null);
    assert.equal(forA.latitude, null);
    assert.equal(forA.area, 'Weston, FL 33327');
    assert.equal(forB.is_private, false);
    assert.equal(forB.address_line1, '20200 Saddle Club Rd');
  });

  it('marketplace list item redacts per coach link', () => {
    const item = serializeCoachListItem({
      id: 1,
      full_name: 'Coach A',
      coachProfile: {},
      coachCourts: [{ is_private: true, court: facility }],
    });
    assert.equal(item.courts[0].is_private, true);
    assert.equal(item.courts[0].address_line1, null);
  });
});

describe('coach court privacy endpoints', () => {
  const saved = {};
  beforeEach(() => {
    for (const [model, keys] of [[CourtLocation, ['findOne', 'findAll', 'create', 'findByPk']], [CoachCourtLocation, ['findOne', 'findAll', 'create', 'findByPk', 'findAndCountAll']], [User, ['findOne', 'findByPk']]]) {
      for (const k of keys) saved[`${model.name}.${k}`] = [model, k, model[k]];
    }
    CourtLocation.findAll = async () => [];
    CoachCourtLocation.findAll = async () => [];
  });
  afterEach(() => {
    for (const [model, k, fn] of Object.values(saved)) model[k] = fn;
  });

  it('POST /api/courts reusing a public court marks only this coach’s link private', async () => {
    let courtUpdated = false;
    let linkAttrs;
    CourtLocation.findOne = async () => ({ ...facility, update: async () => { courtUpdated = true; } });
    CourtLocation.findByPk = async () => facility;
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async (attrs) => { linkAttrs = attrs; return { id: 50, ...attrs }; };
    CoachCourtLocation.findByPk = async () => ({ id: 50, ...linkAttrs });
    const body = { ...facility, is_private: true };
    const res = mockRes();
    await createCourt({ validated: body, body, user: { id: 3, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(linkAttrs.is_private, true);
    assert.equal(courtUpdated, false);
  });

  it('POST /api/coaches/me/courts toggles privacy on an existing link', async () => {
    let patch;
    CourtLocation.findOne = async () => facility;
    CourtLocation.findByPk = async () => facility;
    CoachCourtLocation.findOne = async () => ({ id: 50, update: async (p) => { patch = p; } });
    CoachCourtLocation.findByPk = async () => ({ id: 50, is_private: true });
    const res = mockRes();
    await addCoachCourt({ body: { court_id: 7, is_private: true }, user: { id: 3, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(patch, { is_private: true });
  });

  it('POST /api/coaches/me/courts cannot make a court added as private public', async () => {
    CourtLocation.findOne = async () => ({ ...facility, is_private: true });
    const res = mockRes();
    await addCoachCourt({ body: { court_id: 7, is_private: false }, user: { id: 3, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 400);
  });

  it('POST /api/coaches/me/courts rejects a non-boolean is_private', async () => {
    const res = mockRes();
    await addCoachCourt({ body: { court_id: 7, is_private: 'yes' }, user: { id: 3, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 400);
  });

  it('GET /api/coaches/:id/courts redacts by the coach link', async () => {
    User.findOne = async () => ({ id: 1, is_active: true, deleted_at: null, userRoles: [{ role: 'coach' }], roles: ['coach'] });
    User.findByPk = User.findOne;
    CoachCourtLocation.findAndCountAll = async () => ({
      count: 1,
      rows: [{ is_private: true, court: facility }],
    });
    const res = mockRes();
    await getCoachCourtsById({ params: { id: '1' }, validated: {} }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(res.payload.data[0].address_line1, null);
    assert.equal(res.payload.data[0].area, 'Weston, FL 33327');
  });
});
