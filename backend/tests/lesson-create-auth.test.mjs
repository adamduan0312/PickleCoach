/**
 * POST /api/lessons — coach only (admins moderate existing lessons, they do not create).
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { Lesson } from '../models/index.js';
import { createLesson } from '../controllers/lessonController.js';

const origCreate = Lesson.create;

afterEach(() => {
  Lesson.create = origCreate;
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

const body = {
  title: 'Intro',
  description: 'Basics',
  duration_minutes: 60,
  price: 50,
  max_students: 1,
};

describe('POST /api/lessons create auth', () => {
  it('allows coach', async () => {
    Lesson.create = async (attrs) => {
      assert.equal(attrs.coach_id, 7);
      return { id: 1, ...attrs };
    };
    const res = mockRes();
    await createLesson({ user: { id: 7, roles: ['coach'] }, validated: body }, res);
    assert.equal(res.statusCode, 201);
  });

  it('forbids admin without coach role', async () => {
    Lesson.create = async () => {
      throw new Error('create should not run');
    };
    const res = mockRes();
    await createLesson({ user: { id: 1, roles: ['admin'] }, validated: body }, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.payload?.message || '', /Only coaches/i);
  });

  it('forbids student', async () => {
    Lesson.create = async () => {
      throw new Error('create should not run');
    };
    const res = mockRes();
    await createLesson({ user: { id: 9, roles: ['student'] }, validated: body }, res);
    assert.equal(res.statusCode, 403);
  });

  it('allows user with coach + admin (creates as that coach)', async () => {
    Lesson.create = async (attrs) => {
      assert.equal(attrs.coach_id, 3);
      return { id: 2, ...attrs };
    };
    const res = mockRes();
    await createLesson({ user: { id: 3, roles: ['coach', 'admin'] }, validated: body }, res);
    assert.equal(res.statusCode, 201);
  });
});
