/**
 * Availability windows over HTTP: conflict messages name the clashing window, and calendar-date
 * rules (real dates, no already-ended ranges, 24-month ceiling) apply to create and update.
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
import { calendarDateInTimezone } from '../../utils/dateOnly.js';
import { addMonthsYmd } from '../../utils/availabilityRules.js';

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

function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

describeHttp('HTTP integration: availability rules', () => {
  let server = null;
  let fixture = null;
  let token = null;
  let today = null;
  const SAT = 6;

  before(async () => {
    server = await startTestServer();
    fixture = await createBookingJourneyFixture();
    const login = await api(server.baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.coach.email, password: fixture.password },
    });
    assert.equal(login.status, 200, login.text);
    token = login.json.data.token;
    today = calendarDateInTimezone(new Date(), fixture.coach.timezone || 'UTC');
  });

  after(async () => {
    try {
      if (fixture?.coach?.id) await CoachAvailability.destroy({ where: { coach_id: fixture.coach.id, weekday: SAT } });
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  const post = (body) => api(server.baseUrl, 'POST', '/api/coaches/me/availability', { token, body });
  const put = (id, body) => api(server.baseUrl, 'PUT', `/api/coaches/me/availability/${id}`, { token, body });

  it('overlap message names the existing window and both explicit fixes; touching windows are allowed', async () => {
    const first = await post({ weekday: SAT, start_time: '09:00', end_time: '12:00' });
    assert.equal(first.status, 200, first.text);

    const clash = await post({ weekday: SAT, start_time: '09:00', end_time: '16:00' });
    assert.equal(clash.status, 400, clash.text);
    assert.equal(
      clash.json.message,
      'This overlaps your Saturday 9:00 AM–12:00 PM window. Edit that window to 9:00 AM–4:00 PM, or add 12:00 PM–4:00 PM instead.',
    );
    assert.equal(clash.json.conflict_availability_id, first.json.data.id);

    const touching = await post({ weekday: SAT, start_time: '12:00', end_time: '16:00' });
    assert.equal(touching.status, 200, touching.text);

    const edited = await put(first.json.data.id, { weekday: SAT, start_time: '09:00', end_time: '13:00' });
    assert.equal(edited.status, 400, edited.text);
    assert.match(edited.json.message, /^This overlaps your Saturday 12:00 PM–4:00 PM window\. Edit that window to 9:00 AM–4:00 PM, or add 9:00 AM–12:00 PM instead\.$/);

    await CoachAvailability.destroy({ where: { coach_id: fixture.coach.id, weekday: SAT } });
  });

  it('rejects impossible dates, already-ended ranges, and dates beyond 24 months with field errors', async () => {
    const cases = [
      [{ start_date: '2026-13-45' }, 'start_date', /real calendar date/],
      [{ end_date: '2026-02-30' }, 'end_date', /real calendar date/],
      [{ start_date: addDays(today, -30), end_date: addDays(today, -1) }, 'end_date', /has already passed/],
      [{ start_date: addDays(addMonthsYmd(today, 24), 1) }, 'start_date', /at most 24 months ahead/],
      [{ end_date: '9999-12-31' }, 'end_date', /at most 24 months ahead/],
    ];
    for (const [dates, field, pattern] of cases) {
      const res = await post({ weekday: SAT, start_time: '09:00', end_time: '10:00', ...dates });
      assert.equal(res.status, 400, `${JSON.stringify(dates)} → ${res.text}`);
      assert.equal(res.json.details[0].field, field, res.text);
      assert.match(res.json.details[0].message, pattern);
    }
    assert.equal(await CoachAvailability.count({ where: { coach_id: fixture.coach.id, weekday: SAT } }), 0);
  });

  it('accepts a past start with an open end, an end date of today, and a far-future start within 24 months', async () => {
    for (const [start, end, dates] of [
      ['07:00', '08:00', { start_date: addDays(today, -30) }],
      ['08:00', '09:00', { end_date: today }],
      ['10:00', '11:00', { start_date: addMonthsYmd(today, 24) }],
    ]) {
      const res = await post({ weekday: SAT, start_time: start, end_time: end, ...dates });
      assert.equal(res.status, 200, `${JSON.stringify(dates)} → ${res.text}`);
    }
  });

  it('update enforces the same date rules', async () => {
    const [row] = await CoachAvailability.findAll({ where: { coach_id: fixture.coach.id, weekday: SAT }, limit: 1 });
    const res = await put(row.id, {
      weekday: SAT, start_time: '07:00', end_time: '08:00', start_date: addDays(today, -10), end_date: addDays(today, -2),
    });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.details[0].field, 'end_date');
  });
});

if (!RUN) {
  describe('HTTP integration availability rules (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
