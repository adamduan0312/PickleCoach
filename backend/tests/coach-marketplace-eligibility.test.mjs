/**
 * Marketplace eligibility — unit tests (no DB / no Stripe).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computeMarketplaceEligibilityFromSteps,
  isStripeAccountReady,
  marketplaceDiscoveryProfileWhereBase,
  marketplaceDiscoveryIncludes,
  marketplaceEligibleCoachIncludeForLessonBrowse,
} from '../services/coachMarketplaceEligibility.js';

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
  lessonControllerSrc.indexOf('export const getMyLessons'),
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

describe('isStripeAccountReady', () => {
  it('requires payouts_enabled and details_submitted', () => {
    assert.equal(isStripeAccountReady({ payouts_enabled: true, details_submitted: true }), true);
    assert.equal(isStripeAccountReady({ payouts_enabled: true, details_submitted: false }), false);
    assert.equal(isStripeAccountReady({ payouts_enabled: false, details_submitted: true }), false);
    assert.equal(isStripeAccountReady(null), false);
  });
});

describe('discovery filters (DB-only)', () => {
  it('requires stripe_ready on profile where base', () => {
    assert.deepEqual(marketplaceDiscoveryProfileWhereBase(), {
      deleted_at: null,
      stripe_ready: true,
    });
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
  });

  it('getCoaches uses marketplace helpers and never calls Stripe', () => {
    assert.match(getCoachesSection, /marketplaceDiscoveryProfileWhereBase/);
    assert.match(getCoachesSection, /marketplaceDiscoveryIncludes/);
    assert.doesNotMatch(getCoachesSection, /stripe\.accounts/);
    assert.doesNotMatch(getCoachesSection, /accounts\.retrieve/);
  });

  it('GET /api/lessons uses shared marketplace coach include (public discovery)', () => {
    assert.match(getLessonsSection, /marketplaceEligibleCoachIncludeForLessonBrowse/);
  });

  it('mounts GET /api/coaches/me/marketplace-status before /:id', () => {
    const routesSrc = readFileSync(join(__dirname, '../routes/coachRoutes.js'), 'utf8');
    const statusIdx = routesSrc.indexOf('/me/marketplace-status');
    const idIdx = routesSrc.indexOf("'/:id'");
    assert.ok(statusIdx > -1 && idIdx > statusIdx);
    assert.match(routesSrc, /getMyMarketplaceStatus/);
  });
});
