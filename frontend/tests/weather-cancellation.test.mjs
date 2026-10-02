import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COACH_WEATHER_POLICY_LINE,
  STUDENT_WEATHER_POLICY_LINE,
  cancelWeatherAlternativeHint,
  cancellationPolicySummary,
  coachCancellationPolicyLines,
  isMutualWeatherCancellation,
  WEATHER_ACTION_NEEDED_LABEL,
  studentCancellationPolicyLines,
  weatherCancellationView,
  weatherRequestAwaitsResponse,
} from '../src/domain/cancellationPolicy.js';
import {
  bookingDisplayLabel,
  bookingDisplayTone,
  bookingIncludedInListFilter,
  bookingStatusLabel,
  cancellationHistoryEventLabel,
  cancelledOutcomeCopy,
  coachBookingNeedsNavAttention,
  coachCancelMoneyPresentation,
  sortBookingsForList,
  studentBookingNeedsNavAttention,
  studentCoachCancelMoneyPresentation,
} from '../src/domain/bookingStatus.js';
import { coachDashboardReminders, studentDashboardReminders } from '../src/domain/dashboardReminders.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const TZ = 'America/New_York';
const at = (hoursFromNow) => new Date(NOW + hoursFromNow * HOUR).toISOString();

const detailSrc = readFileSync(new URL('../src/pages/bookings/BookingDetailPage.jsx', import.meta.url), 'utf8');

function booking({ hours = 5, status = 'confirmed', block = {} } = {}) {
  return {
    status,
    scheduled_at: at(hours),
    coach: { full_name: 'Casey Coach' },
    primaryStudent: { full_name: 'Sam Student' },
    weather_cancellation: { opens_at: at(hours - 24), can_request: false, request_unavailable_code: null, request: null, ...block },
  };
}

const pending = (overrides) => ({
  id: 7, status: 'pending', requested_by: 'student', requested_by_me: false, can_respond: true, can_withdraw: false, note: 'Lightning', ...overrides,
});

test('policy lists name weather as an agreed exception, not an automatic refund', () => {
  assert.ok(studentCancellationPolicyLines().includes(STUDENT_WEATHER_POLICY_LINE));
  assert.ok(coachCancellationPolicyLines().includes(COACH_WEATHER_POLICY_LINE));
  assert.match(STUDENT_WEATHER_POLICY_LINE, /Ask your coach.*If they agree, you get a full refund/);
  assert.match(COACH_WEATHER_POLICY_LINE, /If the other person agrees.*you aren’t paid/);
});

test('late student summary points to the weather request only while one is possible', () => {
  const open = cancellationPolicySummary(booking({ block: { can_request: true } }), { audience: 'student', now: NOW, tz: TZ });
  assert.match(open.body, /ask your coach to cancel for weather instead/);
  const used = cancellationPolicySummary(booking({ block: { can_request: false } }), { audience: 'student', now: NOW, tz: TZ });
  assert.doesNotMatch(used.body, /weather/);
});

test('available: explains both outcomes per audience', () => {
  const student = weatherCancellationView(booking({ block: { can_request: true } }), { audience: 'student', now: NOW, tz: TZ });
  assert.equal(student.kind, 'available');
  assert.equal(student.prominent, false);
  assert.match(student.body, /Ask your coach.*you get a full refund.*If not, the lesson stays on/);
  const coach = weatherCancellationView(booking({ block: { can_request: true } }), { audience: 'coach', now: NOW, tz: TZ });
  assert.match(coach.body, /Ask the student.*the student gets a full refund and you aren’t paid/);
});

test('no weather request card more than 24h out, for pending, started, or cancelled bookings', () => {
  for (const audience of ['student', 'coach']) {
    const far = booking({ hours: 30, block: { request_unavailable_code: 'weather_request_too_early' } });
    assert.equal(weatherCancellationView(far, { audience, now: NOW, tz: TZ }), null);
    const staleFlag = booking({ hours: 30, block: { can_request: true } });
    assert.equal(weatherCancellationView(staleFlag, { audience, now: NOW, tz: TZ }), null, 'client also enforces the 24h window');
  }
  assert.equal(weatherCancellationView(booking({ status: 'pending', block: { can_request: true } }), { now: NOW }), null);
  assert.equal(weatherCancellationView(booking({ hours: -1, block: { can_request: true } }), { now: NOW }), null);
  assert.equal(weatherCancellationView(booking({ status: 'cancelled', block: { can_request: true } }), { now: NOW }), null);
});

test('respond: the other person sees a prominent card with their own consequences and the note', () => {
  const coach = weatherCancellationView(booking({ block: { request: pending() } }), { audience: 'coach', now: NOW, tz: TZ });
  assert.equal(coach.kind, 'respond');
  assert.equal(coach.prominent, true);
  assert.equal(coach.requestId, 7);
  assert.equal(coach.title, 'Sam Student asked to cancel for weather');
  assert.match(coach.body, /If you agree.*the student gets a full refund and you aren’t paid.*neither of you is penalized/);
  assert.equal(coach.note, 'Lightning');

  const student = weatherCancellationView(
    booking({ block: { request: pending({ requested_by: 'coach' }) } }),
    { audience: 'student', now: NOW, tz: TZ },
  );
  assert.equal(student.title, 'Casey Coach asked to cancel for weather');
  assert.match(student.body, /you get a full refund/);
});

test('waiting: the requester is told nothing has changed until the other person agrees', () => {
  const view = weatherCancellationView(
    booking({ block: { request: pending({ requested_by_me: true, can_respond: false, can_withdraw: true }) } }),
    { audience: 'student', now: NOW, tz: TZ },
  );
  assert.equal(view.kind, 'waiting');
  assert.match(view.body, /Waiting for your coach.*If they agree.*expires when the lesson starts/);
});

test('declined: requester learns normal rules apply; responder sees the lesson is on', () => {
  const declined = { ...pending(), status: 'declined', can_respond: false };
  const requester = weatherCancellationView(booking({ block: { request: { ...declined, requested_by_me: true } } }), { audience: 'student', now: NOW, tz: TZ });
  assert.equal(requester.title, 'Casey Coach declined your weather cancellation');
  assert.match(requester.body, /normal cancellation rules apply/);
  const responder = weatherCancellationView(booking({ block: { request: declined } }), { audience: 'coach', now: NOW, tz: TZ });
  assert.equal(responder.title, 'You kept the lesson');
});

test('cancel dialog suggests the weather request only for a late student who can still ask', () => {
  const b = booking({ block: { can_request: true } });
  assert.match(cancelWeatherAlternativeHint('weather', b, { audience: 'student', now: NOW }), /ask your coach to cancel for weather/);
  assert.equal(cancelWeatherAlternativeHint('sickness', b, { audience: 'student', now: NOW }), null);
  assert.equal(cancelWeatherAlternativeHint('weather', b, { audience: 'coach', now: NOW }), null);
  assert.equal(cancelWeatherAlternativeHint('weather', booking({ block: { can_request: false } }), { audience: 'student', now: NOW }), null);
  assert.equal(cancelWeatherAlternativeHint('weather', booking({ hours: 30, block: { can_request: true } }), { audience: 'student', now: NOW }), null);
});

test('agreed weather cancellation: outcome and history say both agreed, full refund, no penalty', () => {
  const cancelled = {
    status: 'cancelled',
    cancelled_by: 'student',
    weather_cancellation: { request: { status: 'accepted', cancellation_history_id: 3 } },
  };
  assert.equal(isMutualWeatherCancellation(cancelled), true);
  assert.match(cancelledOutcomeCopy(cancelled, { audience: 'student' }), /You and your coach agreed to cancel for weather\. You get a full refund/);
  assert.match(cancelledOutcomeCopy(cancelled, { audience: 'coach' }), /student gets a full refund, and neither of you is penalized/);
  assert.doesNotMatch(cancelledOutcomeCopy(cancelled, { audience: 'coach' }), /cancellation timing rules/);
  assert.equal(cancellationHistoryEventLabel({ cancelled_by: 'student' }, { audience: 'coach', mutualWeather: true }), 'Cancelled for weather — you both agreed');

  const closed = { ...cancelled, weather_cancellation: { request: { status: 'closed' } } };
  assert.equal(isMutualWeatherCancellation(closed), false);
});

test('agreed weather cancellation shows full refund / no payout money even when the student asked', () => {
  const cancelled = {
    status: 'cancelled',
    cancelled_by: 'student',
    price: 60,
    cancellationHistory: [{ cancelled_by: 'student', refund_amount: '60.00' }],
    weather_cancellation: { request: { status: 'accepted' } },
  };
  const payment = { payment_status: 'captured', refund_status: 'pending', total_charge_to_student: 60 };
  const coach = coachCancelMoneyPresentation(cancelled, payment);
  assert.equal(coach.payoutKind, 'not_payable');
  assert.equal(coach.paymentStatusLine, 'Student refund pending');
  const student = studentCoachCancelMoneyPresentation(cancelled, payment);
  assert.equal(student.refundValueText, 'Full refund');
  assert.equal(coachCancelMoneyPresentation({ ...cancelled, weather_cancellation: null }, payment), null, 'normal student cancel unchanged');
});

test('action needed: only the participant who must answer sees the weather request flagged', () => {
  const row = (requested_by, extra = {}) => ({
    id: 9, status: 'confirmed', scheduled_at: at(5), pending_weather_request: { id: 1, requested_by }, ...extra,
  });
  assert.equal(weatherRequestAwaitsResponse(row('student'), 'coach', NOW), true);
  assert.equal(weatherRequestAwaitsResponse(row('student'), 'student', NOW), false, 'requester is waiting, not acting');
  assert.equal(weatherRequestAwaitsResponse(row('coach'), 'student', NOW), true);
  assert.equal(weatherRequestAwaitsResponse(row('student', { scheduled_at: at(-1) }), 'coach', NOW), false, 'expired at start');
  assert.equal(weatherRequestAwaitsResponse(row('student', { status: 'cancelled' }), 'coach', NOW), false);
  assert.equal(weatherRequestAwaitsResponse({ status: 'confirmed', scheduled_at: at(5), pending_weather_request: null }, 'coach', NOW), false);
  assert.equal(
    weatherRequestAwaitsResponse({ status: 'confirmed', scheduled_at: at(5), weather_cancellation: { request: { status: 'pending', can_respond: true } } }, 'coach', NOW),
    true,
    'booking detail shape',
  );

  assert.equal(bookingDisplayLabel(row('student'), { audience: 'coach', now: NOW }), WEATHER_ACTION_NEEDED_LABEL);
  assert.equal(WEATHER_ACTION_NEEDED_LABEL, 'Action needed — Weather cancellation request');
  assert.equal(bookingDisplayTone(row('student'), { audience: 'coach', now: NOW }), 'warning');
  assert.equal(bookingDisplayLabel(row('student'), { audience: 'student', now: NOW }), bookingStatusLabel('confirmed', { audience: 'student' }));

  assert.equal(coachBookingNeedsNavAttention(row('student'), NOW), true);
  assert.equal(coachBookingNeedsNavAttention(row('coach'), NOW), false);
  assert.equal(studentBookingNeedsNavAttention(row('coach'), NOW), true);
  assert.equal(bookingIncludedInListFilter(row('student'), 'action_needed', { audience: 'coach', now: NOW }), true);

  const later = { id: 1, status: 'confirmed', scheduled_at: at(2) };
  const sortedCoach = sortBookingsForList([later, row('student')], NOW, { audience: 'coach' });
  assert.equal(sortedCoach[0].id, 9, 'awaiting reply sorts into the action group');
  const sortedStudent = sortBookingsForList([later, row('coach')], NOW, { audience: 'student' });
  assert.equal(sortedStudent[0].id, 9);
});

test('dashboard reminders lead with a weather request awaiting this viewer', () => {
  const rows = [{ id: 9, status: 'confirmed', scheduled_at: at(5), pending_weather_request: { id: 1, requested_by: 'student' } }];
  const [coach] = coachDashboardReminders(rows, NOW);
  assert.equal(coach.id, 'coach-weather-request');
  assert.equal(coach.title, WEATHER_ACTION_NEEDED_LABEL);
  assert.equal(coach.to, '/bookings/9');
  assert.match(coach.body, /Your student asked to cancel/);
  assert.equal(studentDashboardReminders(rows, NOW).some((r) => r.id === 'student-weather-request'), false);
});

test('booking detail wires the weather card to the API and offers Book a new time', () => {
  assert.match(detailSrc, /bookingsApi\.requestWeatherCancellation\(id, body\)/);
  assert.match(detailSrc, /bookingsApi\.acceptWeatherCancellation\(id, requestId\)/);
  assert.match(detailSrc, /bookingsApi\.declineWeatherCancellation\(id, requestId\)/);
  assert.match(detailSrc, /bookingsApi\.withdrawWeatherCancellation\(id, requestId\)/);
  assert.match(detailSrc, /weatherView\?\.prominent \? weatherSection : null/);
  assert.match(detailSrc, />Book a new time<\/Link>/);
});
