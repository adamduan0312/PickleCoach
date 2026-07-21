/**
 * Coach-first lesson discovery + owner/admin lesson-by-id.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { Lesson } from '../models/index.js';
import {
  getLessons,
  getLessonById,
  getCoachLessonsById,
  lessonByIdDeps,
} from '../controllers/lessonController.js';

const origFindByPk = Lesson.findByPk;
const origFindAll = Lesson.findAll;
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

  it('returns active lessons for eligible coach', async () => {
    lessonByIdDeps.findPublicActiveCoach = async () => ({ id: 10, full_name: 'Coach' });
    lessonByIdDeps.getCoachMarketplaceEligibility = async () => listedEligibility;
    Lesson.findAll = async (opts) => {
      assert.deepEqual(opts.where, { coach_id: 10, is_active: true, deleted_at: null });
      return [
        {
          id: 99,
          coach_id: 10,
          title: 'Intro',
          is_active: true,
          deleted_at: null,
          coach: { id: 10, full_name: 'Coach', avatar_url: null },
          get({ plain }) {
            return plain ? this : this;
          },
        },
      ];
    };
    const res = mockRes();
    await getCoachLessonsById({ params: { id: '10' }, validated: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.data?.[0]?.id, 99);
  });
});

describe('GET /api/lessons/:id (owner/admin only)', () => {
  const lesson = {
    id: 35,
    coach_id: 2,
    title: 'Beginner',
    is_active: true,
    deleted_at: null,
    coach: { id: 2, full_name: 'Coach', avatar_url: null },
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

  it('allows coach owner', async () => {
    Lesson.findByPk = async () => lesson;
    const res = mockRes();
    await getLessonById({ params: { id: '35' }, user: { id: 2, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.data?.id, 35);
  });

  it('allows admin including soft-deleted', async () => {
    Lesson.findByPk = async () => ({
      ...lesson,
      deleted_at: new Date(),
      toJSON() {
        return { id: 35, coach_id: 2, deleted_at: this.deleted_at };
      },
    });
    const res = mockRes();
    await getLessonById({ params: { id: '35' }, user: { id: 1, roles: ['admin'] } }, res);
    assert.equal(res.statusCode, 200);
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
