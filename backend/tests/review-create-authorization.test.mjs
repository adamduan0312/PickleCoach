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
    assert.equal(result.coachId, 20);
  });

  it('allows dual-role user when they are primary_student_id (coach_id is someone else)', () => {
    const result = validateReviewCreateAuthorization({
      userId: 55,
      booking: completedBooking({ primary_student_id: 55, coach_id: 99 }),
      hasExistingReview: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.coachId, 99);
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

  it('rejects self-review when student would equal coach', () => {
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
  test('accepts booking_id + rating; comment optional', () => {
    const { error, value } = reviewSchema.validate(
      { booking_id: 162, rating: 5 },
      { stripUnknown: true, convert: true },
    );
    assert.equal(error, undefined);
    assert.equal(value.booking_id, 162);
    assert.equal(value.rating, 5);
    assert.equal(value.comment, undefined);
  });

  test('strips coach_id / student_id from validated payload (client cannot choose parties)', () => {
    const { error, value } = reviewSchema.validate(
      {
        booking_id: 1,
        coach_id: 999,
        student_id: 888,
        target_user_id: 777,
        rating: 5,
        comment: 'Great',
      },
      { stripUnknown: true, convert: true },
    );
    assert.equal(error, undefined);
    assert.equal(value.coach_id, undefined);
    assert.equal(value.student_id, undefined);
    assert.equal(value.target_user_id, undefined);
    assert.equal(value.booking_id, 1);
    assert.equal(value.rating, 5);
  });

  test('strips unknown body fields', () => {
    const { error, value } = reviewSchema.validate(
      {
        booking_id: 162,
        rating: 5,
        comment: 'Great lesson!',
        attendance_badges: ['on_time'],
        visibility: 'private',
        coach_id: 999,
      },
      { stripUnknown: true, convert: true },
    );
    assert.equal(error, undefined);
    assert.deepEqual(value, {
      booking_id: 162,
      rating: 5,
      comment: 'Great lesson!',
    });
  });
});

describe('createReview controller wiring', () => {
  it('uses validateReviewCreateAuthorization and sets coach from booking', () => {
    const src = readFileSync(join(__dirname, '../controllers/reviewController.js'), 'utf8');
    const createBlock = src.slice(src.indexOf('export const createReview'), src.indexOf('export const updateReview'));
    assert.match(createBlock, /validateReviewCreateAuthorization/);
    assert.match(createBlock, /coach_id: auth\.coachId/);
    assert.match(createBlock, /student_id: req\.user\.id/);
    assert.doesNotMatch(createBlock, /includes\('admin'\)/);
    assert.doesNotMatch(createBlock, /coach_id.*req\.validated|req\.validated.*coach_id/);
    assert.doesNotMatch(createBlock, /attendance_badges/);
    assert.doesNotMatch(createBlock, /visibility/);
  });

  it('checks existing review by booking_id only', () => {
    const src = readFileSync(join(__dirname, '../controllers/reviewController.js'), 'utf8');
    const createBlock = src.slice(src.indexOf('export const createReview'), src.indexOf('export const updateReview'));
    assert.match(createBlock, /findOne\(\{\s*where:\s*\{\s*booking_id\s*\}/);
    assert.match(createBlock, /SequelizeUniqueConstraintError/);
  });

  it('declares UNIQUE(booking_id) on the Review model', () => {
    const src = readFileSync(join(__dirname, '../models/Review.js'), 'utf8');
    assert.match(src, /reviews_booking_id_unique/);
    assert.match(src, /unique:\s*true/);
  });

  it('requires student role + verified email on POST /reviews', () => {
    const src = readFileSync(join(__dirname, '../routes/reviewRoutes.js'), 'utf8');
    assert.match(src, /authorize\('student'\)/);
    assert.match(src, /requireVerifiedEmail/);
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
