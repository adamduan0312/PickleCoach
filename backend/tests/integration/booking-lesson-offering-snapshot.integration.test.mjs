/**
 * Historical lesson offering: a booking keeps the lesson_type / max_players that
 * were true when it was booked, even after the coach edits the lesson.
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking, CourtLocation } from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { createInMemoryPaymentIntentDouble } from '../helpers/inMemoryPaymentIntentDouble.mjs';
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

function bookingFromDetail(res) {
  return res.json?.data?.booking ?? res.json?.data;
}

describeHttp('HTTP integration: booking keeps lesson offering snapshot', () => {
  let server = null;
  let fixture = null;

  before(async () => {
    stripeService.setStripeTestDouble(createInMemoryPaymentIntentDouble());
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('group booking stays Group · up to 6 after the lesson is edited to Private', async () => {
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const studentToken = await login(baseUrl, fixture.student.email, fixture.password);
    const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);

    const toGroup = await api(baseUrl, 'PUT', `/api/lessons/${fixture.lesson.id}`, {
      token: coachToken,
      body: { lesson_type: 'group', max_players: 6 },
    });
    assert.equal(toGroup.status, 200, toGroup.text);

    const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        idempotency_key: `snapshot_${Date.now()}`,
      },
    });
    assert.equal(intentRes.status, 201, intentRes.text);

    const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
      token: studentToken,
      body: { payment_intent_id: intentRes.json.data.payment_intent_id },
    });
    assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
    const bookingId = confirmRes.json.data.booking.id;
    assert.equal(confirmRes.json.data.booking.lesson_type_at_booking, 'group');
    assert.equal(confirmRes.json.data.booking.max_players_at_booking, 6);

    const row = await Booking.findByPk(bookingId);
    assert.equal(row.lesson_type_at_booking, 'group');
    assert.equal(row.max_players_at_booking, 6);
    assert.equal(row.primary_student_id, fixture.student.id);

    const toPrivate = await api(baseUrl, 'PUT', `/api/lessons/${fixture.lesson.id}`, {
      token: coachToken,
      body: { lesson_type: 'private', max_players: null },
    });
    assert.equal(toPrivate.status, 200, toPrivate.text);

    for (const token of [studentToken, coachToken]) {
      const detail = await api(baseUrl, 'GET', `/api/bookings/${bookingId}`, { token });
      assert.equal(detail.status, 200, detail.text);
      const booking = bookingFromDetail(detail);
      assert.equal(booking.lesson_type_at_booking, 'group');
      assert.equal(booking.max_players_at_booking, 6);
      assert.equal(booking.lesson.lesson_type, 'private');
      assert.equal(booking.lesson.max_players, null);
    }
  });

  it('lesson title/duration/price and court edits after booking do not change the booking', async () => {
    const { baseUrl } = server;
    const studentToken = await login(baseUrl, fixture.student.email, fixture.password);
    const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);
    const row = await Booking.findOne({
      where: { lesson_id: fixture.lesson.id, primary_student_id: fixture.student.id },
    });
    const bookedTitle = fixture.lesson.title;
    const bookedCourt = await CourtLocation.findByPk(fixture.court.id);
    const bookedCourtName = bookedCourt.name;
    const bookedStreet = bookedCourt.address_line1;
    assert.equal(row.lesson_title_at_booking, bookedTitle);
    assert.equal(row.court_name_at_booking, bookedCourtName);
    assert.equal(row.court_address_line1_at_booking, bookedStreet);

    const edit = await api(baseUrl, 'PUT', `/api/lessons/${fixture.lesson.id}`, {
      token: coachToken,
      body: { title: 'Renamed After Booking', duration_minutes: 90, price: 175 },
    });
    assert.equal(edit.status, 200, edit.text);
    await bookedCourt.update({ name: 'Renamed Court After Booking', address_line1: '999 Changed Ave' });

    try {
      for (const token of [studentToken, coachToken]) {
        const detail = await api(baseUrl, 'GET', `/api/bookings/${row.id}`, { token });
        assert.equal(detail.status, 200, detail.text);
        const booking = bookingFromDetail(detail);
        assert.equal(booking.lesson_title_at_booking, bookedTitle);
        assert.equal(booking.lesson.title, 'Renamed After Booking');
        assert.equal(booking.duration_minutes, row.duration_minutes);
        assert.equal(Number(booking.price), Number(row.price));
        assert.equal(booking.court_location_id, fixture.court.id);
        assert.equal(booking.courtLocation.id, fixture.court.id);
        assert.equal(booking.courtLocation.name, bookedCourtName);
        if (booking.courtLocation.address_line1 != null) {
          assert.equal(booking.courtLocation.address_line1, bookedStreet);
        }
      }
    } finally {
      await bookedCourt.update({ name: bookedCourtName, address_line1: bookedStreet });
    }
  });

  it('legacy booking with NULL snapshot exposes the lesson current values for fallback', async () => {
    const { baseUrl } = server;
    const studentToken = await login(baseUrl, fixture.student.email, fixture.password);
    const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);

    const legacy = await Booking.findOne({
      where: { lesson_id: fixture.lesson.id, primary_student_id: fixture.student.id },
    });
    await legacy.update({
      lesson_type_at_booking: null,
      max_players_at_booking: null,
      lesson_title_at_booking: null,
      court_name_at_booking: null,
    });

    const toGroup = await api(baseUrl, 'PUT', `/api/lessons/${fixture.lesson.id}`, {
      token: coachToken,
      body: { lesson_type: 'group', max_players: 4 },
    });
    assert.equal(toGroup.status, 200, toGroup.text);

    const detail = await api(baseUrl, 'GET', `/api/bookings/${legacy.id}`, { token: studentToken });
    assert.equal(detail.status, 200, detail.text);
    const booking = bookingFromDetail(detail);
    assert.equal(booking.lesson_type_at_booking, null);
    assert.equal(booking.max_players_at_booking, null);
    assert.equal(booking.lesson.lesson_type, 'group');
    assert.equal(booking.lesson.max_players, 4);
    assert.equal(booking.lesson_title_at_booking, null);
    assert.equal(booking.lesson.title, 'Renamed After Booking');
    const liveCourt = await CourtLocation.findByPk(fixture.court.id);
    assert.equal(booking.courtLocation.name, liveCourt.name);
  });
});

if (!RUN) {
  describe('HTTP integration (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
