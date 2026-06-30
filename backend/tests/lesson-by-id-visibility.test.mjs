/**
 * GET /api/lessons/:id — inactive: owner/admin only; deleted: 404 for everyone.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { Lesson } from '../models/index.js';
import { getLessonById } from '../controllers/lessonController.js';

const origFindByPk = Lesson.findByPk;

const activeLesson = {
  id: 35,
  coach_id: 2,
  title: 'Beginner Lesson',
  is_active: true,
  deleted_at: null,
};

const inactiveLesson = {
  id: 35,
  coach_id: 2,
  title: 'Beginner Lesson',
  is_active: false,
  deleted_at: null,
};

afterEach(() => {
  Lesson.findByPk = origFindByPk;
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

describe('GET /api/lessons/:id visibility', () => {
  it('returns 200 for active lesson (no auth)', async () => {
    Lesson.findByPk = async () => activeLesson;
    const req = { params: { id: '35' } };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.data?.id, 35);
  });

  it('returns 404 for inactive lesson when unauthenticated', async () => {
    Lesson.findByPk = async () => inactiveLesson;
    const req = { params: { id: '35' } };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.payload?.message || '', /not found/i);
  });

  it('returns 404 for inactive lesson when student (not owner)', async () => {
    Lesson.findByPk = async () => inactiveLesson;
    const req = {
      params: { id: '35' },
      user: { id: 99, roles: ['student'] },
    };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 404);
  });

  it('returns 404 for inactive lesson when another coach (not owner)', async () => {
    Lesson.findByPk = async () => inactiveLesson;
    const req = {
      params: { id: '35' },
      user: { id: 99, roles: ['coach'] },
    };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 404);
  });

  it('returns 200 for inactive lesson when coach owner (numeric id match)', async () => {
    Lesson.findByPk = async () => ({
      ...inactiveLesson,
      coach_id: '2',
    });
    const req = {
      params: { id: '35' },
      user: { id: 2, roles: ['coach'] },
    };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 200);
  });

  it('treats is_active 0 as inactive (MySQL boolean)', async () => {
    Lesson.findByPk = async () => ({
      ...inactiveLesson,
      is_active: 0,
    });
    const req = { params: { id: '35' } };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 404);
  });

  it('returns 200 for inactive lesson when coach owner', async () => {
    Lesson.findByPk = async () => inactiveLesson;
    const req = {
      params: { id: '35' },
      user: { id: 2, roles: ['coach'] },
    };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.data?.is_active, false);
  });

  it('returns 200 for inactive lesson when admin (not owner)', async () => {
    Lesson.findByPk = async () => inactiveLesson;
    const req = {
      params: { id: '35' },
      user: { id: 99, roles: ['admin'] },
    };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 200);
  });

  it('returns 404 for soft-deleted lesson even for coach owner', async () => {
    Lesson.findByPk = async () => ({
      ...inactiveLesson,
      deleted_at: new Date(),
    });
    const req = {
      params: { id: '35' },
      user: { id: 2, roles: ['coach'] },
    };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 404);
  });

  it('returns 404 for soft-deleted lesson even for admin', async () => {
    Lesson.findByPk = async () => ({
      ...activeLesson,
      is_active: false,
      deleted_at: new Date(),
    });
    const req = {
      params: { id: '35' },
      user: { id: 99, roles: ['admin'] },
    };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 404);
  });

  it('returns 404 for soft-deleted lesson when unauthenticated', async () => {
    Lesson.findByPk = async () => ({
      ...activeLesson,
      deleted_at: new Date(),
    });
    const req = { params: { id: '35' } };
    const res = mockRes();
    await getLessonById(req, res);
    assert.equal(res.statusCode, 404);
  });
});
