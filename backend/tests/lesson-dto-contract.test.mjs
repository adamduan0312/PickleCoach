/**
 * Lesson response DTO contract — marketplace / owner / admin / detail shapes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  serializePublicMarketplaceLesson,
  serializeCoachOwnerLesson,
  serializeAdminLesson,
  serializeLessonDetail,
  PUBLIC_MARKETPLACE_LESSON_FIELDS,
  COACH_OWNER_LESSON_FIELDS,
  ADMIN_LESSON_FIELDS,
} from '../utils/lessonDto.js';

const fullLesson = {
  id: 29,
  coach_id: 37,
  title: 'Beginner Pickleball',
  description: 'Learn the basics',
  duration_minutes: 60,
  price: '60.00',
  effective_hourly_rate: 60,
  max_students: 1,
  is_active: true,
  deleted_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: 'should-never-appear',
  coach: {
    id: 37,
    full_name: 'Coach Bob',
    email: 'bob@example.com',
    avatar_url: 'https://example.com/a.png',
    is_active: true,
    deleted_at: null,
    password_hash: 'secret',
  },
  bookings: [{ id: 1, status: 'confirmed' }],
};

function assertExactKeys(obj, expected) {
  assert.deepEqual(Object.keys(obj).sort(), [...expected].sort());
}

describe('serializePublicMarketplaceLesson', () => {
  it('includes only bookable offering fields', () => {
    const dto = serializePublicMarketplaceLesson(fullLesson);
    assertExactKeys(dto, PUBLIC_MARKETPLACE_LESSON_FIELDS);
    assert.equal(dto.id, 29);
    assert.equal(dto.price, '60.00');
    assert.equal(dto.effective_hourly_rate, 60);
    assert.equal(dto.is_active, undefined);
    assert.equal(dto.deleted_at, undefined);
    assert.equal(dto.created_at, undefined);
    assert.equal(dto.coach, undefined);
    assert.equal(dto.bookings, undefined);
    assert.equal(dto.updated_at, undefined);
  });
});

describe('serializeCoachOwnerLesson', () => {
  it('includes management fields without nested coach', () => {
    const dto = serializeCoachOwnerLesson(fullLesson);
    assertExactKeys(dto, COACH_OWNER_LESSON_FIELDS);
    assert.equal(dto.is_active, true);
    assert.equal(dto.created_at, '2026-07-01T00:00:00.000Z');
    assert.equal(dto.coach, undefined);
    assert.equal(dto.deleted_at, undefined);
    assert.equal(dto.bookings, undefined);
  });
});

describe('serializeAdminLesson', () => {
  it('includes lifecycle fields and trimmed coach (email, no avatar)', () => {
    const dto = serializeAdminLesson(fullLesson);
    assertExactKeys(dto, [...ADMIN_LESSON_FIELDS, 'coach']);
    assert.equal(dto.deleted_at, null);
    assert.deepEqual(Object.keys(dto.coach).sort(), [
      'deleted_at',
      'email',
      'full_name',
      'id',
      'is_active',
    ]);
    assert.equal(dto.coach.email, 'bob@example.com');
    assert.equal(dto.coach.avatar_url, undefined);
    assert.equal(dto.coach.password_hash, undefined);
    assert.equal(dto.bookings, undefined);
  });
});

describe('serializeLessonDetail', () => {
  it('owner view omits nested coach and bookings', () => {
    const dto = serializeLessonDetail(fullLesson, { viewerIsAdmin: false });
    assert.equal(dto.coach_id, 37);
    assert.equal(dto.coach, undefined);
    assert.equal(dto.bookings, undefined);
    assert.equal(dto.is_active, true);
    assert.equal(dto.deleted_at, null);
  });

  it('admin view includes coach with email and account status', () => {
    const dto = serializeLessonDetail(fullLesson, { viewerIsAdmin: true });
    assert.equal(dto.coach.email, 'bob@example.com');
    assert.equal(dto.coach.is_active, true);
    assert.equal(dto.coach.avatar_url, undefined);
    assert.equal(dto.bookings, undefined);
  });
});
