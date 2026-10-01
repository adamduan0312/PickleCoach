import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  compareMarketplaceCoaches,
  marketplaceTrustScore,
  sortMarketplaceCoaches,
} from '../utils/marketplaceCoachRank.js';
import { sameSystemSkillDistance } from '../utils/coachRating.js';

describe('marketplaceCoachRank', () => {
  it('scores trust with reliability and review volume (not reliability alone)', () => {
    const highRelNoReviews = marketplaceTrustScore({
      reliability_score: 100,
      rating_average: 0,
      rating_count: 0,
    });
    const strongReviews = marketplaceTrustScore({
      reliability_score: 90,
      rating_average: 4.9,
      rating_count: 35,
    });
    assert.ok(strongReviews > highRelNoReviews);
  });

  it('with location: nearer coaches first', () => {
    const ids = sortMarketplaceCoaches([
      { id: 2, distance_miles: 18, reliability_score: 100, rating_average: 5, rating_count: 10 },
      { id: 1, distance_miles: 2, reliability_score: 80, rating_average: 4, rating_count: 2 },
    ], { hasLocation: true }).map((c) => c.id);
    assert.deepEqual(ids, [1, 2]);
  });

  it('DUPR skill-only: closer DUPR fit first', () => {
    assert.equal(
      sameSystemSkillDistance({ skill_rating: 4.217, rating_system: 'DUPR' }, { ratingSystem: 'DUPR', minSkill: 4, maxSkill: 4.5 }),
      Math.abs(4.217 - 4.25),
    );
    const ids = sortMarketplaceCoaches([
      { id: 1, skill_rating: 4.0, rating_system: 'DUPR', reliability_score: 100, rating_average: 5, rating_count: 10 },
      { id: 2, skill_rating: 4.217, rating_system: 'DUPR', reliability_score: 80, rating_average: 4, rating_count: 2 },
    ], { ratingSystem: 'DUPR', minSkill: 4.0, maxSkill: 4.5 }).map((c) => c.id);
    assert.deepEqual(ids, [2, 1]);
  });

  it('UTR-P skill-only: closer UTR-P fit first', () => {
    const ids = sortMarketplaceCoaches([
      { id: 1, skill_rating: 4.5, rating_system: 'UTR-P', reliability_score: 100, rating_average: 5, rating_count: 10 },
      { id: 2, skill_rating: 9.5, rating_system: 'UTR-P', reliability_score: 50, rating_average: 3, rating_count: 1 },
    ], { ratingSystem: 'UTR-P', minSkill: 9.0, maxSkill: 10.0 }).map((c) => c.id);
    assert.deepEqual(ids, [2, 1]);
  });

  it('never compares across systems: a UTR-P value equal to the DUPR target is not a fit', () => {
    const opts = { ratingSystem: 'DUPR', minSkill: 4.5, maxSkill: 4.5 };
    assert.equal(sameSystemSkillDistance({ skill_rating: 4.5, rating_system: 'UTR-P' }, opts), Number.POSITIVE_INFINITY);
    assert.equal(sameSystemSkillDistance({ skill_rating: 4.5, rating_system: null }, opts), Number.POSITIVE_INFINITY);
    assert.equal(sameSystemSkillDistance({ skill_rating: 4.5, rating_system: 'DUPR' }, opts), 0);
    const ids = sortMarketplaceCoaches([
      { id: 1, skill_rating: 4.5, rating_system: 'UTR-P', reliability_score: 100, rating_average: 5, rating_count: 50 },
      { id: 2, skill_rating: 7.218, rating_system: 'DUPR', reliability_score: 10, rating_average: 1, rating_count: 0 },
    ], opts).map((c) => c.id);
    assert.deepEqual(ids, [2, 1]);
  });

  it('Any system: skill bounds without a rating system do not affect ranking', () => {
    const coaches = [
      { id: 1, skill_rating: 7.218, rating_system: 'DUPR', reliability_score: 90, rating_average: 5, rating_count: 20 },
      { id: 2, skill_rating: 4.5, rating_system: 'UTR-P', reliability_score: 50, rating_average: 3, rating_count: 1 },
    ];
    const withBounds = sortMarketplaceCoaches(coaches, { minSkill: 4.5, maxSkill: 4.5 }).map((c) => c.id);
    const plain = sortMarketplaceCoaches(coaches, {}).map((c) => c.id);
    assert.deepEqual(withBounds, plain);
    assert.deepEqual(plain, [1, 2]);
  });

  it('location + skill: distance then same-system skill fit', () => {
    const ids = sortMarketplaceCoaches([
      { id: 3, distance_miles: 5, skill_rating: 4.0, rating_system: 'DUPR', reliability_score: 100, rating_average: 5, rating_count: 20 },
      { id: 2, distance_miles: 2, skill_rating: 4.5, rating_system: 'DUPR', reliability_score: 70, rating_average: 3, rating_count: 1 },
      { id: 1, distance_miles: 2, skill_rating: 4.217, rating_system: 'DUPR', reliability_score: 70, rating_average: 3, rating_count: 1 },
    ], { hasLocation: true, ratingSystem: 'DUPR', minSkill: 4.0, maxSkill: 4.5 }).map((c) => c.id);
    assert.deepEqual(ids, [1, 2, 3]);
  });

  it('no location/skill: trust then id', () => {
    const cmp = compareMarketplaceCoaches(
      { id: 2, reliability_score: 50, rating_average: 3, rating_count: 1 },
      { id: 1, reliability_score: 95, rating_average: 4.8, rating_count: 20 },
      {},
    );
    assert.ok(cmp > 0);
  });

  it('coach list query scopes skill filtering to the requested rating system', () => {
    const src = readFileSync(new URL('../controllers/coachController.js', import.meta.url), 'utf8');
    assert.match(src, /if \(rating_system\) \{\s*profileWhereParts\.push\(\{ rating_system, skill_rating: \{ \[Op\.ne\]: null \} \}\);/);
    assert.match(src, /ratingSystem: rating_system \?\? null/);
  });
});
