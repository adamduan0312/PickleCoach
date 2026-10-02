/**
 * HTTP integration: mutual weather cancellation.
 *
 *   1. Student asks within 24h, coach accepts → cancelled, 100% refund queued, no late-cancel payout,
 *      no reliability impact, request accepted, requester notified.
 *   2. Coach asks, student declines → lesson stays on; a later student cancel follows normal rules (50%).
 *   3. Guards: too early, own request, one request per person, withdraw only by author.
 *
 * Run from backend/: npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import {
  sequelize,
  Booking,
  Payment,
  PaymentAction,
  CancellationHistory,
  Notification,
  WeatherCancellationRequest,
} from '../../models/index.js';
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
const HOUR = 60 * 60 * 1000;

/** Notifications are sent after the HTTP response; poll briefly. */
async function eventuallyCount(where, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    count = await Notification.count({ where });
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 50));
  }
  return count;
}

async function login(baseUrl, email, password) {
  const res = await api(baseUrl, 'POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, res.text);
  return res.json.data.token;
}

/** Authorize → coach accepts (capture), then move the lesson to `hoursAhead` from now. */
async function confirmedBooking(baseUrl, fixture, tokens, keyPrefix, hoursAhead) {
  const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
    token: tokens.student,
    body: {
      lesson_id: fixture.lesson.id,
      scheduled_at: fixture.scheduledAt.toISOString(),
      court_location_id: fixture.court.id,
      payment_method: 'stripe',
      idempotency_key: `${keyPrefix}_${Date.now()}`,
    },
  });
  assert.equal(intentRes.status, 201, intentRes.text);
  const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
    token: tokens.student,
    body: { payment_intent_id: intentRes.json.data.payment_intent_id },
  });
  assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
  const bookingId = confirmRes.json.data.booking.id;
  const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, { token: tokens.coach });
  assert.equal(acceptRes.status, 200, acceptRes.text);
  await Booking.update({ scheduled_at: new Date(Date.now() + hoursAhead * HOUR) }, { where: { id: bookingId } });
  return bookingId;
}

describeHttp('HTTP integration: mutual weather cancellation', () => {
  let server = null;
  let fixture = null;
  let tokens = null;

  before(async () => {
    stripeService.setStripeTestDouble(createInMemoryPaymentIntentDouble());
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      if (fixture) {
        const bookings = await Booking.findAll({ where: { coach_id: fixture.coach.id }, attributes: ['id'] });
        await WeatherCancellationRequest.destroy({ where: { booking_id: bookings.map((b) => b.id) } });
        await fixture.cleanup();
      }
    } finally {
      if (server) await server.close();
    }
  });

  async function freshFixture() {
    if (fixture) {
      const bookings = await Booking.findAll({ where: { coach_id: fixture.coach.id }, attributes: ['id'] });
      await WeatherCancellationRequest.destroy({ where: { booking_id: bookings.map((b) => b.id) } });
      await fixture.cleanup();
    }
    fixture = await createBookingJourneyFixture();
    tokens = {
      student: await login(server.baseUrl, fixture.student.email, fixture.password),
      coach: await login(server.baseUrl, fixture.coach.email, fixture.password),
    };
  }

  it('student asks, coach accepts → full refund, no penalty, nobody paid out early', async () => {
    await freshFixture();
    const { baseUrl } = server;
    const bookingId = await confirmedBooking(baseUrl, fixture, tokens, 'weather_accept', 5);

    const detail = await api(baseUrl, 'GET', `/api/bookings/${bookingId}`, { token: tokens.student });
    assert.equal(detail.json.data.weather_cancellation.can_request, true);

    const reqRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation`, {
      token: tokens.student,
      body: { note: 'Thunderstorms all afternoon' },
    });
    assert.equal(reqRes.status, 201, reqRes.text);
    const request = reqRes.json.data.weather_cancellation.request;
    assert.equal(request.status, 'pending');
    assert.equal(request.requested_by_me, true);
    assert.equal(request.can_withdraw, true);

    const paymentBefore = await Payment.findOne({ where: { booking_id: bookingId } });
    assert.equal((await Booking.findByPk(bookingId)).status, 'confirmed', 'asking alone does not cancel');
    assert.equal(await PaymentAction.count({ where: { booking_id: bookingId, action_type: 'booking_cancel_refund' } }), 0, 'no refund before acceptance');
    assert.equal(await CancellationHistory.count({ where: { booking_id: bookingId } }), 0, 'no reliability-relevant history before acceptance');
    assert.equal((await Payment.findByPk(paymentBefore.id)).status, paymentBefore.status);

    const listItem = (res) => (Array.isArray(res.json.data) ? res.json.data : res.json.data.items).find((b) => b.id === bookingId);
    const coachList = await api(baseUrl, 'GET', '/api/coaches/me/bookings', { token: tokens.coach });
    assert.equal(coachList.status, 200, coachList.text);
    assert.deepEqual(listItem(coachList).pending_weather_request, { id: request.id, requested_by: 'student' }, 'coach list flags action needed');
    const studentList = await api(baseUrl, 'GET', '/api/students/me/bookings', { token: tokens.student });
    assert.equal(listItem(studentList).pending_weather_request.requested_by, 'student');

    const coachView = await api(baseUrl, 'GET', `/api/bookings/${bookingId}`, { token: tokens.coach });
    assert.equal(coachView.json.data.weather_cancellation.request.can_respond, true);
    assert.equal(coachView.json.data.weather_cancellation.request.note, 'Thunderstorms all afternoon');

    const ownAccept = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation/${request.id}/accept`, { token: tokens.student });
    assert.equal(ownAccept.status, 400, ownAccept.text);
    assert.equal(ownAccept.json.code, 'weather_request_own');

    const acceptRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation/${request.id}/accept`, { token: tokens.coach });
    assert.equal(acceptRes.status, 200, acceptRes.text);

    const booking = await Booking.findByPk(bookingId);
    assert.equal(booking.status, 'cancelled');
    assert.equal(booking.cancelled_by, 'student');
    assert.notEqual(booking.payout_status, 'pending', 'no late-cancel coach payout');

    const payment = await Payment.findOne({ where: { booking_id: bookingId } });
    const totalCents = Math.round(Number(payment.total_charge_to_student) * 100);
    const [action] = await PaymentAction.findAll({ where: { booking_id: bookingId, action_type: 'booking_cancel_refund' } });
    assert.equal(action.refund_cents, totalCents, 'full refund even though the lesson is < 24h away');

    const [history] = await CancellationHistory.findAll({ where: { booking_id: bookingId } });
    assert.equal(history.reason, 'weather');
    assert.equal(history.affects_reliability, false);
    assert.equal(Number(history.penalty_amount), 0);

    const row = await WeatherCancellationRequest.findByPk(request.id);
    assert.equal(row.status, 'accepted');
    assert.equal(row.cancellation_history_id, history.id);

    const coachNotified = await eventuallyCount({ user_id: fixture.coach.id, type: 'weather_cancellation_requested', entity_id: bookingId });
    const studentNotified = await eventuallyCount({ user_id: fixture.student.id, type: 'weather_cancellation_accepted', entity_id: bookingId });
    assert.ok(coachNotified >= 1);
    assert.ok(studentNotified >= 1);
    const plainCancelToCoach = await Notification.count({ where: { user_id: fixture.coach.id, type: 'booking_cancelled', entity_id: bookingId } });
    assert.equal(plainCancelToCoach, 0, 'the coach accepted in-app; no generic "student cancelled" notice');
  });

  it('coach asks, student declines → lesson stays on; later student cancel is a normal late cancel', async () => {
    await freshFixture();
    const { baseUrl } = server;
    const bookingId = await confirmedBooking(baseUrl, fixture, tokens, 'weather_decline', 5);

    const reqRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation`, { token: tokens.coach, body: {} });
    assert.equal(reqRes.status, 201, reqRes.text);
    const requestId = reqRes.json.data.weather_cancellation.request.id;

    const strangerWithdraw = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation/${requestId}/withdraw`, { token: tokens.student });
    assert.equal(strangerWithdraw.status, 403, strangerWithdraw.text);

    const declineRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation/${requestId}/decline`, { token: tokens.student });
    assert.equal(declineRes.status, 200, declineRes.text);
    assert.equal(declineRes.json.data.weather_cancellation.request.status, 'declined');
    assert.equal((await Booking.findByPk(bookingId)).status, 'confirmed');
    const listAfterDecline = await api(baseUrl, 'GET', '/api/coaches/me/bookings', { token: tokens.coach });
    const declinedRow = (Array.isArray(listAfterDecline.json.data) ? listAfterDecline.json.data : listAfterDecline.json.data.items)
      .find((b) => b.id === bookingId);
    assert.equal(declinedRow.pending_weather_request, null, 'answered requests no longer flag action needed');

    const again = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation`, { token: tokens.coach, body: {} });
    assert.equal(again.status, 400, again.text);
    assert.equal(again.json.code, 'weather_request_already_used');

    const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
      token: tokens.student,
      body: { reason: 'schedule_conflict' },
    });
    assert.equal(cancelRes.status, 200, cancelRes.text);
    const payment = await Payment.findOne({ where: { booking_id: bookingId } });
    const totalCents = Math.round(Number(payment.total_charge_to_student) * 100);
    const [action] = await PaymentAction.findAll({ where: { booking_id: bookingId, action_type: 'booking_cancel_refund' } });
    assert.equal(action.refund_cents, Math.floor(totalCents / 2));

    const coachDeclinedNotice = await eventuallyCount({ user_id: fixture.coach.id, type: 'weather_cancellation_declined', entity_id: bookingId });
    assert.ok(coachDeclinedNotice >= 1);
  });

  it('asking for weather earns the requester nothing: cancelling while it is pending is a normal late cancel', async () => {
    await freshFixture();
    const { baseUrl } = server;
    const bookingId = await confirmedBooking(baseUrl, fixture, tokens, 'weather_pending_cancel', 5);

    const reqRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation`, { token: tokens.student, body: {} });
    assert.equal(reqRes.status, 201, reqRes.text);
    const requestId = reqRes.json.data.weather_cancellation.request.id;

    const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
      token: tokens.student,
      body: { reason: 'weather' },
    });
    assert.equal(cancelRes.status, 200, cancelRes.text);

    const payment = await Payment.findOne({ where: { booking_id: bookingId } });
    const totalCents = Math.round(Number(payment.total_charge_to_student) * 100);
    const [action] = await PaymentAction.findAll({ where: { booking_id: bookingId, action_type: 'booking_cancel_refund' } });
    assert.equal(action.refund_cents, Math.floor(totalCents / 2), 'pending request does not unlock the full refund');
    const [history] = await CancellationHistory.findAll({ where: { booking_id: bookingId } });
    assert.notEqual(history.reason_notes, 'Cancelled for weather — agreed by both');
    assert.equal((await WeatherCancellationRequest.findByPk(requestId)).status, 'closed');
  });

  it('requests open 24h before the lesson; a normal cancel closes a pending request', async () => {
    await freshFixture();
    const { baseUrl } = server;
    const bookingId = await confirmedBooking(baseUrl, fixture, tokens, 'weather_guard', 30);

    const early = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation`, { token: tokens.student, body: {} });
    assert.equal(early.status, 400, early.text);
    assert.equal(early.json.code, 'weather_request_too_early');

    await Booking.update({ scheduled_at: new Date(Date.now() + 3 * HOUR) }, { where: { id: bookingId } });
    const reqRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation`, { token: tokens.student, body: {} });
    assert.equal(reqRes.status, 201, reqRes.text);
    const requestId = reqRes.json.data.weather_cancellation.request.id;

    const coachCancel = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
      token: tokens.coach,
      body: { reason: 'weather' },
    });
    assert.equal(coachCancel.status, 200, coachCancel.text);
    assert.equal((await WeatherCancellationRequest.findByPk(requestId)).status, 'closed');

    const lateAccept = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/weather-cancellation/${requestId}/accept`, { token: tokens.coach });
    assert.equal(lateAccept.status, 400, lateAccept.text);
  });
});

if (!RUN) {
  describe('HTTP integration weather cancellation (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
