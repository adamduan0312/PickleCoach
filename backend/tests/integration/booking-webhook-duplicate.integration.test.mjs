/**
 * Deep HTTP integration: Stripe webhook duplicate delivery must not re-apply money state.
 *
 * Stripe can deliver the same event.id more than once. After a successful process:
 *   - second delivery returns `{ received: true, duplicate: true }`
 *   - exactly one webhook_logs row
 *   - payment/booking side effects happen once
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import {
  sequelize,
  Booking,
  Payment,
  WebhookLog,
  AuditLog,
} from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { createInMemoryPaymentIntentDouble } from '../helpers/inMemoryPaymentIntentDouble.mjs';
import { createBookingJourneyFixture } from '../helpers/integrationFixture.mjs';
import { startTestServer, api, postStripeWebhook } from '../helpers/httpApp.mjs';

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

describeHttp('HTTP integration: Stripe webhook duplicate delivery', () => {
  let server = null;
  let fixture = null;
  let stripeDouble = null;
  /** @type {string[]} */
  const eventIds = [];

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      if (eventIds.length) {
        await WebhookLog.destroy({ where: { provider: 'stripe', event_id: eventIds } });
      }
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('processes payment_intent.succeeded once and skips the replay', async () => {
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;

    const studentLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.student.email, password: fixture.password },
    });
    assert.equal(studentLogin.status, 200, studentLogin.text);
    const studentToken = studentLogin.json.data.token;

    const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        idempotency_key: `wh_dup_${Date.now()}`,
      },
    });
    assert.equal(intentRes.status, 201, intentRes.text);
    const paymentIntentId = intentRes.json.data.payment_intent_id;

    const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
      token: studentToken,
      body: { payment_intent_id: paymentIntentId },
    });
    assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
    const bookingId = confirmRes.json?.data?.booking?.id;
    assert.ok(bookingId);

    const paymentBefore = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(paymentBefore.payment_status, 'authorized');
    assert.equal(paymentBefore.escrow_status, 'pending');

    // Stripe reports capture success via webhook (manual-capture PI already authorized in double).
    const chargeId = `ch_wh_${Date.now()}`;
    const piRow = stripeDouble.intents.get(paymentIntentId);
    piRow.status = 'succeeded';
    piRow.chargeId = chargeId;

    const eventId = `evt_test_pi_succeeded_${Date.now()}`;
    eventIds.push(eventId);
    const event = {
      id: eventId,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: paymentIntentId,
          status: 'succeeded',
          latest_charge: chargeId,
          charges: { data: [{ id: chargeId }] },
        },
      },
    };

    const first = await postStripeWebhook(baseUrl, event);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json?.received, true);
    assert.notEqual(first.json?.duplicate, true);

    const bookingAfterFirst = await Booking.findByPk(bookingId);
    const paymentAfterFirst = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(bookingAfterFirst.status, 'confirmed');
    assert.equal(paymentAfterFirst.payment_status, 'captured');
    assert.equal(paymentAfterFirst.escrow_status, 'held');
    assert.equal(paymentAfterFirst.charge_id, chargeId);

    const auditsAfterFirst = await AuditLog.count({
      where: { table_name: 'payments', record_id: paymentAfterFirst.id, action: 'payment_captured' },
    });
    assert.equal(auditsAfterFirst, 1);

    const second = await postStripeWebhook(baseUrl, event);
    assert.equal(second.status, 200, second.text);
    assert.deepEqual(second.json, { received: true, duplicate: true });

    const logs = await WebhookLog.findAll({
      where: { provider: 'stripe', event_id: eventId },
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].success, true);
    assert.equal(logs[0].event_type, 'payment_intent.succeeded');

    const bookingAfterSecond = await Booking.findByPk(bookingId);
    const paymentAfterSecond = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(bookingAfterSecond.status, 'confirmed');
    assert.equal(paymentAfterSecond.payment_status, 'captured');
    assert.equal(paymentAfterSecond.escrow_status, 'held');
    assert.equal(paymentAfterSecond.charge_id, chargeId);

    const auditsAfterSecond = await AuditLog.count({
      where: { table_name: 'payments', record_id: paymentAfterFirst.id, action: 'payment_captured' },
    });
    assert.equal(auditsAfterSecond, 1, 'replay must not create a second payment_captured audit');
  });

  it('replays payment_intent.canceled without double-applying void', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;

    const studentLogin = await api(baseUrl, 'POST', '/api/auth/login', {
      body: { email: fixture.student.email, password: fixture.password },
    });
    assert.equal(studentLogin.status, 200, studentLogin.text);
    const studentToken = studentLogin.json.data.token;

    const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
      token: studentToken,
      body: {
        lesson_id: fixture.lesson.id,
        scheduled_at: fixture.scheduledAt.toISOString(),
        court_location_id: fixture.court.id,
        payment_method: 'stripe',
        idempotency_key: `wh_cancel_${Date.now()}`,
      },
    });
    assert.equal(intentRes.status, 201, intentRes.text);
    const paymentIntentId = intentRes.json.data.payment_intent_id;
    const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
      token: studentToken,
      body: { payment_intent_id: paymentIntentId },
    });
    assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
    const bookingId = confirmRes.json?.data?.booking?.id;

    const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
      token: studentToken,
      body: { reason: 'schedule_conflict' },
    });
    assert.equal(cancelRes.status, 200, cancelRes.text);

    const eventId = `evt_test_pi_canceled_${Date.now()}`;
    eventIds.push(eventId);
    const event = {
      id: eventId,
      type: 'payment_intent.canceled',
      data: {
        object: {
          id: paymentIntentId,
          status: 'canceled',
        },
      },
    };

    const first = await postStripeWebhook(baseUrl, event);
    assert.equal(first.status, 200, first.text);
    const paymentAfterFirst = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(paymentAfterFirst.payment_status, 'failed');
    assert.equal(paymentAfterFirst.escrow_status, 'released');
    assert.equal(paymentAfterFirst.charge_id, null);

    const second = await postStripeWebhook(baseUrl, event);
    assert.equal(second.status, 200, second.text);
    assert.deepEqual(second.json, { received: true, duplicate: true });

    const paymentAfterSecond = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal(paymentAfterSecond.payment_status, 'failed');
    assert.equal(paymentAfterSecond.escrow_status, 'released');
  });

  it('rejects unsigned webhook bodies', async () => {
    const res = await api(server.baseUrl, 'POST', '/api/webhooks/stripe', {
      rawBody: JSON.stringify({
        id: 'evt_unsigned',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_x' } },
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 400, res.text);
  });
});

if (!RUN) {
  describe('HTTP integration webhook-duplicate (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
