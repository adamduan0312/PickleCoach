/**
 * Review API response DTOs.
 */

import { serializeUserPartySummary } from './bookingDto.js';

export const REVIEW_PUBLIC_FIELD_NAMES = [
  'id',
  'booking_id',
  'student_id',
  'coach_id',
  'rating',
  'comment',
  'created_at',
  'updated_at',
];

/** Booking context on a review — no payment/lifecycle internals. */
export const REVIEW_BOOKING_FIELD_NAMES = [
  'id',
  'scheduled_at',
  'status',
  'lesson_id',
  'coach_id',
  'primary_student_id',
];

function toPlain(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  if (typeof row.toJSON === 'function') return row.toJSON();
  return { ...row };
}

function pickFields(plain, fieldNames) {
  const dto = {};
  for (const key of fieldNames) {
    if (plain[key] !== undefined) dto[key] = plain[key];
  }
  return dto;
}

export function serializeReviewBookingSummary(booking) {
  if (!booking) return null;
  return pickFields(toPlain(booking), REVIEW_BOOKING_FIELD_NAMES);
}

/**
 * List/detail review for authenticated consumers.
 * Trims nested booking; keeps student/coach party summaries.
 */
export function serializeReview(review) {
  if (!review) return null;
  const plain = toPlain(review);
  const dto = pickFields(plain, REVIEW_PUBLIC_FIELD_NAMES);
  if (plain.booking !== undefined) {
    dto.booking = serializeReviewBookingSummary(plain.booking);
  }
  if (plain.student !== undefined) {
    dto.student = serializeUserPartySummary(plain.student);
  }
  if (plain.coach !== undefined) {
    dto.coach = serializeUserPartySummary(plain.coach);
  }
  return dto;
}

/**
 * Coach-profile embed — rating/comment only (no booking internals).
 */
export function serializePublicReviewCard(review) {
  if (!review) return null;
  const plain = toPlain(review);
  return {
    id: plain.id,
    rating: plain.rating ?? null,
    comment: plain.comment ?? null,
    created_at: plain.created_at ?? null,
    updated_at: plain.updated_at ?? null,
    student: serializeUserPartySummary(plain.student),
  };
}
