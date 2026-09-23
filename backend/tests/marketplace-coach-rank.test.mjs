import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareMarketplaceCoaches,
  marketplaceTrustScore,
  skillFitDistance,
  sortMarketplaceCoaches,
} from '../utils/marketplaceCoachRank.js';

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

  it('skill-only: closer skill fit first', () => {
    assert.equal(skillFitDistance(4.2, { minSkill: 4.0, maxSkill: 4.5 }), Math.abs(4.2 - 4.25));
    const ids = sortMarketplaceCoaches([
      { id: 1, skill_rating: 4.0, reliability_score: 100, rating_average: 5, rating_count: 10 },
      { id: 2, skill_rating: 4.25, reliability_score: 80, rating_average: 4, rating_count: 2 },
    ], { minSkill: 4.0, maxSkill: 4.5 }).map((c) => c.id);
    assert.deepEqual(ids, [2, 1]);
  });

  it('location + skill: distance then skill fit', () => {
    const ids = sortMarketplaceCoaches([
      { id: 3, distance_miles: 5, skill_rating: 4.0, reliability_score: 100, rating_average: 5, rating_count: 20 },
      { id: 2, distance_miles: 2, skill_rating: 4.5, reliability_score: 70, rating_average: 3, rating_count: 1 },
      { id: 1, distance_miles: 2, skill_rating: 4.2, reliability_score: 70, rating_average: 3, rating_count: 1 },
    ], { hasLocation: true, minSkill: 4.0, maxSkill: 4.5 }).map((c) => c.id);
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
});
