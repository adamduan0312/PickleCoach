/**
 * Discovery role hydration — GET /api/coaches and GET /api/coaches/:id.
 *
 * Both handlers re-check roles in JS via getEffectiveRolesForUserRecord(coach), which reads
 * coach.userRoles. A `userRoles` include with `attributes: []` filters correctly in SQL but
 * leaves that association unhydrated, so every eligible coach was silently dropped
 * (empty list / 404). These tests pin the hydration and the public payload shape.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  User,
  CoachProfile,
  Lesson,
  CoachCourtLocation,
  CoachAvailability,
} from '../models/index.js';
import { getCoaches, getCoachById } from '../controllers/coachController.js';

const orig = {
  findAndCountAll: User.findAndCountAll,
  findOne: User.findOne,
  findByPk: User.findByPk,
  profileFindOne: CoachProfile.findOne,
  lessonCount: Lesson.count,
  courtCount: CoachCourtLocation.count,
  availabilityCount: CoachAvailability.count,
};

afterEach(() => {
  User.findAndCountAll = orig.findAndCountAll;
  User.findOne = orig.findOne;
  User.findByPk = orig.findByPk;
  CoachProfile.findOne = orig.profileFindOne;
  Lesson.count = orig.lessonCount;
  CoachCourtLocation.count = orig.courtCount;
  CoachAvailability.count = orig.availabilityCount;
});

function mockRes() {
  return {
    statusCode: 200,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(payload) {
      this.payload = payload;
    },
  };
}

/**
 * Marketplace-eligible coach row as Sequelize returns it: active account, coach role,
 * stripe_ready profile, one court, governance unlocked.
 */
function eligibleCoachRow(overrides = {}) {
  const row = {
    id: 68,
    full_name: 'Pending Stripe Coach',
    avatar_url: null,
    timezone: 'America/New_York',
    is_active: true,
    deleted_at: null,
    role_governance_locked: false,
    admin_allowed_roles: null,
    userRoles: [{ role: 'coach' }],
    coachProfile: {
      id: 12,
      user_id: 68,
      headline: 'Brooklyn coach',
      bio: 'Bio',
      experience_years: 3,
      skill_rating: '4.00',
      rating_system: 'self',
      certifications: null,
      location: 'Brooklyn, NY',
      rating_average: '0.00',
      rating_count: 0,
      stripe_ready: true,
    },
    reliabilities: [{ role: 'coach', reliability_score: 100, last_updated: null }],
    coachCourts: [
      {
        id: 5,
        coach_id: 68,
        court_id: 76,
        court: {
          id: 76,
          name: 'Pending-Stripe Court A',
          city: 'Brooklyn',
          state: 'NY',
          latitude: '40.6993',
          longitude: '-73.9972',
          is_private: false,
          deleted_at: null,
        },
      },
    ],
    ...overrides,
  };
  row.toJSON = () => ({ ...row });
  return row;
}

describe('GET /api/coaches role hydration', () => {
  it('hydrates userRoles.role so eligible coaches survive the effective-roles filter', async () => {
    let capturedInclude = null;
    User.findAndCountAll = async (opts) => {
      capturedInclude = opts.include;
      return { count: 1, rows: [eligibleCoachRow()] };
    };

    const res = mockRes();
    await getCoaches({ user: { id: 9, roles: ['student'] }, validated: {} }, res);

    const userRolesInclude = capturedInclude.find((i) => i.as === 'userRoles');
    assert.deepEqual(
      userRolesInclude.attributes,
      ['role'],
      'userRoles must be hydrated; attributes: [] drops every coach in the JS filter',
    );
    assert.equal(userRolesInclude.required, true);
    assert.equal(userRolesInclude.where.role, 'coach');

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.data?.length, 1);
    assert.equal(res.payload.data[0].id, 68);
  });

  it('does not expose userRoles on the public coach card', async () => {
    User.findAndCountAll = async () => ({ count: 1, rows: [eligibleCoachRow()] });

    const res = mockRes();
    await getCoaches({ user: { id: 9, roles: ['student'] }, validated: {} }, res);

    const card = res.payload.data[0];
    assert.equal(card.userRoles, undefined);
    assert.equal(card.user_roles, undefined);
    assert.equal(card.roles, undefined);
    assert.equal(card.is_active, undefined);
    assert.equal(card.email, undefined);
  });

  it('drops a coach whose governance allow-list revokes the coach role', async () => {
    User.findAndCountAll = async () => ({
      count: 1,
      rows: [
        eligibleCoachRow({
          role_governance_locked: true,
          admin_allowed_roles: ['student'],
        }),
      ],
    });

    const res = mockRes();
    await getCoaches({ user: { id: 9, roles: ['student'] }, validated: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.data, []);
  });

  it('reflects filtered rows in the paginated count', async () => {
    User.findAndCountAll = async () => ({
      count: 2,
      rows: [
        eligibleCoachRow(),
        eligibleCoachRow({
          id: 69,
          role_governance_locked: true,
          admin_allowed_roles: ['student'],
        }),
      ],
    });

    const res = mockRes();
    await getCoaches({ user: { id: 9, roles: ['student'] }, validated: {} }, res);

    assert.equal(res.payload.data.length, 1);
    assert.equal(res.payload.data[0].id, 68);
  });
});

describe('GET /api/coaches/:id role hydration', () => {
  function stubEligibilityLookups(row) {
    User.findByPk = async () => row;
    CoachProfile.findOne = async () => ({ stripe_ready: true });
    Lesson.count = async () => 1;
    CoachCourtLocation.count = async () => 1;
    CoachAvailability.count = async () => 1;
  }

  it('returns the coach when userRoles is hydrated', async () => {
    const row = eligibleCoachRow({ lessons: [], availabilities: [], reviewsReceived: [] });
    let capturedInclude = null;
    User.findOne = async (opts) => {
      capturedInclude = opts.include;
      return row;
    };
    stubEligibilityLookups(row);

    const res = mockRes();
    await getCoachById({ params: { id: '68' }, user: { id: 9, roles: ['student'] } }, res);

    const userRolesInclude = capturedInclude.find((i) => i.as === 'userRoles');
    assert.deepEqual(
      userRolesInclude.attributes,
      ['role'],
      'userRoles must be hydrated; attributes: [] turns every coach into a 404',
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.data?.id, 68);
    assert.equal(res.payload.data.userRoles, undefined);
  });

  it('404s when governance revokes the coach role', async () => {
    const row = eligibleCoachRow({
      role_governance_locked: true,
      admin_allowed_roles: ['student'],
      lessons: [],
      availabilities: [],
      reviewsReceived: [],
    });
    User.findOne = async () => row;
    stubEligibilityLookups(row);

    const res = mockRes();
    await getCoachById({ params: { id: '68' }, user: { id: 9, roles: ['student'] } }, res);

    assert.equal(res.statusCode, 404);
  });
});
