/**
 * Sequential slot occupancy invariants (not concurrent races).
 *
 * Covers:
 *   1. Pending booking blocks a second student on the same coach/court/time
 *   2. Coach decline releases the slot for a new booking
 *   3. Acceptance expiry releases the slot
 *   4. Student cancel of pending releases the slot
 *   5. A terminal past booking does not block a future slot
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking, Payment } from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { expireStalePendingBookings } from '../../workers/pendingBookingExpiryWorker.js';
import { SLOT_NO_LONGER_AVAILABLE_CODE } from '../../utils/bookingIntentContract.js';
import { createInMemoryPaymentIntentDouble } from '../helpers/inMemoryPaymentIntentDouble.mjs';
import { createBookingJourneyFixture, nextSlotInTz } from '../helpers/integrationFixture.mjs';
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
  const res = await api(baseUrl, 'POST', '/api/auth/login', {
    body: { email, password },
  });
  assert.equal(res.status, 200, res.text);
  return res.json.data.token;
}

async function authorizeAndConfirm(baseUrl, token, fixture, scheduledAtIso, keyPrefix) {
  const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
    token,
    body: {
      lesson_id: fixture.lesson.id,
      scheduled_at: scheduledAtIso,
      court_location_id: fixture.court.id,
      payment_method: 'stripe',
      idempotency_key: `${keyPrefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    },
  });
  if (intentRes.status !== 201) {
    return { intentRes, confirmRes: null, bookingId: null, paymentIntentId: null };
  }
  const paymentIntentId = intentRes.json.data.payment_intent_id;
  const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
    token,
    body: { payment_intent_id: paymentIntentId },
  });
  const bookingId = confirmRes.json?.data?.booking?.id || null;
  return { intentRes, confirmRes, bookingId, paymentIntentId };
}

function assertSlotTaken(confirmRes) {
  assert.ok([409, 400].includes(confirmRes.status), confirmRes.text);
  const code = confirmRes.json?.code || confirmRes.json?.error?.code || confirmRes.json?.data?.code;
  const message = String(confirmRes.json?.message || confirmRes.json?.error || confirmRes.text || '');
  assert.ok(
    code === SLOT_NO_LONGER_AVAILABLE_CODE || /no longer available|already.*book|overlap|slot/i.test(message),
    `expected slot conflict, got status=${confirmRes.status} body=${confirmRes.text}`,
  );
}

describeHttp('HTTP integration: sequential slot release', () => {
  let server = null;
  let stripeDouble = null;
  /** @type {Array<() => Promise<void>>} */
  const cleanups = [];

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch {
        /* ignore */
      }
    }
    if (server) await server.close();
  });

  it('pending booking blocks a second student; decline releases the slot', async () => {
    const fixture = await createBookingJourneyFixture({ studentCount: 2 });
    cleanups.push(() => fixture.cleanup());
    const { baseUrl } = server;
    const [studentA, studentB] = fixture.students;
    const slotIso = fixture.scheduledAt.toISOString();

    const tokenA = await login(baseUrl, studentA.email, fixture.password);
    const tokenB = await login(baseUrl, studentB.email, fixture.password);
    const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);

    const first = await authorizeAndConfirm(baseUrl, tokenA, fixture, slotIso, 'seq_pending_a');
    assert.ok([200, 201].includes(first.confirmRes.status), first.confirmRes.text);
    assert.equal(first.confirmRes.json.data.booking.status, 'pending');

    const blocked = await authorizeAndConfirm(baseUrl, tokenB, fixture, slotIso, 'seq_pending_b');
    // Intent may succeed (auth hold) but confirm must reject the taken slot.
    if (blocked.intentRes.status === 201) {
      assertSlotTaken(blocked.confirmRes);
    } else {
      assert.ok([409, 400].includes(blocked.intentRes.status), blocked.intentRes.text);
    }

    const declineRes = await api(baseUrl, 'PUT', `/api/bookings/${first.bookingId}/decline`, {
      token: coachToken,
      body: {
        message_to_student: 'Sorry, this time no longer works. Please pick another slot.',
        decline_reason_code: 'availability_conflict',
      },
    });
    assert.equal(declineRes.status, 200, declineRes.text);

    const bookingAfter = await Booking.findByPk(first.bookingId);
    assert.equal(bookingAfter.status, 'cancelled');

    const released = await authorizeAndConfirm(baseUrl, tokenB, fixture, slotIso, 'seq_after_decline');
    assert.ok([200, 201].includes(released.confirmRes.status), released.confirmRes.text);
    assert.equal(released.confirmRes.json.data.booking.status, 'pending');
    assert.notEqual(released.bookingId, first.bookingId);
  });

  it('acceptance expiry releases the slot for a new student', async () => {
    const fixture = await createBookingJourneyFixture({ studentCount: 2 });
    cleanups.push(() => fixture.cleanup());
    const { baseUrl } = server;
    const [studentA, studentB] = fixture.students;
    const slotIso = fixture.scheduledAt.toISOString();

    const tokenA = await login(baseUrl, studentA.email, fixture.password);
    const tokenB = await login(baseUrl, studentB.email, fixture.password);

    const first = await authorizeAndConfirm(baseUrl, tokenA, fixture, slotIso, 'seq_expire_a');
    assert.ok([200, 201].includes(first.confirmRes.status), first.confirmRes.text);

    // Force acceptance window closed.
    await Booking.update(
      { created_at: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      { where: { id: first.bookingId } },
    );

    await expireStalePendingBookings();
    const expired = await Booking.findByPk(first.bookingId);
    assert.equal(expired.status, 'cancelled');
    const payment = await Payment.findOne({ where: { booking_id: first.bookingId }, order: [['id', 'DESC']] });
    assert.ok(payment);
    assert.ok(
      ['voided', 'canceled', 'cancelled', 'authorized'].includes(String(payment.payment_status))
        || payment.escrow_status === 'released',
      `unexpected payment after expiry: ${payment.payment_status}/${payment.escrow_status}`,
    );

    const released = await authorizeAndConfirm(baseUrl, tokenB, fixture, slotIso, 'seq_after_expire');
    assert.ok([200, 201].includes(released.confirmRes.status), released.confirmRes.text);
    assert.equal(released.confirmRes.json.data.booking.status, 'pending');
  });

  it('student cancel of pending releases the slot', async () => {
    const fixture = await createBookingJourneyFixture({ studentCount: 2 });
    cleanups.push(() => fixture.cleanup());
    const { baseUrl } = server;
    const [studentA, studentB] = fixture.students;
    const slotIso = fixture.scheduledAt.toISOString();

    const tokenA = await login(baseUrl, studentA.email, fixture.password);
    const tokenB = await login(baseUrl, studentB.email, fixture.password);

    const first = await authorizeAndConfirm(baseUrl, tokenA, fixture, slotIso, 'seq_cancel_a');
    assert.ok([200, 201].includes(first.confirmRes.status), first.confirmRes.text);

    const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${first.bookingId}/cancel`, {
      token: tokenA,
      body: { reason: 'schedule_conflict' },
    });
    assert.equal(cancelRes.status, 200, cancelRes.text);

    const released = await authorizeAndConfirm(baseUrl, tokenB, fixture, slotIso, 'seq_after_cancel');
    assert.ok([200, 201].includes(released.confirmRes.status), released.confirmRes.text);
    assert.equal(released.confirmRes.json.data.booking.status, 'pending');
  });

  it('terminal past booking does not block a future slot', async () => {
    const fixture = await createBookingJourneyFixture({ studentCount: 1 });
    cleanups.push(() => fixture.cleanup());
    const { baseUrl } = server;
    const token = await login(baseUrl, fixture.student.email, fixture.password);
    const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);

    // Create and accept a booking, then move it fully into the past as completed.
    const pastIso = fixture.scheduledAt.toISOString();
    const created = await authorizeAndConfirm(baseUrl, token, fixture, pastIso, 'seq_past_seed');
    assert.ok([200, 201].includes(created.confirmRes.status), created.confirmRes.text);

    const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${created.bookingId}/accept`, {
      token: coachToken,
    });
    assert.equal(acceptRes.status, 200, acceptRes.text);

    const durationMs = (Number(fixture.lesson.duration_minutes) || 60) * 60 * 1000;
    await Booking.update(
      {
        scheduled_at: new Date(Date.now() - durationMs - 60_000),
        status: 'completed',
      },
      { where: { id: created.bookingId } },
    );

    // Future slot on a different day must still be bookable.
    const future = nextSlotInTz({ weekday: (fixture.scheduledAt.getUTCDay() + 3) % 7, hour: 11, minute: 0, minDaysAhead: 4 });
    const futureIso = future.toISOString();
    const nextBooking = await authorizeAndConfirm(baseUrl, token, fixture, futureIso, 'seq_future_ok');
    assert.ok([200, 201].includes(nextBooking.confirmRes.status), nextBooking.confirmRes.text);
    assert.equal(nextBooking.confirmRes.json.data.booking.status, 'pending');
  });
});
