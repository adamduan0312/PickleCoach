/**
 * Admin lesson list WHERE builder + controller smoke (no DB).
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { Op } from 'sequelize';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdminLessonsWhere, buildLessonPriceWhere } from '../utils/lessonListQuery.js';
import { Lesson } from '../models/index.js';
import { getAdminLessons } from '../controllers/lessonController.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const origFindAll = Lesson.findAll;
const origFindAndCountAll = Lesson.findAndCountAll;

afterEach(() => {
  Lesson.findAll = origFindAll;
  Lesson.findAndCountAll = origFindAndCountAll;
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

describe('buildAdminLessonsWhere', () => {
  it('defaults to complete inventory (includes soft-deleted)', () => {
    assert.deepEqual(buildAdminLessonsWhere(), {});
  });

  it('filters coach_id and is_active', () => {
    assert.deepEqual(buildAdminLessonsWhere({ coach_id: 35, is_active: 'true' }), {
      coach_id: 35,
      is_active: true,
    });
    assert.deepEqual(buildAdminLessonsWhere({ is_active: 'false' }), {
      is_active: false,
    });
  });

  it('include_deleted=false excludes soft-deleted', () => {
    assert.deepEqual(buildAdminLessonsWhere({ include_deleted: 'false', coach_id: 1 }), {
      coach_id: 1,
      deleted_at: null,
    });
  });

  it('deleted=true returns soft-deleted only', () => {
    const w = buildAdminLessonsWhere({ deleted: 'true' });
    assert.equal(w.deleted_at[Op.ne], null);
  });
});

describe('buildLessonPriceWhere', () => {
  it('returns null when no bounds', () => {
    assert.equal(buildLessonPriceWhere({}), null);
  });

  it('builds gte/lte', () => {
    const w = buildLessonPriceWhere({ min_price: 10, max_price: 100 });
    assert.equal(w[Op.gte], 10);
    assert.equal(w[Op.lte], 100);
  });
});

describe('GET /api/admin/lessons', () => {
  it('lists without marketplace include (findAll where only)', async () => {
    let captured;
    Lesson.findAll = async (opts) => {
      captured = opts;
      return [
        {
          id: 28,
          coach_id: 35,
          title: 'Test Flow Lesson',
          is_active: true,
          deleted_at: null,
          get: undefined,
          toJSON() {
            return this;
          },
        },
      ];
    };
    const req = {
      validated: {},
      user: { id: 1, roles: ['admin'] },
    };
    const res = mockRes();
    await getAdminLessons(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.data?.[0]?.id, 28);
    assert.deepEqual(captured.where, {});
    assert.equal(captured.include[0].as, 'coach');
    // No marketplace eligibility nested includes
    assert.equal(captured.include.length, 1);
  });

  it('passes coach_id + is_active filters', async () => {
    let captured;
    Lesson.findAll = async (opts) => {
      captured = opts;
      return [];
    };
    const req = {
      validated: { coach_id: 35, is_active: 'false', include_deleted: 'false' },
      user: { id: 1, roles: ['admin'] },
    };
    const res = mockRes();
    await getAdminLessons(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.where, {
      coach_id: 35,
      is_active: false,
      deleted_at: null,
    });
  });

  it('mounts GET /api/admin/lessons before /bookings', () => {
    const routesSrc = readFileSync(join(__dirname, '../routes/adminRoutes.js'), 'utf8');
    const lessonsIdx = routesSrc.indexOf("'/lessons'");
    const bookingsIdx = routesSrc.indexOf("'/bookings'");
    assert.ok(lessonsIdx > -1 && bookingsIdx > lessonsIdx);
    assert.match(routesSrc, /getAdminLessons/);
    assert.match(routesSrc, /authorize\('admin'\)/);
  });
});
