/**
 * Coach-first lesson discovery + owner/admin lesson-by-id + response DTO wiring.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { Lesson } from '../models/index.js';
import {
  getLessons,
  getLessonById,
  getCoachLessonsById,
  getMyLessons,
  lessonByIdDeps,
} from '../controllers/lessonController.js';
import { PUBLIC_MARKETPLACE_LESSON_FIELDS, COACH_OWNER_LESSON_FIELDS } from '../utils/lessonDto.js';

const origFindByPk = Lesson.findByPk;
const origFindAll = Lesson.findAll;
const origFindAndCountAll = Lesson.findAndCountAll;
const origEligibility = lessonByIdDeps.getCoachMarketplaceEligibility;
const origFindPublicActiveCoach = lessonByIdDeps.findPublicActiveCoach;

const listedEligibility = {
  listed: true,
  missing: [],
  steps: { profile: true, stripe: true, lesson: true, court: true, availability: true },
};

const notListedEligibility = {
  listed: false,
  missing: ['stripe'],
  steps: { profile: true, stripe: false, lesson: true, court: true, availability: true },
};

afterEach(() => {
  Lesson.findByPk = origFindByPk;
  Lesson.findAll = origFindAll;
  Lesson.findAndCountAll = origFindAndCountAll;
  lessonByIdDeps.getCoachMarketplaceEligibility = origEligibility;
  lessonByIdDeps.findPublicActiveCoach = origFindPublicActiveCoach;
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

const rawMarketplaceLesson = {
  id: 99,
  coach_id: 10,
  title: 'Intro',
  description: 'Basics',
  duration_minutes: 60,
  price: '50.00',
  effective_hourly_rate: 50,
  max_students: 1,
  is_active: true,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  coach: { id: 10, full_name: 'Coach', avatar_url: null, email: 'c@x.com' },
  get({ plain }) {
    return plain ? { ...this } : this;
  },
};

describe('GET /api/lessons (deprecated catalog)', () => {
  it('returns 410 Gone', async () => {
    const res = mockRes();
    await getLessons({ validated: {} }, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.payload?.code, 'lesson_catalog_removed');
  });
});

describe('GET /api/coaches/:id/lessons', () => {
  it('returns 404 when coach is not marketplace-eligible', async () => {
    lessonByIdDeps.findPublicActiveCoach = async () => ({ id: 35 });
    lessonByIdDeps.getCoachMarketplaceEligibility = async () => notListedEligibility;
    const res = mockRes();
    await getCoachLessonsById({ params: { id: '35' }, validated: {} }, res);
    assert.equal(res.statusCode, 404);
  });

  it('returns 404 when coach is not publicly active', async () => {
    lessonByIdDeps.findPublicActiveCoach = async () => null;
    lessonByIdDeps.getCoachMarketplaceEligibility = async () => listedEligibility;
    const res = mockRes();
    await getCoachLessonsById({ params: { id: '35' }, validated: {} }, res);
    assert.equal(res.statusCode, 404);
  });

  it('returns only active non-deleted lessons for eligible coach', async () => {
    lessonByIdDeps.findPublicActiveCoach = async () => ({ id: 10, full_name: 'Coach' });
    lessonByIdDeps.getCoachMarketplaceEligibility = async () => listedEligibility;
    Lesson.findAll = async (opts) => {
      assert.deepEqual(opts.where, { coach_id: 10, is_active: true, deleted_at: null });
      assert.equal(opts.include, undefined);
      return [rawMarketplaceLesson];
    };
    const res = mockRes();
    await getCoachLessonsById({ params: { id: '10' }, validated: {} }, res);
    assert.equal(res.statusCode, 200);
    const row = res.payload?.data?.[0];
    assert.equal(row?.id, 99);
    assert.deepEqual(Object.keys(row).sort(), [...PUBLIC_MARKETPLACE_LESSON_FIELDS].sort());
    assert.equal(row.is_active, undefined);
    assert.equal(row.deleted_at, undefined);
    assert.equal(row.created_at, undefined);
    assert.equal(row.coach, undefined);
  });
});

describe('GET /api/coaches/me/lessons', () => {
  it('returns owner inventory shape without nested coach', async () => {
    Lesson.findAndCountAll = async (opts) => {
      assert.deepEqual(opts.where, { coach_id: 50, deleted_at: null });
      assert.equal(opts.include, undefined);
      return {
        count: 1,
        rows: [
          {
            id: 38,
            coach_id: 50,
            title: 'Test Flow Lesson',
            description: 'Desc',
            duration_minutes: 60,
            price: '80.00',
            effective_hourly_rate: 80,
            max_students: 1,
            is_active: true,
            deleted_at: null,
            created_at: '2026-07-01T00:00:00.000Z',
            toJSON() {
              return { ...this };
            },
          },
        ],
      };
    };
    const res = mockRes();
    await getMyLessons({ user: { id: 50, roles: ['coach'] }, validated: {} }, res);
    assert.equal(res.statusCode, 200);
    const row = res.payload?.data?.[0];
    assert.deepEqual(Object.keys(row).sort(), [...COACH_OWNER_LESSON_FIELDS].sort());
    assert.equal(row.coach, undefined);
    assert.equal(row.is_active, true);
  });

  it('forbids non-coach', async () => {
    const res = mockRes();
    await getMyLessons({ user: { id: 9, roles: ['student'] }, validated: {} }, res);
    assert.equal(res.statusCode, 403);
  });
});

describe('GET /api/lessons/:id (owner/admin only)', () => {
  const lesson = {
    id: 35,
    coach_id: 2,
    title: 'Beginner',
    description: 'Learn',
    duration_minutes: 60,
    price: '50.00',
    effective_hourly_rate: 50,
    max_students: 1,
    is_active: true,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    coach: {
      id: 2,
      full_name: 'Coach',
      email: 'coach@example.com',
      is_active: true,
      deleted_at: null,
    },
    bookings: [{ id: 9 }],
    toJSON() {
      return { ...this };
    },
  };

  it('requires auth', async () => {
    const res = mockRes();
    await getLessonById({ params: { id: '35' } }, res);
    assert.equal(res.statusCode, 401);
  });

  it('forbids student discovery by id', async () => {
    Lesson.findByPk = async () => lesson;
    const res = mockRes();
    await getLessonById({ params: { id: '35' }, user: { id: 9, roles: ['student'] } }, res);
    assert.equal(res.statusCode, 403);
  });

  it('forbids other coaches', async () => {
    Lesson.findByPk = async () => lesson;
    const res = mockRes();
    await getLessonById({ params: { id: '35' }, user: { id: 99, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 403);
  });

  it('allows coach owner without nested coach or bookings', async () => {
    Lesson.findByPk = async (_id, opts) => {
      assert.deepEqual(opts?.include ?? [], []);
      return { ...lesson, is_active: false };
    };
    const res = mockRes();
    await getLessonById({ params: { id: '35' }, user: { id: 2, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 200);
    const data = res.payload?.data;
    assert.equal(data?.id, 35);
    assert.equal(data?.is_active, false);
    assert.equal(data?.coach, undefined);
    assert.equal(data?.bookings, undefined);
  });

  it('allows admin with coach nest and soft-deleted; no bookings', async () => {
    Lesson.findByPk = async (_id, opts) => {
      assert.equal(opts.include[0].as, 'coach');
      return {
        ...lesson,
        deleted_at: new Date('2026-06-01T00:00:00.000Z'),
        toJSON() {
          return {
            id: 35,
            coach_id: 2,
            title: 'Beginner',
            description: 'Learn',
            duration_minutes: 60,
            price: '50.00',
            effective_hourly_rate: 50,
            max_students: 1,
            is_active: false,
            deleted_at: this.deleted_at,
            created_at: '2026-01-01T00:00:00.000Z',
            coach: lesson.coach,
            bookings: [{ id: 9 }],
          };
        },
      };
    };
    const res = mockRes();
    await getLessonById({ params: { id: '35' }, user: { id: 1, roles: ['admin'] } }, res);
    assert.equal(res.statusCode, 200);
    const data = res.payload?.data;
    assert.equal(data.coach.email, 'coach@example.com');
    assert.equal(data.coach.avatar_url, undefined);
    assert.equal(data.bookings, undefined);
  });

  it('404 for owner on soft-deleted', async () => {
    Lesson.findByPk = async () => ({
      ...lesson,
      deleted_at: new Date(),
      toJSON() {
        return this;
      },
    });
    const res = mockRes();
    await getLessonById({ params: { id: '35' }, user: { id: 2, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 404);
  });
});
