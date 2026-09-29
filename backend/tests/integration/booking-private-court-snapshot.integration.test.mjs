/**
 * Private-court address visibility with booking court snapshots.
 *
 * - Pending: student sees area only; coach sees the street.
 * - Confirmed: student sees the street.
 * - Changing the live court's privacy afterwards does not change what an existing
 *   booking reveals — the privacy captured at booking time applies.
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

async function bookFixture(baseUrl, fixture, studentToken) {
  const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
    token: studentToken,
    body: {
      lesson_id: fixture.lesson.id,
      scheduled_at: fixture.scheduledAt.toISOString(),
      court_location_id: fixture.court.id,
      payment_method: 'stripe',
      idempotency_key: `priv_court_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    },
  });
  assert.equal(intentRes.status, 201, intentRes.text);
  const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
    token: studentToken,
    body: { payment_intent_id: intentRes.json.data.payment_intent_id },
  });
  assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
  return confirmRes.json.data.booking.id;
}

/** Court as the viewer sees it on booking detail and in their bookings list. */
async function courtViews(baseUrl, bookingId, token, role) {
  const detail = await api(baseUrl, 'GET', `/api/bookings/${bookingId}`, { token });
  assert.equal(detail.status, 200, detail.text);
  const detailBooking = detail.json?.data?.booking ?? detail.json?.data;

  const listPath = role === 'coach' ? '/api/coaches/me/bookings' : '/api/students/me/bookings';
  const list = await api(baseUrl, 'GET', listPath, { token });
  assert.equal(list.status, 200, list.text);
  const rows = Array.isArray(list.json?.data) ? list.json.data : (list.json?.data?.bookings || []);
  const listBooking = rows.find((b) => Number(b.id) === Number(bookingId));
  assert.ok(listBooking, `booking ${bookingId} missing from list`);

  return [detailBooking.courtLocation, listBooking.courtLocation];
}

function assertRedacted(court, label) {
  assert.equal(court.is_private, true, `${label}: is_private`);
  assert.equal(court.address_line1, null, `${label}: street must be hidden`);
  assert.equal(court.latitude, null, `${label}: latitude must be hidden`);
  assert.equal(court.longitude, null, `${label}: longitude must be hidden`);
  assert.ok(court.area, `${label}: coarse area still shown`);
}

function assertRevealed(court, street, label) {
  assert.equal(court.address_line1, street, `${label}: street visible`);
}

describeHttp('HTTP integration: private court visibility uses the booking snapshot', () => {
  let server = null;
  const fixtures = [];

  before(async () => {
    stripeService.setStripeTestDouble(createInMemoryPaymentIntentDouble());
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      for (const f of fixtures) if (f?.cleanup) await f.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('private at booking: hidden while pending, revealed when confirmed, unaffected by later privacy changes', async () => {
    const fixture = await createBookingJourneyFixture();
    fixtures.push(fixture);
    const { baseUrl } = server;
    const court = await CourtLocation.findByPk(fixture.court.id);
    await court.update({ is_private: true });
    const street = court.address_line1;

    const studentToken = await login(baseUrl, fixture.student.email, fixture.password);
    const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);
    const bookingId = await bookFixture(baseUrl, fixture, studentToken);

    const row = await Booking.findByPk(bookingId);
    assert.equal(row.status, 'pending');
    assert.equal(row.court_is_private_at_booking, true);

    // Pending: student redacted, coach sees street.
    for (const [i, c] of (await courtViews(baseUrl, bookingId, studentToken, "student")).entries()) {
      assertRedacted(c, `pending student ${i ? 'list' : 'detail'}`);
    }
    for (const c of await courtViews(baseUrl, bookingId, coachToken, "coach")) {
      assertRevealed(c, street, 'pending coach');
    }

    // Court made public afterwards: the pending booking must stay redacted for the student.
    await court.update({ is_private: false });
    for (const [i, c] of (await courtViews(baseUrl, bookingId, studentToken, "student")).entries()) {
      assertRedacted(c, `pending student after court made public ${i ? 'list' : 'detail'}`);
    }
    for (const c of await courtViews(baseUrl, bookingId, coachToken, "coach")) {
      assertRevealed(c, street, 'pending coach after court made public');
    }

    // Coach accepts → confirmed: student now sees the booked street.
    const accept = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, { token: coachToken });
    assert.equal(accept.status, 200, accept.text);
    assert.equal((await Booking.findByPk(bookingId)).status, 'confirmed');
    for (const c of await courtViews(baseUrl, bookingId, studentToken, "student")) {
      assertRevealed(c, street, 'confirmed student');
    }

    // Court made private again with a new street: the booking keeps the booked street.
    await court.update({ is_private: true, address_line1: '42 Moved Rd' });
    for (const c of await courtViews(baseUrl, bookingId, studentToken, "student")) {
      assertRevealed(c, street, 'confirmed student after court edited');
      assert.notEqual(c.address_line1, '42 Moved Rd');
    }
  });

  it('public at booking: making the court private later does not re-hide what the student already saw', async () => {
    const fixture = await createBookingJourneyFixture();
    fixtures.push(fixture);
    const { baseUrl } = server;
    const court = await CourtLocation.findByPk(fixture.court.id);
    assert.equal(court.is_private, false);
    const street = court.address_line1;

    const studentToken = await login(baseUrl, fixture.student.email, fixture.password);
    const bookingId = await bookFixture(baseUrl, fixture, studentToken);
    assert.equal((await Booking.findByPk(bookingId)).court_is_private_at_booking, false);

    await court.update({ is_private: true, address_line1: '7 Secret Ln' });
    for (const c of await courtViews(baseUrl, bookingId, studentToken, "student")) {
      assert.equal(c.is_private, false);
      assertRevealed(c, street, 'pending student, court privatised later');
      assert.notEqual(c.address_line1, '7 Secret Ln', 'new private street must never leak');
    }
  });
});

if (!RUN) {
  describe('HTTP integration (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
