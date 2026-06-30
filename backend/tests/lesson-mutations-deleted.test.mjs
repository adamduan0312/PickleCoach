/**
 * PUT/DELETE /api/lessons/:id — soft-deleted lessons are not mutable (404).
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { Lesson } from '../models/index.js';
import { updateLesson, deleteLesson } from '../controllers/lessonController.js';

const origFindByPk = Lesson.findByPk;

const deletedLesson = {
  id: 35,
  coach_id: 2,
  title: 'Advanced Strategy Session',
  is_active: false,
  deleted_at: new Date(),
  update: async () => {
    throw new Error('update should not be called on deleted lesson');
  },
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

describe('lesson mutations on soft-deleted rows', () => {
  it('PUT returns 404 for deleted lesson (coach owner)', async () => {
    Lesson.findByPk = async () => deletedLesson;
    const req = {
      params: { id: '35' },
      user: { id: 2, roles: ['coach'] },
      validated: { title: 'Renamed' },
    };
    const res = mockRes();
    await updateLesson(req, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.payload?.message || '', /not found/i);
  });

  it('PUT returns 404 for deleted lesson (admin)', async () => {
    Lesson.findByPk = async () => deletedLesson;
    const req = {
      params: { id: '35' },
      user: { id: 99, roles: ['admin'] },
      validated: { is_active: true },
    };
    const res = mockRes();
    await updateLesson(req, res);
    assert.equal(res.statusCode, 404);
  });

  it('DELETE returns 404 when lesson already deleted', async () => {
    Lesson.findByPk = async () => deletedLesson;
    const req = {
      params: { id: '35' },
      user: { id: 2, roles: ['coach'] },
    };
    const res = mockRes();
    await deleteLesson(req, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.payload?.message || '', /not found/i);
  });
});
