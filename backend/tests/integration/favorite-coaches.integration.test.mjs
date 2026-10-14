/**
 * HTTP integration: a student saving coaches.
 *
 * Run from backend/:
 *   NODE_ENV=test DB_NAME=picklecoach_test RUN_HTTP_INTEGRATION=1 SKIP_SERVER_LISTEN=1 \
 *     node --import ./tests/helpers/loadIntegrationEnv.mjs --test --test-concurrency=1 --test-force-exit \
 *     tests/integration/favorite-coaches.integration.test.mjs
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { FavoriteCoach, sequelize } from '../../models/index.js';
import { createBookingJourneyFixture } from '../helpers/integrationFixture.mjs';
import { api, startTestServer } from '../helpers/httpApp.mjs';

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

describeHttp('HTTP integration: favorite coaches', () => {
  let server = null;
  let fixture = null;
  let other = null;
  let studentToken;
  let otherStudentToken;
  let coachToken;

  before(async () => {
    server = await startTestServer();
    fixture = await createBookingJourneyFixture();
    other = await createBookingJourneyFixture();
    studentToken = await login(server.baseUrl, fixture.student.email, fixture.password);
    otherStudentToken = await login(server.baseUrl, other.student.email, other.password);
    coachToken = await login(server.baseUrl, fixture.coach.email, fixture.password);
  });

  after(async () => {
    const studentIds = [fixture?.student.id, other?.student.id].filter(Boolean);
    if (studentIds.length) await FavoriteCoach.destroy({ where: { student_id: studentIds } });
    await fixture?.cleanup?.();
    await other?.cleanup?.();
    if (server) await server.close();
  });

  it('saves a coach, keeps it after a new login, and does not create a duplicate', async () => {
    const coachId = fixture.coach.id;
    const first = await api(server.baseUrl, 'POST', '/api/students/me/favorites', {
      token: studentToken,
      body: { coach_id: coachId },
    });
    assert.equal(first.status, 201, first.text);
    assert.equal(first.json.data.created, true);

    const again = await api(server.baseUrl, 'POST', '/api/students/me/favorites', {
      token: studentToken,
      body: { coach_id: coachId },
    });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.json.data.created, false);
    assert.equal(await FavoriteCoach.count({ where: { student_id: fixture.student.id, coach_id: coachId } }), 1);

    const freshToken = await login(server.baseUrl, fixture.student.email, fixture.password);
    const list = await api(server.baseUrl, 'GET', '/api/students/me/favorites', { token: freshToken });
    assert.equal(list.status, 200, list.text);
    assert.equal(list.json.data.length, 1);
    assert.equal(list.json.data[0].id, coachId);
    assert.equal(list.json.data[0].available, true);
    assert.equal(list.json.data[0].email, undefined);
    const ids = await api(server.baseUrl, 'GET', '/api/students/me/favorites/ids', { token: freshToken });
    assert.deepEqual(ids.json.data.coach_ids, [coachId]);
  });

  it('one student cannot read or change another student’s favorites', async () => {
    const list = await api(server.baseUrl, 'GET', '/api/students/me/favorites', { token: otherStudentToken });
    assert.equal(list.status, 200, list.text);
    assert.equal(list.json.data.length, 0);
    const removed = await api(server.baseUrl, 'DELETE', `/api/students/me/favorites/${fixture.coach.id}`, {
      token: otherStudentToken,
    });
    assert.equal(removed.status, 200, removed.text);
    assert.equal(await FavoriteCoach.count({ where: { student_id: fixture.student.id, coach_id: fixture.coach.id } }), 1);
  });

  it('rejects saving yourself, a non-coach, and unauthenticated access', async () => {
    const self = await api(server.baseUrl, 'POST', '/api/students/me/favorites', {
      token: studentToken,
      body: { coach_id: fixture.student.id },
    });
    assert.equal(self.status, 400, self.text);

    const notCoach = await api(server.baseUrl, 'POST', '/api/students/me/favorites', {
      token: studentToken,
      body: { coach_id: other.student.id },
    });
    assert.equal(notCoach.status, 404, notCoach.text);

    const anon = await api(server.baseUrl, 'GET', '/api/students/me/favorites');
    assert.equal(anon.status, 401, anon.text);

    const asCoach = await api(server.baseUrl, 'GET', '/api/students/me/favorites', { token: coachToken });
    assert.equal(asCoach.status, 403, asCoach.text);
  });

  it('removing a favorite is idempotent and drops it from the list', async () => {
    const coachId = fixture.coach.id;
    const gone = await api(server.baseUrl, 'DELETE', `/api/students/me/favorites/${coachId}`, { token: studentToken });
    assert.equal(gone.status, 200, gone.text);
    const again = await api(server.baseUrl, 'DELETE', `/api/students/me/favorites/${coachId}`, { token: studentToken });
    assert.equal(again.status, 200, again.text);
    const list = await api(server.baseUrl, 'GET', '/api/students/me/favorites', { token: studentToken });
    assert.equal(list.json.data.length, 0);
  });
});
