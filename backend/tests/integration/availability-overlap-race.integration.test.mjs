/**
 * Concurrent overlapping availability create must yield exactly one success.
 *
 * Uses a coach-row FOR UPDATE lock so two empty-table inserts cannot both pass
 * the overlap check.
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, CoachAvailability } from '../../models/index.js';
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

describeHttp('HTTP integration: concurrent availability overlap race', () => {
  let server = null;
  let fixture = null;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    try {
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('allows exactly one overlapping create under concurrency', async () => {
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;

    const login = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.coach.email, password: fixture.password },
    });
    assert.equal(login.status, 200, login.text);
    const coachToken = login.json.data.token;

    // Fixture already owns Mon–Fri; use Saturday so both requests compete on an empty weekday.
    const body = {
      weekday: 6,
      start_time: '10:00:00',
      end_time: '12:00:00',
    };

    const before = await CoachAvailability.count({
      where: { coach_id: fixture.coach.id, weekday: 6 },
    });
    assert.equal(before, 0);

    const [a, b] = await Promise.all([
      api(baseUrl, 'POST', '/api/coaches/me/availability', { token: coachToken, body }),
      api(baseUrl, 'POST', '/api/coaches/me/availability', { token: coachToken, body }),
    ]);

    const results = [a, b];
    const successes = results.filter((r) => r.status === 200 || r.status === 201);
    const failures = results.filter((r) => r.status !== 200 && r.status !== 201);

    assert.equal(
      successes.length,
      1,
      `expected exactly one create success, got ${results.map((r) => `${r.status}:${r.text}`).join(' | ')}`,
    );
    assert.equal(failures.length, 1);
    assert.equal(failures[0].status, 400, failures[0].text);
    assert.match(String(failures[0].json?.message || failures[0].text), /overlap/i);

    const after = await CoachAvailability.count({
      where: { coach_id: fixture.coach.id, weekday: 6 },
    });
    assert.equal(after, 1);
  });
});

if (!RUN) {
  describe('HTTP integration availability overlap race (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
