/**
 * Coach ratings: DUPR (3 dp) / UTR-P (1 dp) survive DB + API exactly, partial updates are
 * validated on the merged pair, and Discover never compares across systems.
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, CoachProfile, User, UserRole } from '../../models/index.js';
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

async function login(baseUrl, email, password) {
  const res = await api(baseUrl, 'POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, res.text);
  return res.json.data.token;
}

function profileOf(res) {
  const d = res.json?.data;
  return d?.coachProfile ?? d;
}

async function storedRating(userId) {
  const [[row]] = await sequelize.query(
    'SELECT CAST(skill_rating AS CHAR) AS skill_rating, rating_system FROM coach_profiles WHERE user_id = ?',
    { replacements: [userId] },
  );
  return row;
}

describeHttp('HTTP integration: coach rating systems', () => {
  let server = null;
  let fixture = null;
  let token = null;
  const extraUserIds = [];

  before(async () => {
    server = await startTestServer();
    fixture = await createBookingJourneyFixture();
    token = await login(server.baseUrl, fixture.coach.email, fixture.password);
  });

  after(async () => {
    try {
      if (extraUserIds.length) {
        await CoachProfile.destroy({ where: { user_id: extraUserIds } });
        await UserRole.destroy({ where: { user_id: extraUserIds } });
        await User.destroy({ where: { id: extraUserIds } });
      }
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  const put = (body) => api(server.baseUrl, 'PUT', '/api/coaches/me/profile', { token, body });

  it('DUPR 4.217 survives DB and public API exactly', async () => {
    assert.deepEqual(await storedRating(fixture.coach.id), { skill_rating: '4.217', rating_system: 'DUPR' });
    const res = await api(server.baseUrl, 'GET', `/api/coaches/${fixture.coach.id}`, { token });
    assert.equal(res.status, 200, res.text);
    const p = profileOf(res);
    assert.equal(p.skill_rating, 4.217);
    assert.equal(p.rating_system, 'DUPR');
  });

  it('DUPR 7.218 round-trips through PUT and GET', async () => {
    const res = await put({ rating_system: 'DUPR', skill_rating: 7.218 });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.data.skill_rating, 7.218);
    assert.equal(res.json.data.rating_system, 'DUPR');
    assert.deepEqual(await storedRating(fixture.coach.id), { skill_rating: '7.218', rating_system: 'DUPR' });
  });

  it('partial: rating only on DUPR (7.218 → 7.5) is valid', async () => {
    const res = await put({ skill_rating: 7.5 });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.data.skill_rating, 7.5);
    assert.equal(res.json.data.rating_system, 'DUPR');
    await put({ skill_rating: 7.218 });
  });

  it('partial: system only DUPR 7.218 → UTR-P is rejected and nothing changes', async () => {
    const res = await put({ rating_system: 'UTR-P' });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.details[0].field, 'skill_rating');
    assert.match(res.json.details[0].message, /isn't a valid UTR-P rating/);
    assert.deepEqual(await storedRating(fixture.coach.id), { skill_rating: '7.218', rating_system: 'DUPR' });
  });

  it('partial: both DUPR 4.217 → UTR-P 4.2 is valid', async () => {
    await put({ rating_system: 'DUPR', skill_rating: 4.217 });
    const res = await put({ rating_system: 'UTR-P', skill_rating: 4.2 });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(await storedRating(fixture.coach.id), { skill_rating: '4.200', rating_system: 'UTR-P' });
  });

  it('UTR-P 9.5 stays 9.5 (not 9, not 9.500) and system-only → DUPR is rejected', async () => {
    const ok = await put({ rating_system: 'UTR-P', skill_rating: '9.5' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.data.skill_rating, 9.5);
    const unrelated = await put({ headline: 'Still UTR-P' });
    assert.equal(unrelated.status, 200, unrelated.text);
    assert.equal(unrelated.json.data.skill_rating, 9.5);
    const bad = await put({ rating_system: 'DUPR' });
    assert.equal(bad.status, 400, bad.text);
    assert.equal(bad.json.details[0].field, 'skill_rating');
    assert.deepEqual(await storedRating(fixture.coach.id), { skill_rating: '9.500', rating_system: 'UTR-P' });
  });

  it('certifications: stored as an array, shown on the public profile, cleared to []', async () => {
    const names = ['IPTPA Certified', 'PPA Coach Certified', 'Level 1, Advanced', 'c'.repeat(500)];
    const ok = await put({ certifications: [' IPTPA Certified ', '', ...names.slice(1), 'iptpa certified'] });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json.data.certifications, names);
    const [[row]] = await sequelize.query('SELECT certifications FROM coach_profiles WHERE user_id = ?', {
      replacements: [fixture.coach.id],
    });
    const stored = typeof row.certifications === 'string' ? JSON.parse(row.certifications) : row.certifications;
    assert.deepEqual(stored, names);
    const pub = await api(server.baseUrl, 'GET', `/api/coaches/${fixture.coach.id}`, { token });
    assert.deepEqual(profileOf(pub).certifications, names);

    const untouched = await put({ headline: 'Keeps certifications' });
    assert.deepEqual(untouched.json.data.certifications, names);

    const cleared = await put({ certifications: ['', ' '] });
    assert.equal(cleared.status, 200, cleared.text);
    assert.deepEqual(cleared.json.data.certifications, []);
  });

  it('certifications: per-row 500-character limit, 20-row limit, and text input are rejected', async () => {
    const long = await put({ certifications: ['PPR', 'c'.repeat(501)] });
    assert.equal(long.status, 400, long.text);
    assert.deepEqual(long.json.details, [{ field: 'certifications.1', message: 'Each certification must be 500 characters or fewer.' }]);
    const many = await put({ certifications: Array.from({ length: 21 }, (_, i) => `Cert ${i}`) });
    assert.equal(many.status, 400, many.text);
    assert.deepEqual(many.json.details, [{ field: 'certifications', message: 'You can list up to 20 certifications.' }]);
    const text = await put({ certifications: 'IPTPA, PPA' });
    assert.equal(text.status, 400, text.text);
    assert.equal(text.json.details[0].field, 'certifications');
  });

  it('bio: 1,000 characters saved, 1,001 rejected with a field error', async () => {
    const ok = await put({ bio: 'b'.repeat(1000) });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.data.bio, 'b'.repeat(1000));
    const bad = await put({ bio: 'b'.repeat(1001) });
    assert.equal(bad.status, 400, bad.text);
    assert.deepEqual(bad.json.details, [{ field: 'bio', message: 'Bio must be 1,000 characters or fewer.' }]);
  });

  it('rejects invalid values and systems without rounding', async () => {
    for (const body of [
      { rating_system: 'DUPR', skill_rating: 4.2175 },
      { rating_system: 'DUPR', skill_rating: 1.999 },
      { rating_system: 'DUPR', skill_rating: 8.001 },
      { rating_system: 'UTR-P', skill_rating: 9.55 },
      { rating_system: 'UTR-P', skill_rating: 0.9 },
      { rating_system: 'UTR-P', skill_rating: 10.1 },
      { rating_system: 'self', skill_rating: 4 },
      { rating_system: 'UTPR', skill_rating: 4 },
      { rating_system: '', skill_rating: 4 },
    ]) {
      const res = await put(body);
      assert.equal(res.status, 400, `${JSON.stringify(body)} → ${res.text}`);
    }
    assert.deepEqual(await storedRating(fixture.coach.id), { skill_rating: '9.500', rating_system: 'UTR-P' });
  });

  it('remove rating: skill_rating null is allowed', async () => {
    const res = await put({ skill_rating: null });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.data.skill_rating, null);
    await put({ rating_system: 'DUPR', skill_rating: 4.217 });
  });

  it('create: UTR-P 9.5 is stored and returned with its system; self is rejected', async () => {
    const email = `rating.create.${Date.now()}@picklecoach.example.org`;
    const user = await User.create({
      full_name: 'Rating Create Coach',
      email,
      password_hash: bcrypt.hashSync(fixture.password, 8),
      is_active: true,
      email_verified_at: new Date(),
      timezone: 'America/New_York',
    });
    extraUserIds.push(user.id);
    await UserRole.create({ user_id: user.id, role: 'coach' });
    const t = await login(server.baseUrl, email, fixture.password);

    const bad = await api(server.baseUrl, 'POST', '/api/coaches/profile', { token: t, body: { rating_system: 'self', skill_rating: 4 } });
    assert.equal(bad.status, 400, bad.text);
    const noSystem = await api(server.baseUrl, 'POST', '/api/coaches/profile', { token: t, body: { skill_rating: 4 } });
    assert.equal(noSystem.status, 400, noSystem.text);
    assert.equal(noSystem.json.details[0].field, 'rating_system');

    const res = await api(server.baseUrl, 'POST', '/api/coaches/profile', {
      token: t,
      body: { headline: 'New coach', rating_system: 'UTR-P', skill_rating: 9.5 },
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.data.skill_rating, 9.5);
    assert.equal(res.json.data.rating_system, 'UTR-P');
    assert.deepEqual(await storedRating(user.id), { skill_rating: '9.500', rating_system: 'UTR-P' });
  });

  describe('Discover filtering', () => {
    const listIds = async (query) => {
      const res = await api(server.baseUrl, 'GET', `/api/coaches?${query}`, { token });
      assert.equal(res.status, 200, res.text);
      const rows = Array.isArray(res.json.data) ? res.json.data : res.json.data?.items || [];
      return { ids: rows.map((c) => c.id), rows };
    };

    it('Any: coach is listed with rating + system, no skill filtering', async () => {
      const { ids, rows } = await listIds('');
      assert.ok(ids.includes(fixture.coach.id));
      const me = rows.find((c) => c.id === fixture.coach.id);
      assert.equal(me.skill_rating, 4.217);
      assert.equal(me.rating_system, 'DUPR');
    });

    it('DUPR range includes the DUPR coach; UTR-P with an overlapping number excludes it', async () => {
      assert.ok((await listIds('rating_system=DUPR&min_skill_rating=4.2&max_skill_rating=4.3')).ids.includes(fixture.coach.id));
      assert.ok(!(await listIds('rating_system=DUPR&min_skill_rating=5')).ids.includes(fixture.coach.id));
      const utrp = await listIds('rating_system=UTR-P&min_skill_rating=4.0&max_skill_rating=4.5');
      assert.ok(!utrp.ids.includes(fixture.coach.id));
      assert.ok(utrp.rows.every((c) => c.rating_system === 'UTR-P'));
    });

    it('UTR-P only lists UTR-P coaches', async () => {
      await put({ rating_system: 'UTR-P', skill_rating: 9.5 });
      try {
        const { ids, rows } = await listIds('rating_system=UTR-P&min_skill_rating=9.0');
        assert.ok(ids.includes(fixture.coach.id));
        assert.ok(rows.every((c) => c.rating_system === 'UTR-P' && c.skill_rating >= 9.0));
        assert.ok(!(await listIds('rating_system=DUPR')).ids.includes(fixture.coach.id));
      } finally {
        await put({ rating_system: 'DUPR', skill_rating: 4.217 });
      }
    });

    it('rejects skill bounds without a system and out-of-scale bounds', async () => {
      const noSystem = await api(server.baseUrl, 'GET', '/api/coaches?min_skill_rating=4', { token });
      assert.equal(noSystem.status, 400, noSystem.text);
      const outOfScale = await api(server.baseUrl, 'GET', '/api/coaches?rating_system=DUPR&max_skill_rating=9.5', { token });
      assert.equal(outOfScale.status, 400, outOfScale.text);
      const self = await api(server.baseUrl, 'GET', '/api/coaches?rating_system=self', { token });
      assert.equal(self.status, 400, self.text);
    });
  });
});

if (!RUN) {
  describe('HTTP integration (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
