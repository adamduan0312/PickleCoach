/**
 * HTTP + DB: a previously valid JWT must not keep capabilities after
 * suspend / delete / logout revoke / role removal / last-admin lock.
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, User, UserRole } from '../../models/index.js';
import { createBookingJourneyFixture } from '../helpers/integrationFixture.mjs';
import { startTestServer, api } from '../helpers/httpApp.mjs';

let dbOk = false;
if (RUN) {
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch (e) {
    console.warn('[http-integration] DB unavailable:', e.message);
  }
}

const describeHttp = RUN && dbOk ? describe : describe.skip;

async function createAdmin({ email, password }) {
  const admin = await User.create({
    full_name: 'Auth Lifecycle Admin',
    email,
    password_hash: bcrypt.hashSync(password, 8),
    is_active: true,
    email_verified_at: new Date(),
    timezone: 'America/New_York',
  });
  await UserRole.create({ user_id: admin.id, role: 'admin' });
  return admin;
}

describeHttp('HTTP integration: auth lifecycle edges', () => {
  let server = null;
  let fixture = null;
  /** @type {import('../../models/index.js').User[]} */
  const extraUsers = [];

  before(async () => {
    server = await startTestServer();
    fixture = await createBookingJourneyFixture();
  });

  after(async () => {
    try {
      const ids = extraUsers.map((u) => u.id);
      if (ids.length) {
        await UserRole.destroy({ where: { user_id: ids } });
        await User.destroy({ where: { id: ids } });
      }
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('suspends a user: existing JWT cannot hit /auth/profile or refresh', async () => {
    const { baseUrl } = server;
    const loginRes = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.student.email, password: fixture.password },
    });
    assert.equal(loginRes.status, 200, loginRes.text);
    const token = loginRes.json.data.token;

    const ok = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(ok.status, 200, ok.text);

    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const admin = await createAdmin({
      email: `auth.life.admin.${suffix}@picklecoach.example.org`,
      password: fixture.password,
    });
    extraUsers.push(admin);
    const adminLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: admin.email, password: fixture.password },
    });
    assert.equal(adminLogin.status, 200, adminLogin.text);
    const adminToken = adminLogin.json.data.token;

    const suspend = await api(baseUrl, 'PUT', `/api/users/${fixture.student.id}`, {
      token: adminToken,
      body: { is_active: false },
    });
    assert.equal(suspend.status, 200, suspend.text);

    const blocked = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(blocked.status, 401);
    assert.match(String(blocked.json?.error || blocked.text), /suspended/i);

    const refresh = await api(baseUrl, 'POST', '/api/auth/refresh', { body: { token } });
    assert.equal(refresh.status, 401);

    const reactivate = await api(baseUrl, 'PUT', `/api/users/${fixture.student.id}`, {
      token: adminToken,
      body: { is_active: true },
    });
    assert.equal(reactivate.status, 200, reactivate.text);
  });

  it('suspended JWT cannot hit a protected notifications list', async () => {
    const { baseUrl } = server;
    const loginRes = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.student.email, password: fixture.password },
    });
    assert.equal(loginRes.status, 200, loginRes.text);
    const token = loginRes.json.data.token;

    const admin = extraUsers[0];
    const adminLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: admin.email, password: fixture.password },
    });
    const adminToken = adminLogin.json.data.token;

    try {
      const suspend = await api(baseUrl, 'PUT', `/api/users/${fixture.student.id}`, {
        token: adminToken,
        body: { is_active: false },
      });
      assert.equal(suspend.status, 200, suspend.text);

      const feed = await api(baseUrl, 'GET', '/api/notifications', { token });
      assert.equal(feed.status, 401);
      assert.match(String(feed.json?.error || feed.text), /suspended/i);
    } finally {
      const reactivate = await api(baseUrl, 'PUT', `/api/users/${fixture.student.id}`, {
        token: adminToken,
        body: { is_active: true },
      });
      assert.equal(reactivate.status, 200, reactivate.text);
    }
  });

  it('soft-deletes a user: existing JWT is rejected as deleted', async () => {
    const { baseUrl } = server;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const victim = await User.create({
      full_name: 'Auth Delete Victim',
      email: `auth.life.del.${suffix}@picklecoach.example.org`,
      password_hash: bcrypt.hashSync(fixture.password, 8),
      is_active: true,
      email_verified_at: new Date(),
      timezone: 'America/New_York',
    });
    await UserRole.create({ user_id: victim.id, role: 'student' });
    extraUsers.push(victim);

    const loginRes = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: victim.email, password: fixture.password },
    });
    assert.equal(loginRes.status, 200, loginRes.text);
    const token = loginRes.json.data.token;

    const admin = extraUsers[0];
    const adminLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: admin.email, password: fixture.password },
    });
    const adminToken = adminLogin.json.data.token;

    const del = await api(baseUrl, 'DELETE', `/api/users/${victim.id}`, { token: adminToken });
    assert.equal(del.status, 200, del.text);

    const blocked = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(blocked.status, 401);
    assert.match(String(blocked.json?.error || blocked.text), /deleted/i);
  });

  it('logout revokes the JWT; garbage tokens are invalid', async () => {
    const { baseUrl } = server;
    const loginRes = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.coach.email, password: fixture.password },
    });
    assert.equal(loginRes.status, 200, loginRes.text);
    const token = loginRes.json.data.token;

    const out = await api(baseUrl, 'POST', '/api/auth/logout', { token });
    assert.equal(out.status, 200, out.text);

    const blocked = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(blocked.status, 401);
    assert.match(String(blocked.json?.error || blocked.text), /revoked/i);

    const refresh = await api(baseUrl, 'POST', '/api/auth/refresh', { body: { token } });
    assert.equal(refresh.status, 401);

    const garbage = await api(baseUrl, 'GET', '/api/auth/profile', { token: 'not-a-jwt' });
    assert.equal(garbage.status, 401);
  });

  it('removing coach role keeps the JWT valid but coach routes return 403', async () => {
    const { baseUrl } = server;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const dual = await User.create({
      full_name: 'Auth Dual Role',
      email: `auth.life.dual.${suffix}@picklecoach.example.org`,
      password_hash: bcrypt.hashSync(fixture.password, 8),
      is_active: true,
      email_verified_at: new Date(),
      timezone: 'America/New_York',
    });
    await UserRole.create({ user_id: dual.id, role: 'student' });
    await UserRole.create({ user_id: dual.id, role: 'coach' });
    extraUsers.push(dual);

    const loginRes = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: dual.email, password: fixture.password },
    });
    assert.equal(loginRes.status, 200, loginRes.text);
    const token = loginRes.json.data.token;

    const before = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(before.status, 200, before.text);
    assert.ok(before.json.data.roles.includes('coach'));

    const removed = await api(baseUrl, 'PUT', '/api/auth/me/role', {
      token,
      body: { role: 'coach', action: 'remove' },
    });
    assert.equal(removed.status, 200, removed.text);

    const after = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(after.status, 200, after.text);
    assert.equal(after.json.data.roles.includes('coach'), false);
    assert.ok(after.json.data.roles.includes('student'));

    const coachMe = await api(baseUrl, 'GET', '/api/coaches/me/availability', { token });
    assert.equal(coachMe.status, 403);
  });

  it('admin cannot remove their own admin role', async () => {
    const { baseUrl } = server;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const actor = await createAdmin({
      email: `auth.life.selfadmin.${suffix}@picklecoach.example.org`,
      password: fixture.password,
    });
    extraUsers.push(actor);

    const loginRes = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: actor.email, password: fixture.password },
    });
    assert.equal(loginRes.status, 200, loginRes.text);
    const token = loginRes.json.data.token;

    const delRole = await api(baseUrl, 'PUT', `/api/users/${actor.id}`, {
      token,
      body: { roles: ['student'] },
    });
    assert.equal(delRole.status, 400, delRole.text);
    assert.match(String(delRole.json?.message || delRole.text), /cannot remove your own admin role/i);

    const still = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(still.status, 200, still.text);
    assert.ok(still.json.data.roles.includes('admin'));
  });

  it('removing student role keeps JWT valid but student booking-intents return 403', async () => {
    const { baseUrl } = server;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;

    const admin = extraUsers[0];
    const adminLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: admin.email, password: fixture.password },
    });
    const adminToken = adminLogin.json.data.token;

    const fresh = await User.create({
      full_name: 'Auth Dual Student Remove',
      email: `auth.life.sturemove.${suffix}@picklecoach.example.org`,
      password_hash: bcrypt.hashSync(fixture.password, 8),
      is_active: true,
      email_verified_at: new Date(),
      timezone: 'America/New_York',
    });
    await UserRole.create({ user_id: fresh.id, role: 'student' });
    await UserRole.create({ user_id: fresh.id, role: 'coach' });
    extraUsers.push(fresh);

    const loginRes = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fresh.email, password: fixture.password },
    });
    assert.equal(loginRes.status, 200, loginRes.text);
    const token = loginRes.json.data.token;

    const stripped = await api(baseUrl, 'PUT', `/api/users/${fresh.id}`, {
      token: adminToken,
      body: { roles: ['coach'] },
    });
    assert.equal(stripped.status, 200, stripped.text);

    const after = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(after.status, 200, after.text);
    assert.equal(after.json.data.roles.includes('student'), false);
    assert.ok(after.json.data.roles.includes('coach'));

    const intent = await api(baseUrl, 'POST', '/api/booking-intents', {
      token,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
      },
    });
    assert.equal(intent.status, 403);
  });

  it('last-admin self-delete is 409; another admin can be deleted', async () => {
    const { baseUrl } = server;
    const { countOtherLiveAdmins } = await import('../../utils/userRoleChangeGuards.js');
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const spare = await createAdmin({
      email: `auth.life.spareadmin.${suffix}@picklecoach.example.org`,
      password: fixture.password,
    });
    extraUsers.push(spare);

    const spareLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: spare.email, password: fixture.password },
    });
    assert.equal(spareLogin.status, 200, spareLogin.text);
    const spareToken = spareLogin.json.data.token;

    const others = await countOtherLiveAdmins(spare.id);
    if (others < 1) {
      const selfDel = await api(baseUrl, 'DELETE', '/api/auth/me', { token: spareToken });
      assert.equal(selfDel.status, 409, selfDel.text);
      assert.equal(selfDel.json?.code, 'last_admin_required');
      const still = await api(baseUrl, 'GET', '/api/auth/profile', { token: spareToken });
      assert.equal(still.status, 200);
      return;
    }

    const actor = extraUsers[0];
    const actorLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: actor.email, password: fixture.password },
    });
    const actorToken = actorLogin.json.data.token;
    const del = await api(baseUrl, 'DELETE', `/api/users/${spare.id}`, { token: actorToken });
    assert.equal(del.status, 200, del.text);
    const blocked = await api(baseUrl, 'GET', '/api/auth/profile', { token: spareToken });
    assert.equal(blocked.status, 401);
    assert.match(String(blocked.json?.error || blocked.text), /deleted/i);
  });

  it('email verification unlocks student booking-intents; profile shows verified_at', async () => {
    const { baseUrl } = server;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const unverified = await User.create({
      full_name: 'Auth Unverified Student',
      email: `auth.life.unverified.${suffix}@picklecoach.example.org`,
      password_hash: bcrypt.hashSync(fixture.password, 8),
      is_active: true,
      email_verified_at: null,
      timezone: 'America/New_York',
    });
    await UserRole.create({ user_id: unverified.id, role: 'student' });
    extraUsers.push(unverified);

    const loginRes = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: unverified.email, password: fixture.password },
    });
    assert.equal(loginRes.status, 200, loginRes.text);
    const token = loginRes.json.data.token;

    const before = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(before.status, 200, before.text);
    assert.equal(before.json.data.email_verified_at, null);

    const blocked = await api(baseUrl, 'POST', '/api/booking-intents', {
      token,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
      },
    });
    assert.equal(blocked.status, 403);
    assert.match(String(blocked.json?.error || blocked.text), /verification/i);

    const crypto = await import('node:crypto');
    const verificationToken = crypto.randomBytes(32).toString('hex');
    await unverified.update({
      email_verification_token: verificationToken,
      email_verification_expires: new Date(Date.now() + 60 * 60 * 1000),
    });

    const confirm = await api(baseUrl, 'POST', '/api/auth/verify-email/confirm', {
      body: { token: verificationToken },
    });
    assert.equal(confirm.status, 200, confirm.text);

    const after = await api(baseUrl, 'GET', '/api/auth/profile', { token });
    assert.equal(after.status, 200, after.text);
    assert.ok(after.json.data.email_verified_at);

    const afterIntent = await api(baseUrl, 'POST', '/api/booking-intents', {
      token,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
      },
    });
    assert.notEqual(afterIntent.status, 403);
  });
});
