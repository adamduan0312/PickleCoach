/**
 * Coach rating recalculation when reviews change.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { averageReviewRatings } from '../utils/recalculateCoachRating.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('averageReviewRatings', () => {
  it('returns zeros when there are no reviews', () => {
    assert.deepEqual(averageReviewRatings([]), { rating_average: 0, rating_count: 0 });
  });

  it('recomputes average when a rating changes (5→3 among peers)', () => {
    // Before: 5, 5, 4.4 → average 4.8
    const before = averageReviewRatings([5, 5, 4.4]);
    assert.equal(Number(before.rating_average.toFixed(1)), 4.8);

    // After editing first review 5→3: 3, 5, 4.4
    const after = averageReviewRatings([3, 5, 4.4]);
    assert.equal(after.rating_count, 3);
    assert.ok(after.rating_average < before.rating_average);
    assert.equal(Number(after.rating_average.toFixed(2)), 4.13);
  });
});

describe('reviewController rating recalculation wiring', () => {
  const src = readFileSync(join(__dirname, '../controllers/reviewController.js'), 'utf8');

  it('recalculates on create', () => {
    const block = src.slice(src.indexOf('export const createReview'), src.indexOf('export const updateReview'));
    assert.match(block, /recalculateCoachRatingFromReviews/);
  });

  it('recalculates on update when rating changes', () => {
    const block = src.slice(src.indexOf('export const updateReview'), src.indexOf('export const deleteReview'));
    assert.match(block, /ratingChanged/);
    assert.match(block, /recalculateCoachRatingFromReviews\(review\.coach_id\)/);
  });

  it('recalculates on delete', () => {
    const block = src.slice(src.indexOf('export const deleteReview'));
    assert.match(block, /recalculateCoachRatingFromReviews\(coachUserId\)/);
  });
});
