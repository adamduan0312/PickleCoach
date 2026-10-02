/**
 * Self reliability responses never reveal which cancellations count toward reliability;
 * admin reliability responses keep the full breakdown.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { User, UserReliability } from '../models/index.js';
import {
  getCoachReliabilityForMe,
  getStudentReliabilityForMe,
  getUserReliabilityForAdmin,
} from '../controllers/reliabilityController.js';
import { serializeAdminUserDetail, serializeAuthProfileUser } from '../utils/userDto.js';

const origRelFindOne = UserReliability.findOne;
const origUserFindByPk = User.findByPk;

afterEach(() => {
  UserReliability.findOne = origRelFindOne;
  User.findByPk = origUserFindByPk;
});

const CANCELLATION_KEYS = /cancel/i;

function storedRow(role) {
  return {
    user_id: 7,
    role,
    reliability_score: '91.25',
    score_source: 'computed',
    total_bookings_recent: 10,
    late_cancels_recent: 2,
    late_cancels_decayed: 1.5,
    late_cancels_total: 3,
    no_shows_recent: 1,
    no_shows_decayed: 1,
    no_shows_total: 1,
    misconduct_penalties_recent: 0,
    lesson_not_completed_penalties_recent: 0,
    coach_cancels_non_late_recent: 4,
    coach_cancels_non_late_decayed: 3,
    coach_cancels_non_late_total: 4,
    student_cancels_non_late_recent: 5,
    student_cancels_non_late_decayed: 4,
    student_cancels_non_late_total: 5,
    smoothing_k: 5,
    decay_lambda: 0.02,
    scoring_window_days: 90,
    last_updated: '2026-09-01T00:00:00.000Z',
  };
}

function stubReliability(role) {
  UserReliability.findOne = async () => ({ toJSON: () => storedRow(role) });
}

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

function cancellationKeysDeep(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(CANCELLATION_KEYS.test(k) ? [`${path}${k}`] : []),
    ...cancellationKeysDeep(v, `${path}${k}.`),
  ]);
}

describe('self reliability responses hide the cancellation breakdown', () => {
  it('GET /api/students/me/reliability', async () => {
    stubReliability('student');
    const res = mockRes();
    await getStudentReliabilityForMe({ user: { id: 7, roles: ['student'] } }, res);
    assert.equal(res.statusCode, 200);
    const rel = res.payload.data.reliability;
    assert.equal(rel.reliability_score, 91.25);
    assert.equal(rel.total_bookings, 10);
    assert.equal(rel.no_shows, 1);
    assert.deepEqual(cancellationKeysDeep(rel), []);
  });

  it('GET /api/coaches/me/reliability', async () => {
    stubReliability('coach');
    const res = mockRes();
    await getCoachReliabilityForMe({ user: { id: 7, roles: ['coach'] } }, res);
    assert.equal(res.statusCode, 200);
    const rel = res.payload.data.reliability;
    assert.equal(rel.reliability_score, 91.25);
    assert.equal(rel.total_bookings, 10);
    assert.equal(rel.no_shows, 1);
    assert.deepEqual(cancellationKeysDeep(rel), []);
  });

  it('GET /api/auth/profile reliability summaries', () => {
    const out = serializeAuthProfileUser({
      id: 7,
      full_name: 'Sam',
      email: 'sam@example.com',
      userRoles: [{ role: 'student' }, { role: 'coach' }],
      reliabilities: [storedRow('coach'), storedRow('student')],
    });
    assert.equal(out.reliability.reliability_score, 91.25);
    assert.equal(out.reliability_student.no_shows, 1);
    assert.deepEqual(cancellationKeysDeep(out.reliability), []);
    assert.deepEqual(cancellationKeysDeep(out.reliability_student), []);
  });
});

describe('admin reliability responses keep the cancellation breakdown', () => {
  it('GET /api/admin/users/:id/reliability', async () => {
    stubReliability('student');
    User.findByPk = async () => ({ id: 7, userRoles: [{ role: 'student' }] });
    const res = mockRes();
    await getUserReliabilityForAdmin(
      { params: { id: '7' }, query: { role: 'student' }, user: { id: 1, roles: ['admin'] } },
      res,
    );
    assert.equal(res.statusCode, 200);
    const { penalties } = res.payload.data.reliability;
    assert.equal(penalties.late_cancels.recent, 2);
    assert.equal(penalties.student_cancels_non_late.recent, 5);
    assert.equal(penalties.coach_cancels_non_late.recent, 4);
  });

  it('GET /api/users/:id admin detail summaries', () => {
    const out = serializeAdminUserDetail({
      id: 7,
      full_name: 'Sam',
      email: 'sam@example.com',
      userRoles: [{ role: 'student' }, { role: 'coach' }],
      reliabilities: [storedRow('coach'), storedRow('student')],
    });
    assert.equal(out.reliability.late_cancels, 2);
    assert.equal(out.reliability_student.late_cancels, 2);
  });
});
