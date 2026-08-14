/**
 * Deep HTTP integration: authorize → confirm → coach accept → capture.
 *
 * HTTP → Express → middleware → controller → service → MySQL → Stripe double
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking, Payment } from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { calculatePaymentAmounts, dollarsToCents } from '../../services/paymentEngine.js';
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

describeHttp('HTTP integration: booking authorize → confirm → accept → capture', () => {
  let server = null;
  let fixture = null;
  let stripeDouble = null;

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
      // Do not sequelize.close() here — other integration files in the same
      // `node --test` process still need the pool (--test-force-exit handles exit).
    }
  });

  it('completes student authorize-confirm and coach accept with correct DB money state', async () => {
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    const amounts = calculatePaymentAmounts(100);

    const studentLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.student.email, password: fixture.password },
    });
    assert.equal(studentLogin.status, 200, studentLogin.text);
    const studentToken = studentLogin.json.data.token;

    const coachLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.coach.email, password: fixture.password },
    });
    assert.equal(coachLogin.status, 200, coachLogin.text);
    const coachToken = coachLogin.json.data.token;

    const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        idempotency_key: `http_int_${Date.now()}`,
      },
    });
    assert.equal(intentRes.status, 201, intentRes.text);
    const paymentIntentId = intentRes.json.data.payment_intent_id;
    assert.ok(paymentIntentId);
    assert.equal(intentRes.json.data.amount, 100);

    const pi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(pi.status, 'requires_capture');
    assert.ok(pi.amount_capturable > 0);

    const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
      token: studentToken,
      body: { payment_intent_id: paymentIntentId },
    });
    assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
    const bookingId = confirmRes.json?.data?.booking?.id;
    assert.ok(bookingId, confirmRes.text);

    let booking = await Booking.findByPk(bookingId);
    let payment = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(booking.status, 'pending');
    assert.equal(payment.payment_status, 'authorized');
    assert.equal(payment.escrow_status, 'pending');
    assert.equal(payment.payment_intent_id, paymentIntentId);
    assert.equal(Number(payment.platform_fee_percent), 8);
    assert.equal(dollarsToCents(payment.total_charge_to_student), dollarsToCents(amounts.total_charge_to_student));

    const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
      token: coachToken,
    });
    assert.equal(acceptRes.status, 200, acceptRes.text);

    booking = await Booking.findByPk(bookingId);
    payment = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(booking.status, 'confirmed');
    assert.equal(payment.payment_status, 'captured');
    assert.equal(payment.escrow_status, 'held');
    assert.ok(payment.charge_id);

    const capturedPi = await stripeDouble.getPaymentIntent(paymentIntentId);
    assert.equal(capturedPi.status, 'succeeded');
    assert.equal(capturedPi.latest_charge, payment.charge_id);

    assert.equal(dollarsToCents(payment.platform_fee_amount), 800);
    assert.equal(dollarsToCents(payment.coach_payout_expected), 9200);
    assert.equal(dollarsToCents(payment.total_charge_to_student), 10000);
  });

  it('coach decline voids authorization without holding escrow', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;

    const studentLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.student.email, password: fixture.password },
    });
    const coachLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.coach.email, password: fixture.password },
    });
    const studentToken = studentLogin.json.data.token;
    const coachToken = coachLogin.json.data.token;

    const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        idempotency_key: `http_decline_${Date.now()}`,
      },
    });
    assert.equal(intentRes.status, 201, intentRes.text);
    const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
      token: studentToken,
      body: { payment_intent_id: intentRes.json.data.payment_intent_id },
    });
    assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
    const bookingId = confirmRes.json?.data?.booking?.id;

    const declineRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/decline`, {
      token: coachToken,
      body: {
        message_to_student: 'Slot no longer works.',
        decline_reason_code: 'availability_conflict',
      },
    });
    assert.equal(declineRes.status, 200, declineRes.text);

    const booking = await Booking.findByPk(bookingId);
    const payment = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(booking.status, 'cancelled');
    assert.equal(payment.payment_status, 'pending_void');
    assert.equal(payment.escrow_status, 'released');
    assert.equal(payment.charge_id, null);
  });
});

if (!RUN) {
  describe('HTTP integration (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
