/**
 * User lifecycle: Active / Suspended / Deleted
 * Covers soft-delete + restore (incl. coach profile), suspension, and auth gating.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { User, CoachProfile, UserRole, sequelize } from '../models/index.js';
import { updateUser, deleteUser } from '../controllers/userController.js';
import { softDeleteUserAccount, restoreUserAccount, isPubliclyActiveUser, PUBLIC_ACTIVE_USER_WHERE } from '../utils/userLifecycle.js';
import { updateUserSchema } from '../config/validation.js';
import { authenticate } from '../middleware/auth.js';
import { login } from '../controllers/authController.js';

const origUserFindByPk = User.findByPk;
const origUserFindOne = User.findOne;
const origCoachFindOne = CoachProfile.findOne;
const origRoleFindOne = UserRole.findOne;
const origRoleFindAll = UserRole.findAll;
const origTx = sequelize.transaction;

afterEach(() => {
  User.findByPk = origUserFindByPk;
  User.findOne = origUserFindOne;
  CoachProfile.findOne = origCoachFindOne;
  UserRole.findOne = origRoleFindOne;
  UserRole.findAll = origRoleFindAll;
  sequelize.transaction = origTx;
});

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

/** Mutable user stub with Sequelize-like update/reload. */
function makeUser(overrides = {}) {
  const state = {
    id: 10,
    full_name: 'Test User',
    email: 'test@example.com',
    phone: null,
    timezone: 'UTC',
    avatar_url: null,
    is_active: true,
    deleted_at: null,
    token_version: 0,
    role_governance_locked: false,
    admin_allowed_roles: null,
    password_hash: 'hash',
    userRoles: [{ role: 'coach' }],
    ...overrides,
  };

  const user = {
    get id() {
      return state.id;
    },
    get full_name() {
      return state.full_name;
    },
    get email() {
      return state.email;
    },
    get phone() {
      return state.phone;
    },
    get timezone() {
      return state.timezone;
    },
    get avatar_url() {
      return state.avatar_url;
    },
    get is_active() {
      return state.is_active;
    },
    get deleted_at() {
      return state.deleted_at;
    },
    get token_version() {
      return state.token_version;
    },
    get role_governance_locked() {
      return state.role_governance_locked;
    },
    get admin_allowed_roles() {
      return state.admin_allowed_roles;
    },
    get password_hash() {
      return state.password_hash;
    },
    get userRoles() {
      return state.userRoles;
    },
    update: async (fields) => {
      Object.assign(state, fields);
      return user;
    },
    reload: async () => user,
    toJSON() {
      return { ...state };
    },
  };

  return { user, state };
}

describe('updateUserSchema lifecycle fields', () => {
  it('allows is_active true and false', () => {
    assert.equal(updateUserSchema.validate({ is_active: true }).error, undefined);
    assert.equal(updateUserSchema.validate({ is_active: false }).error, undefined);
  });

  it('allows deleted_at null for restore', () => {
    assert.equal(updateUserSchema.validate({ deleted_at: null, is_active: true }).error, undefined);
  });

  it('rejects deleted_at date (use DELETE endpoint)', () => {
    const { error } = updateUserSchema.validate({ deleted_at: new Date().toISOString() });
    assert.ok(error);
  });
});

describe('softDeleteUserAccount / restoreUserAccount', () => {
  it('soft-deletes user and coach profile', async () => {
    const { user, state } = makeUser();
    let profileDeletedAt = null;
    CoachProfile.findOne = async () => ({
      get deleted_at() {
        return profileDeletedAt;
      },
      update: async (fields) => {
        if ('deleted_at' in fields) profileDeletedAt = fields.deleted_at;
      },
    });

    await softDeleteUserAccount(user);
    assert.equal(state.is_active, false);
    assert.ok(state.deleted_at);
    assert.ok(profileDeletedAt);
  });

  it('restore clears user deleted_at, sets active, and clears coach profile deleted_at', async () => {
    const { user, state } = makeUser({ is_active: false, deleted_at: new Date() });
    let profileDeletedAt = new Date();
    CoachProfile.findOne = async () => ({
      get deleted_at() {
        return profileDeletedAt;
      },
      update: async (fields) => {
        if ('deleted_at' in fields) profileDeletedAt = fields.deleted_at;
      },
    });

    await restoreUserAccount(user);
    assert.equal(state.is_active, true);
    assert.equal(state.deleted_at, null);
    assert.equal(profileDeletedAt, null);
  });

  it('suspension does not require coach profile lookup (profile stays undeleted)', async () => {
    const { user, state } = makeUser({ is_active: true, deleted_at: null });
    await user.update({ is_active: false });
    assert.equal(state.is_active, false);
    assert.equal(state.deleted_at, null);
  });
});

describe('PUT /api/users/:id lifecycle (updateUser)', () => {
  it('admin can suspend without deleting', async () => {
    const { user, state } = makeUser();
    User.findByPk = async () => user;
    sequelize.transaction = async (fn) => fn({});

    let coachFindCalls = 0;
    CoachProfile.findOne = async () => {
      coachFindCalls += 1;
      return null;
    };

    const req = {
      params: { id: '10' },
      user: { id: 1, roles: ['admin'] },
      validated: { is_active: false },
    };
    const res = mockRes();
    await updateUser(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(state.is_active, false);
    assert.equal(state.deleted_at, null);
    assert.equal(coachFindCalls, 0);
    assert.equal(res.body.data.is_active, false);
    assert.equal(res.body.data.deleted_at, null);
  });

  it('admin can reactivate a suspended user', async () => {
    const { user, state } = makeUser({ is_active: false, deleted_at: null });
    User.findByPk = async () => user;
    sequelize.transaction = async (fn) => fn({});

    const req = {
      params: { id: '10' },
      user: { id: 1, roles: ['admin'] },
      validated: { is_active: true },
    };
    const res = mockRes();
    await updateUser(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(state.is_active, true);
    assert.equal(state.deleted_at, null);
  });

  it('cannot activate while deleted without restore', async () => {
    const { user } = makeUser({ is_active: false, deleted_at: new Date() });
    User.findByPk = async () => user;

    const req = {
      params: { id: '10' },
      user: { id: 1, roles: ['admin'] },
      validated: { is_active: true },
    };
    const res = mockRes();
    await updateUser(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message || '', /deleted|restore|undelete/i);
  });

  it('restore deleted user restores coach profile', async () => {
    const { user, state } = makeUser({ is_active: false, deleted_at: new Date() });
    User.findByPk = async () => user;
    sequelize.transaction = async (fn) => fn({});

    let profileDeletedAt = new Date();
    CoachProfile.findOne = async () => ({
      get deleted_at() {
        return profileDeletedAt;
      },
      update: async (fields) => {
        if ('deleted_at' in fields) profileDeletedAt = fields.deleted_at;
      },
    });

    const req = {
      params: { id: '10' },
      user: { id: 1, roles: ['admin'] },
      validated: { deleted_at: null, is_active: true },
    };
    const res = mockRes();
    await updateUser(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(state.is_active, true);
    assert.equal(state.deleted_at, null);
    assert.equal(profileDeletedAt, null);
  });

  it('transaction rolls back if coach profile restoration fails', async () => {
    const { user, state } = makeUser({ is_active: false, deleted_at: new Date('2024-06-01') });
    User.findByPk = async () => user;

    CoachProfile.findOne = async () => ({
      deleted_at: new Date(),
      update: async () => {
        throw new Error('db write failed');
      },
    });

    sequelize.transaction = async (fn) => {
      const snap = { is_active: state.is_active, deleted_at: state.deleted_at };
      try {
        await fn({});
      } catch (e) {
        state.is_active = snap.is_active;
        state.deleted_at = snap.deleted_at;
        throw e;
      }
    };

    const req = {
      params: { id: '10' },
      user: { id: 1, roles: ['admin'] },
      validated: { deleted_at: null, is_active: true },
    };
    const res = mockRes();
    await updateUser(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(state.is_active, false);
    assert.ok(state.deleted_at);
  });
});

describe('DELETE /api/users/:id soft-delete', () => {
  it('deleting coach soft-deletes coach profile', async () => {
    const { user, state } = makeUser();
    User.findByPk = async () => user;
    UserRole.findOne = async () => null;
    sequelize.transaction = async (fn) => fn({});

    let profileDeletedAt = null;
    CoachProfile.findOne = async () => ({
      get deleted_at() {
        return profileDeletedAt;
      },
      update: async (fields) => {
        if ('deleted_at' in fields) profileDeletedAt = fields.deleted_at;
      },
    });

    const req = { params: { id: '10' }, user: { id: 1, roles: ['admin'] } };
    const res = mockRes();
    await deleteUser(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(state.is_active, false);
    assert.ok(state.deleted_at);
    assert.ok(profileDeletedAt);
  });
});

describe('login lifecycle messages', () => {
  it('suspended user cannot login', async () => {
    const { user } = makeUser({ is_active: false, deleted_at: null });
    User.findOne = async () => user;

    const req = { validated: { email: 'test@example.com', password: 'x' }, id: 'req-1' };
    const res = mockRes();
    await login(req, res);

    assert.equal(res.statusCode, 401);
    assert.match(res.body.message || '', /suspended/i);
  });

  it('deleted user cannot login', async () => {
    const { user } = makeUser({ is_active: false, deleted_at: new Date() });
    User.findOne = async () => user;

    const req = { validated: { email: 'test@example.com', password: 'x' }, id: 'req-1' };
    const res = mockRes();
    await login(req, res);

    assert.equal(res.statusCode, 401);
    assert.match(res.body.message || '', /deleted/i);
  });
});

describe('authenticate middleware lifecycle', () => {
  const secret = process.env.JWT_SECRET || 'your-secret-key';

  it('blocks suspended users from authenticated endpoints', async () => {
    const { user } = makeUser({ is_active: false, deleted_at: null });
    User.findByPk = async () => user;
    const token = jwt.sign({ userId: 10, tokenVersion: 0 }, secret);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    let nextCalled = false;
    await authenticate(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error || '', /suspended/i);
  });

  it('blocks deleted users from authenticated endpoints', async () => {
    const { user } = makeUser({ is_active: false, deleted_at: new Date() });
    User.findByPk = async () => user;
    const token = jwt.sign({ userId: 10, tokenVersion: 0 }, secret);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    let nextCalled = false;
    await authenticate(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error || '', /deleted/i);
  });

  it('rejects an already-issued JWT after mid-session suspension (DB re-check)', async () => {
    const { user, state } = makeUser({ is_active: true, deleted_at: null });
    User.findByPk = async () => user;
    const token = jwt.sign({ userId: 10, tokenVersion: 0 }, secret);

    // First request while Active succeeds
    {
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      let nextCalled = false;
      await authenticate(req, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
    }

    // Admin suspends; same JWT must fail on next request
    state.is_active = false;
    {
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      let nextCalled = false;
      await authenticate(req, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      assert.match(res.body.error || '', /suspended/i);
    }
  });
});

describe('public discovery helpers', () => {
  it('isPubliclyActiveUser only true for Active state', () => {
    assert.equal(isPubliclyActiveUser({ is_active: true, deleted_at: null }), true);
    assert.equal(isPubliclyActiveUser({ is_active: false, deleted_at: null }), false);
    assert.equal(isPubliclyActiveUser({ is_active: false, deleted_at: new Date() }), false);
    assert.equal(isPubliclyActiveUser({ is_active: true, deleted_at: new Date() }), false);
    assert.equal(isPubliclyActiveUser(null), false);
  });

  it('PUBLIC_ACTIVE_USER_WHERE matches Active state', () => {
    assert.deepEqual(PUBLIC_ACTIVE_USER_WHERE, { is_active: true, deleted_at: null });
  });
});
