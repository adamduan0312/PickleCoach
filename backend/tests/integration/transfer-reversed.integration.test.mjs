/**
 * HTTP + DB integration: Stripe `transfer.reversed`.
 *
 * Canonical reverse:
 *   - escrow → manual_payout_required
 *   - payout row → failed
 *   - booking.payout_status paid|processing → pending
 *   - no auto re-transfer
 *
 * Non-canonical (duplicate transfer id ≠ payment.transfer_id):
 *   - acknowledge only; escrow / booking / payout unchanged
 *
 * Idempotent: second identical canonical reverse leaves parked state.
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
  Payout,
  WebhookLog,
  AuditLog,
} from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { createInMemoryPaymentIntentDouble } from '../helpers/inMemoryPaymentIntentDouble.mjs';
import { createBookingJourneyFixture } from '../helpers/integrationFixture.mjs';
import { startTestServer, postStripeWebhook } from '../helpers/httpApp.mjs';

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

async function seedPaidConnectTransfer(fixture, stripeDouble) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const transferId = `tr_rev_${suffix}`;
  const chargeId = `ch_rev_${suffix}`;
  const piId = `pi_rev_${suffix}`;
  const amountCents = Math.round(Number(fixture.lesson.price) * 100);

  // Register with Stripe test double so post-webhook consistency probes succeed.
  if (stripeDouble?.intents) {
    stripeDouble.intents.set(piId, {
      id: piId,
      amountCents,
      currency: 'usd',
      customerId: null,
      metadata: {},
      captureMethod: 'manual',
      status: 'succeeded',
      chargeId,
      captureCalls: 1,
      cancelCalls: 0,
      amountRefundedCents: 0,
      refunds: [],
    });
  }

  const scheduledAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const booking = await Booking.create({
    lesson_id: fixture.lesson.id,
    coach_id: fixture.coach.id,
    primary_student_id: fixture.student.id,
    scheduled_at: scheduledAt,
    duration_minutes: fixture.lesson.duration_minutes || 60,
    price: fixture.lesson.price,
    status: 'completed',
    payout_status: 'paid',
    attendance_finalized: true,
    court_location_id: fixture.court.id,
    messaging_locked: false,
    idempotency_key: `tr_rev_booking_${suffix}`,
  });

  const payment = await Payment.create({
    booking_id: booking.id,
    coach_id: fixture.coach.id,
    student_id: fixture.student.id,
    lesson_price: fixture.lesson.price,
    platform_fee_percent: 8,
    platform_fee_amount: 8,
    total_charge_to_student: fixture.lesson.price,
    coach_payout_expected: 92,
    escrow_status: 'released',
    payment_status: 'captured',
    payment_method: 'stripe',
    currency: 'USD',
    payment_intent_id: piId,
    charge_id: chargeId,
    transfer_id: transferId,
    refunded_amount: 0,
    refund_status: 'none',
  });

  const payout = await Payout.create({
    coach_id: fixture.coach.id,
    payment_id: payment.id,
    amount: 92,
    currency: 'USD',
    payout_method: 'stripe_connect',
    status: 'paid',
    external_payout_id: transferId,
    processed_at: new Date(),
  });

  return { booking, payment, payout, transferId };
}

describeHttp('HTTP integration: Stripe transfer.reversed', () => {
  let server = null;
  let fixture = null;
  let stripeDouble = null;
  /** @type {string[]} */
  const eventIds = [];

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
    fixture = await createBookingJourneyFixture();
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

  it('parks canonical transfer reverse for manual payout review (HTTP + DB)', async () => {
    const { baseUrl } = server;
    const seeded = await seedPaidConnectTransfer(fixture, stripeDouble);
    const { booking, payment, payout, transferId } = seeded;

    const eventId = `evt_transfer_reversed_${Date.now()}`;
    eventIds.push(eventId);
    const event = {
      id: eventId,
      type: 'transfer.reversed',
      data: {
        object: {
          id: transferId,
          object: 'transfer',
          amount: 9200,
          amount_reversed: 9200,
          currency: 'usd',
          metadata: {
            payment_id: String(payment.id),
            payout_id: String(payout.id),
            booking_id: String(booking.id),
          },
        },
      },
    };

    const first = await postStripeWebhook(baseUrl, event);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json?.received, true);
    assert.notEqual(first.json?.duplicate, true);

    await payment.reload();
    await payout.reload();
    await booking.reload();

    assert.equal(payment.escrow_status, 'manual_payout_required');
    assert.equal(payment.transfer_id, transferId, 'transfer_id retained for audit / classification');
    assert.equal(payout.status, 'failed');
    assert.equal(booking.payout_status, 'pending');
    assert.equal(payment.payment_status, 'captured', 'student charge unchanged by Connect reverse');
    assert.equal(Number(payment.refunded_amount), 0);

    const audits = await AuditLog.findAll({
      where: {
        table_name: 'payments',
        record_id: payment.id,
        action: 'transfer_reversed_manual_review',
      },
    });
    assert.ok(audits.length >= 1);

    // Idempotent replay of the same Stripe event id.
    const replay = await postStripeWebhook(baseUrl, event);
    assert.equal(replay.status, 200, replay.text);
    assert.deepEqual(replay.json, { received: true, duplicate: true });

    await payment.reload();
    await payout.reload();
    await booking.reload();
    assert.equal(payment.escrow_status, 'manual_payout_required');
    assert.equal(payout.status, 'failed');
    assert.equal(booking.payout_status, 'pending');

    // Second delivery of a *new* event with same transfer object (handler-level idempotency).
    const eventId2 = `evt_transfer_reversed_again_${Date.now()}`;
    eventIds.push(eventId2);
    const secondDelivery = await postStripeWebhook(baseUrl, {
      ...event,
      id: eventId2,
    });
    assert.equal(secondDelivery.status, 200, secondDelivery.text);
    assert.equal(secondDelivery.json?.received, true);

    await payment.reload();
    assert.equal(payment.escrow_status, 'manual_payout_required');

    const logs = await WebhookLog.findAll({
      where: { provider: 'stripe', event_id: [eventId, eventId2] },
    });
    assert.equal(logs.length, 2);
    assert.ok(logs.every((l) => l.success === true));
  });

  it('non-canonical duplicate transfer reverse does not mutate escrow or booking payout', async () => {
    const { baseUrl } = server;
    const seeded = await seedPaidConnectTransfer(fixture, stripeDouble);
    const { booking, payment, payout, transferId } = seeded;
    const duplicateTransferId = `${transferId}_extra`;

    const eventId = `evt_transfer_reversed_dup_${Date.now()}`;
    eventIds.push(eventId);
    const res = await postStripeWebhook(baseUrl, {
      id: eventId,
      type: 'transfer.reversed',
      data: {
        object: {
          id: duplicateTransferId,
          object: 'transfer',
          amount: 9200,
          amount_reversed: 9200,
          currency: 'usd',
          metadata: {
            payment_id: String(payment.id),
            payout_id: String(payout.id),
          },
        },
      },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json?.received, true);

    await payment.reload();
    await payout.reload();
    await booking.reload();

    assert.equal(payment.escrow_status, 'released', 'non-canonical reverse must not park escrow');
    assert.equal(payout.status, 'paid');
    assert.equal(booking.payout_status, 'paid');
    assert.equal(payment.transfer_id, transferId);

    const nonCanonicalAudits = await AuditLog.findAll({
      where: {
        table_name: 'payments',
        record_id: payment.id,
        action: 'transfer_reversed_non_canonical',
      },
    });
    assert.ok(nonCanonicalAudits.length >= 1);
  });
});
