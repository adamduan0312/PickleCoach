/**
 * Marketplace eligibility — unit tests (no DB / no Stripe).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computeMarketplaceEligibilityFromSteps,
  getCoachMarketplaceEligibility,
  isStripeAccountReady,
  marketplaceDiscoveryProfileWhereBase,
  marketplaceDiscoveryIncludes,
  marketplaceEligibleCoachIncludeForLessonBrowse,
} from '../services/coachMarketplaceEligibility.js';
import { COACH_BIO_MIN, COACH_HEADLINE_MIN } from '../utils/coachProfileCompleteness.js';
import { Op } from 'sequelize';
import {
  User,
  CoachProfile,
  Lesson,
  CoachCourtLocation,
  CoachAvailability,
} from '../models/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coachControllerSrc = readFileSync(
  join(__dirname, '../controllers/coachController.js'),
  'utf8',
);
const lessonControllerSrc = readFileSync(
  join(__dirname, '../controllers/lessonController.js'),
  'utf8',
);
const getCoachesSection = coachControllerSrc.slice(
  coachControllerSrc.indexOf('export const getCoaches'),
  coachControllerSrc.indexOf('export const getCoachById'),
);
const getLessonsSection = lessonControllerSrc.slice(
  lessonControllerSrc.indexOf('export const getLessons'),
  lessonControllerSrc.indexOf('export const getCoachLessonsById'),
);
const getCoachLessonsSection = lessonControllerSrc.slice(
  lessonControllerSrc.indexOf('export const getCoachLessonsById'),
  lessonControllerSrc.indexOf('export const getAdminLessons'),
);

describe('computeMarketplaceEligibilityFromSteps', () => {
  it('lists when all steps true', () => {
    const out = computeMarketplaceEligibilityFromSteps({
      profile: true,
      stripe: true,
      lesson: true,
      court: true,
      availability: true,
    });
    assert.equal(out.listed, true);
    assert.deepEqual(out.missing, []);
  });

  it('reports missing stripe and availability without being listed', () => {
    const out = computeMarketplaceEligibilityFromSteps({
      profile: true,
      stripe: false,
      lesson: true,
      court: true,
      availability: false,
    });
    assert.equal(out.listed, false);
    assert.deepEqual(out.missing, ['stripe', 'availability']);
    assert.equal(out.steps.lesson, true);
  });
});

describe('getCoachMarketplaceEligibility profile step', () => {
  const originals = {};
  const COMPLETE = {
    headline: 'Patient coach for beginners',
    bio: 'I have coached pickleball for six years and focus on footwork and dinks.',
    location: 'Davie, FL',
    stripe_ready: true,
  };

  function stub(profile) {
    Object.assign(originals, {
      findByPk: User.findByPk,
      findOne: CoachProfile.findOne,
      lessonCount: Lesson.count,
      courtCount: CoachCourtLocation.count,
      availabilityCount: CoachAvailability.count,
    });
    User.findByPk = async () => ({
      id: 7,
      is_active: true,
      deleted_at: null,
      role_governance_locked: false,
      admin_allowed_roles: null,
      userRoles: [{ role: 'coach' }],
    });
    CoachProfile.findOne = async () => profile;
    Lesson.count = async () => 1;
    CoachCourtLocation.count = async () => 1;
    CoachAvailability.count = async () => 1;
  }

  afterEach(() => {
    User.findByPk = originals.findByPk;
    CoachProfile.findOne = originals.findOne;
    Lesson.count = originals.lessonCount;
    CoachCourtLocation.count = originals.courtCount;
    CoachAvailability.count = originals.availabilityCount;
  });

  it('complete profile satisfies the profile step', async () => {
    stub(COMPLETE);
    const out = await getCoachMarketplaceEligibility(7);
    assert.equal(out.listed, true);
    assert.equal(out.steps.profile, true);
    assert.equal(out.profile_exists, true);
    assert.deepEqual(out.profile_missing_fields, []);
  });

  it('draft profile exists but does not satisfy the profile step or listing', async () => {
    stub({ ...COMPLETE, headline: 'Coach', bio: '', location: null });
    const out = await getCoachMarketplaceEligibility(7);
    assert.equal(out.listed, false);
    assert.equal(out.steps.profile, false);
    assert.deepEqual(out.missing, ['profile']);
    assert.equal(out.profile_exists, true);
    assert.deepEqual(out.profile_missing_fields, ['headline', 'bio', 'location']);
  });

  it('no profile: profile_exists false and every required field missing', async () => {
    stub(null);
    const out = await getCoachMarketplaceEligibility(7);
    assert.equal(out.profile_exists, false);
    assert.equal(out.steps.profile, false);
    assert.deepEqual(out.profile_missing_fields, ['headline', 'bio', 'location']);
  });
});

describe('isStripeAccountReady', () => {
  it('requires payouts_enabled and details_submitted', () => {
    assert.equal(isStripeAccountReady({ payouts_enabled: true, details_submitted: true }), true);
    assert.equal(isStripeAccountReady({ payouts_enabled: true, details_submitted: false }), false);
    assert.equal(isStripeAccountReady({ payouts_enabled: false, details_submitted: true }), false);
    assert.equal(isStripeAccountReady(null), false);
  });
});

describe('discovery filters (DB-only)', () => {
  it('requires stripe_ready and a complete profile (headline ≥10, bio ≥50, location) on profile where base', () => {
    const base = marketplaceDiscoveryProfileWhereBase();
    assert.equal(base.deleted_at, null);
    assert.equal(base.stripe_ready, true);
    const conditions = base[Op.and];
    assert.equal(conditions.length, 3);
    const describeCond = (c) => ({
      column: c.attribute.args[0].args[0].col,
      fn: `${c.attribute.fn}(${c.attribute.args[0].fn})`,
      min: c.logic[Op.gte],
    });
    assert.deepEqual(conditions.map(describeCond), [
      { column: 'coachProfile.headline', fn: 'CHAR_LENGTH(TRIM)', min: COACH_HEADLINE_MIN },
      { column: 'coachProfile.bio', fn: 'CHAR_LENGTH(TRIM)', min: COACH_BIO_MIN },
      { column: 'coachProfile.location', fn: 'CHAR_LENGTH(TRIM)', min: 1 },
    ]);
    const nested = marketplaceDiscoveryProfileWhereBase({ alias: 'coach->coachProfile' });
    assert.equal(describeCond(nested[Op.and][0]).column, 'coach->coachProfile.headline');
  });

  it('requires courts, lessons, and availability includes', () => {
    const includes = marketplaceDiscoveryIncludes({ courtWhere: { deleted_at: null } });
    assert.equal(includes.length, 3);
    assert.equal(includes[0].as, 'coachCourts');
    assert.equal(includes[0].required, true);
    assert.equal(includes[1].as, 'lessons');
    assert.equal(includes[1].required, true);
    assert.equal(includes[2].as, 'availabilities');
    assert.equal(includes[2].required, true);
  });

  it('court eligibility does not require public (is_private: false) courts', () => {
    const includes = marketplaceDiscoveryIncludes();
    const courtWhere = includes[0].include[0].where;
    assert.equal(courtWhere.deleted_at, null);
    assert.equal(Object.prototype.hasOwnProperty.call(courtWhere, 'is_private'), false);

    const eligibilitySrc = readFileSync(
      join(__dirname, '../services/coachMarketplaceEligibility.js'),
      'utf8',
    );
    const courtCountBlock = eligibilitySrc.slice(
      eligibilitySrc.indexOf('CoachCourtLocation.count'),
      eligibilitySrc.indexOf('CoachAvailability.count'),
    );
    assert.match(courtCountBlock, /deleted_at:\s*null/);
    assert.doesNotMatch(courtCountBlock, /is_private/);
  });

  it('lesson-browse coach include omits nested lessons and uses shared profile/court/availability gates', () => {
    const coachInc = marketplaceEligibleCoachIncludeForLessonBrowse();
    assert.equal(coachInc.as, 'coach');
    assert.equal(coachInc.required, true);
    const aliases = coachInc.include.map((i) => i.as);
    assert.ok(aliases.includes('coachProfile'));
    assert.ok(aliases.includes('coachCourts'));
    assert.ok(aliases.includes('availabilities'));
    assert.ok(!aliases.includes('lessons'));
    const profile = coachInc.include.find((i) => i.as === 'coachProfile');
    assert.equal(profile.where.stripe_ready, true);
    assert.equal(profile.where[Op.and][0].attribute.args[0].args[0].col, 'coach->coachProfile.headline');
  });

  it('getCoaches uses marketplace helpers and never calls Stripe', () => {
    assert.match(getCoachesSection, /marketplaceDiscoveryProfileWhereBase/);
    assert.match(getCoachesSection, /marketplaceDiscoveryIncludes/);
    assert.doesNotMatch(getCoachesSection, /stripe\.accounts/);
    assert.doesNotMatch(getCoachesSection, /accounts\.retrieve/);
  });

  it('GET /api/lessons catalog is removed (410)', () => {
    assert.match(getLessonsSection, /410/);
    assert.match(getLessonsSection, /lesson_catalog_removed/);
  });

  it('GET /api/coaches/:id/lessons gates on marketplace eligibility', () => {
    assert.match(getCoachLessonsSection, /getCoachMarketplaceEligibility/);
    assert.match(getCoachLessonsSection, /is_active:\s*true/);
    assert.match(getCoachLessonsSection, /deleted_at:\s*null/);
  });

  it('GET /api/coaches/:id/lessons allows coach role (marketplace browse ≠ student-only)', () => {
    const routesSrc = readFileSync(join(__dirname, '../routes/coachRoutes.js'), 'utf8');
    const block = routesSrc.slice(
      routesSrc.indexOf('/:id/lessons'),
      routesSrc.indexOf("router.get('/:id'"),
    );
    assert.match(block, /authorize\('student',\s*'coach',\s*'admin'\)/);
    assert.match(block, /getCoachLessonsById/);
  });

  it('mounts GET /api/coaches/:id/lessons and marketplace-status before /:id', () => {
    const routesSrc = readFileSync(join(__dirname, '../routes/coachRoutes.js'), 'utf8');
    const statusIdx = routesSrc.indexOf('/me/marketplace-status');
    const lessonsIdx = routesSrc.indexOf('/:id/lessons');
    const idIdx = routesSrc.indexOf("'/:id'");
    assert.ok(statusIdx > -1 && idIdx > statusIdx);
    assert.ok(lessonsIdx > -1);
    assert.match(routesSrc, /getCoachLessonsById/);
    assert.match(routesSrc, /getMyMarketplaceStatus/);
  });
});
