/**
 * Purpose-specific review list endpoints (replaces GET /api/reviews catalog).
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Review } from '../models/index.js';
import {
  getReviews,
  getCoachReviewsById,
  getMyWrittenReviews,
  getMyReceivedReviews,
  getAdminReviews,
  reviewListDeps,
} from '../controllers/reviewController.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const origFindAll = Review.findAll;
const origFindAndCountAll = Review.findAndCountAll;
const origFindPublic = reviewListDeps.findPublicActiveCoach;

afterEach(() => {
  Review.findAll = origFindAll;
  Review.findAndCountAll = origFindAndCountAll;
  reviewListDeps.findPublicActiveCoach = origFindPublic;
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

describe('GET /api/reviews (deprecated)', () => {
  it('returns 410 Gone', async () => {
    const res = mockRes();
    await getReviews({ validated: {}, user: { id: 1, roles: ['student'] } }, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.payload?.code, 'reviews_catalog_removed');
  });
});

describe('GET /api/coaches/:id/reviews', () => {
  it('404 when coach not publicly active', async () => {
    reviewListDeps.findPublicActiveCoach = async () => null;
    const res = mockRes();
    await getCoachReviewsById({ params: { id: '9' }, validated: {} }, res);
    assert.equal(res.statusCode, 404);
  });

  it('lists reviews for that coach', async () => {
    reviewListDeps.findPublicActiveCoach = async () => ({ id: 10 });
    let captured;
    Review.findAll = async (opts) => {
      captured = opts;
      return [];
    };
    const res = mockRes();
    await getCoachReviewsById({ params: { id: '10' }, validated: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.where, { coach_id: 10 });
  });
});

describe('GET /api/students/me/reviews', () => {
  it('forbids non-student', async () => {
    const res = mockRes();
    await getMyWrittenReviews({ user: { id: 1, roles: ['coach'] }, validated: {} }, res);
    assert.equal(res.statusCode, 403);
  });

  it('scopes to student_id = self', async () => {
    let captured;
    Review.findAll = async (opts) => {
      captured = opts;
      return [];
    };
    const res = mockRes();
    await getMyWrittenReviews({ user: { id: 7, roles: ['student'] }, validated: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.where, { student_id: 7 });
  });
});

describe('GET /api/coaches/me/reviews', () => {
  it('forbids non-coach', async () => {
    const res = mockRes();
    await getMyReceivedReviews({ user: { id: 1, roles: ['student'] }, validated: {} }, res);
    assert.equal(res.statusCode, 403);
  });

  it('scopes to coach_id = self', async () => {
    let captured;
    Review.findAll = async (opts) => {
      captured = opts;
      return [];
    };
    const res = mockRes();
    await getMyReceivedReviews({ user: { id: 50, roles: ['coach'] }, validated: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.where, { coach_id: 50 });
  });
});

describe('GET /api/admin/reviews', () => {
  it('applies optional filters', async () => {
    let captured;
    Review.findAll = async (opts) => {
      captured = opts;
      return [];
    };
    const res = mockRes();
    await getAdminReviews(
      {
        user: { id: 1, roles: ['admin'] },
        validated: { coach_id: 10, student_id: 7 },
      },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.where, { coach_id: 10, student_id: 7 });
  });

  it('mounts admin reviews route', () => {
    const src = readFileSync(join(__dirname, '../routes/adminRoutes.js'), 'utf8');
    assert.match(src, /getAdminReviews/);
    assert.match(src, /'\/reviews'/);
  });

  it('mounts coach and student me/reviews before /:id', () => {
    const coachSrc = readFileSync(join(__dirname, '../routes/coachRoutes.js'), 'utf8');
    const meIdx = coachSrc.indexOf("/me/reviews");
    const idReviewsIdx = coachSrc.indexOf("/:id/reviews");
    const idIdx = coachSrc.indexOf("router.get('/:id'");
    assert.ok(meIdx > -1 && idReviewsIdx > meIdx && idIdx > idReviewsIdx);
    const studentSrc = readFileSync(join(__dirname, '../routes/studentRoutes.js'), 'utf8');
    assert.match(studentSrc, /me\/reviews/);
    assert.match(studentSrc, /getMyWrittenReviews/);
  });
});
