/**
 * POST /api/coaches/me/courts — link existing court (no teaching-area distance limit).
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { addCoachCourt } from '../controllers/courtController.js';
import { CourtLocation, CoachCourtLocation } from '../models/index.js';

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

describe('addCoachCourt — no teaching-area distance limit', () => {
  let origFindOne;
  let origFindByPk;
  let origLinkFindOne;
  let origLinkCreate;
  let origLinkFindByPk;

  beforeEach(() => {
    origFindOne = CourtLocation.findOne;
    origFindByPk = CourtLocation.findByPk;
    origLinkFindOne = CoachCourtLocation.findOne;
    origLinkCreate = CoachCourtLocation.create;
    origLinkFindByPk = CoachCourtLocation.findByPk;
  });

  afterEach(() => {
    CourtLocation.findOne = origFindOne;
    CourtLocation.findByPk = origFindByPk;
    CoachCourtLocation.findOne = origLinkFindOne;
    CoachCourtLocation.create = origLinkCreate;
    CoachCourtLocation.findByPk = origLinkFindByPk;
  });

  it('links a court hundreds of miles from the coach existing courts', async () => {
    const nycCourt = {
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
      deleted_at: null,
    };
    CourtLocation.findOne = async () => nycCourt;
    CourtLocation.findByPk = async () => nycCourt;
    CoachCourtLocation.findOne = async () => null;
    CoachCourtLocation.create = async () => ({
      id: 91,
      coach_id: 3,
      court_id: 88,
      coach_notes: null,
    });
    CoachCourtLocation.findByPk = async () => ({
      id: 91,
      coach_id: 3,
      court_id: 88,
      coach_notes: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const req = {
      body: { court_id: 88 },
      user: { id: 3, roles: ['coach'] },
    };
    const res = mockRes();
    await addCoachCourt(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.message, 'Court added successfully');
    assert.equal(res.payload.data.court.id, 88);
    assert.equal(res.payload.data.coachCourt.court_id, 88);
  });
});
