/**
 * Review create authorization — booking participation, not account roles.
 */
import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reviewSchema } from '../config/validation.js';
import { validateReviewCreateAuthorization } from '../utils/reviewCreateAuthorization.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const completedBooking = (overrides = {}) => ({
  primary_student_id: 10,
  coach_id: 20,
  status: 'completed',
  ...overrides,
});

describe('validateReviewCreateAuthorization', () => {
  it('allows primary student on a completed booking', () => {
    const result = validateReviewCreateAuthorization({
      userId: 10,
      booking: completedBooking(),
      hasExistingReview: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.targetUserId, 20);
  });

  it('allows dual-role user when they are primary_student_id (coach_id is someone else)', () => {
    const result = validateReviewCreateAuthorization({
      userId: 55,
      booking: completedBooking({ primary_student_id: 55, coach_id: 99 }),
      hasExistingReview: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.targetUserId, 99);
  });

  it('rejects coach on their own booking (not primary student)', () => {
    const result = validateReviewCreateAuthorization({
      userId: 20,
      booking: completedBooking(),
      hasExistingReview: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 403);
    assert.match(result.message, /student who booked/i);
  });

  it('rejects random user not on the booking', () => {
    const result = validateReviewCreateAuthorization({
      userId: 999,
      booking: completedBooking(),
      hasExistingReview: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 403);
  });

  it('rejects when booking is not completed', () => {
    const result = validateReviewCreateAuthorization({
      userId: 10,
      booking: completedBooking({ status: 'confirmed' }),
      hasExistingReview: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.match(result.message, /completed/i);
  });

  it('rejects duplicate review for the booking', () => {
    const result = validateReviewCreateAuthorization({
      userId: 10,
      booking: completedBooking(),
      hasExistingReview: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 409);
    assert.match(result.message, /already exists/i);
  });

  it('rejects self-review when reviewer would equal coach target', () => {
    const result = validateReviewCreateAuthorization({
      userId: 42,
      booking: completedBooking({ primary_student_id: 42, coach_id: 42 }),
      hasExistingReview: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.equal(result.message, 'You cannot review yourself.');
    assert.equal(result.code, 'cannot_review_self');
  });

  it('returns 404 when booking is missing', () => {
    const result = validateReviewCreateAuthorization({
      userId: 10,
      booking: null,
      hasExistingReview: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 404);
  });
});

describe('reviewSchema (POST body)', () => {
  test('strips target_user_id from validated payload (client cannot choose target)', () => {
    const { error, value } = reviewSchema.validate(
      {
        booking_id: 1,
        target_user_id: 999,
        rating: 5,
        comment: 'Great',
      },
      { stripUnknown: true, convert: true },
    );
    assert.equal(error, undefined);
    assert.equal(value.target_user_id, undefined);
    assert.equal(value.booking_id, 1);
    assert.equal(value.rating, 5);
  });
});

describe('createReview controller wiring', () => {
  it('uses validateReviewCreateAuthorization and sets target from booking coach', () => {
    const src = readFileSync(join(__dirname, '../controllers/reviewController.js'), 'utf8');
    const createBlock = src.slice(src.indexOf('export const createReview'), src.indexOf('export const updateReview'));
    assert.match(createBlock, /validateReviewCreateAuthorization/);
    assert.match(createBlock, /target_user_id: auth\.targetUserId/);
    assert.doesNotMatch(createBlock, /includes\('admin'\)/);
    assert.doesNotMatch(createBlock, /target_user_id.*req\.validated|req\.validated.*target_user_id/);
  });

  it('checks existing review by booking_id only', () => {
    const src = readFileSync(join(__dirname, '../controllers/reviewController.js'), 'utf8');
    const createBlock = src.slice(src.indexOf('export const createReview'), src.indexOf('export const updateReview'));
    assert.match(createBlock, /findOne\(\{\s*where:\s*\{\s*booking_id\s*\}/);
  });
});

describe('admin cannot create reviews via authorization helper', () => {
  it('admin user id that is not primary_student_id gets 403', () => {
    const result = validateReviewCreateAuthorization({
      userId: 1,
      booking: completedBooking({ primary_student_id: 10 }),
      hasExistingReview: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 403);
  });
});
