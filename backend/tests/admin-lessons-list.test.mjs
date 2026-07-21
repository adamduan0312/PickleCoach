/**
 * GET /api/admin/lessons — admin inventory filters (no marketplace gate).
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { Op } from 'sequelize';
import { Lesson } from '../models/index.js';
import { buildAdminLessonsWhere, getAdminLessons } from '../controllers/lessonController.js';

const origFindAll = Lesson.findAll;
const origFindAndCountAll = Lesson.findAndCountAll;

afterEach(() => {
  Lesson.findAll = origFindAll;
  Lesson.findAndCountAll = origFindAndCountAll;
});

describe('buildAdminLessonsWhere', () => {
  it('defaults to excluding soft-deleted rows', () => {
    assert.deepEqual(buildAdminLessonsWhere({}), { deleted_at: null });
  });

  it('omits deleted_at filter when include_deleted is true', () => {
    assert.deepEqual(buildAdminLessonsWhere({ include_deleted: true }), {});
  });

  it('filters by coach_id and is_active', () => {
    assert.deepEqual(
      buildAdminLessonsWhere({ coach_id: 35, is_active: false }),
      { deleted_at: null, coach_id: 35, is_active: false },
    );
  });

  it('applies price range', () => {
    const where = buildAdminLessonsWhere({ min_price: 10, max_price: 100 });
    assert.equal(where.deleted_at, null);
    assert.equal(where.price[Op.gte], 10);
    assert.equal(where.price[Op.lte], 100);
  });
});

describe('getAdminLessons', () => {
  it('passes admin where without marketplace coach include', async () => {
    let captured;
    Lesson.findAll = async (opts) => {
      captured = opts;
      return [];
    };
    const req = {
      validated: { include_deleted: false, coach_id: 35, is_active: true },
    };
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(payload) {
        this.payload = payload;
      },
    };
    await getAdminLessons(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.where, {
      deleted_at: null,
      coach_id: 35,
      is_active: true,
    });
    assert.equal(captured.include[0].as, 'coach');
    assert.equal(captured.include[0].required, false);
  });

  it('includes deleted rows when include_deleted is true', async () => {
    let captured;
    Lesson.findAll = async (opts) => {
      captured = opts;
      return [];
    };
    const req = { validated: { include_deleted: true } };
    const res = {
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(payload) {
        this.payload = payload;
      },
    };
    await getAdminLessons(req, res);
    assert.equal(Object.prototype.hasOwnProperty.call(captured.where, 'deleted_at'), false);
  });
});
