import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectiveWeatherRequestStatus,
  serializeWeatherCancellation,
  weatherRequestEligibility,
  weatherRequestOpensAt,
} from '../utils/weatherCancellation.js';
import { computeCancellationSplitCents } from '../services/paymentEngine.js';
import {
  buildWeatherCancellationAcceptedNotificationContent,
  buildWeatherCancellationDeclinedNotificationContent,
  buildWeatherCancellationRequestedNotificationContent,
} from '../notifications/payloadBuilders.js';
import { getEmailBodyFragment, getEmailSubject } from '../notifications/emailTemplates.js';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-01T12:00:00Z');
const at = (h) => new Date(NOW.getTime() + h * HOUR);
const confirmed = (h) => ({ id: 1, status: 'confirmed', scheduled_at: at(h) });
const pendingRow = (role, extra = {}) => ({
  id: 7,
  requested_by_role: role,
  status: 'pending',
  expires_at: at(5),
  created_at: at(-1),
  ...extra,
});

describe('weather request eligibility', () => {
  it('opens 24h before the lesson and closes at start', () => {
    assert.equal(weatherRequestOpensAt(confirmed(30)), at(6).toISOString());
    assert.equal(weatherRequestEligibility({ booking: confirmed(30), requesterRole: 'student', now: NOW }).code, 'weather_request_too_early');
    assert.equal(weatherRequestEligibility({ booking: confirmed(5), requesterRole: 'student', now: NOW }).ok, true);
    assert.equal(weatherRequestEligibility({ booking: confirmed(-0.1), requesterRole: 'coach', now: NOW }).code, 'weather_request_lesson_started');
  });

  it('confirmed lessons only', () => {
    for (const status of ['pending', 'cancelled', 'completed', 'awaiting_verification']) {
      const r = weatherRequestEligibility({ booking: { status, scheduled_at: at(5) }, requesterRole: 'student', now: NOW });
      assert.equal(r.code, 'weather_request_not_confirmed', status);
    }
  });

  it('one open request at a time, one request per person per booking', () => {
    const b = confirmed(5);
    assert.equal(
      weatherRequestEligibility({ booking: b, requesterRole: 'student', requests: [pendingRow('coach')], now: NOW }).code,
      'weather_request_already_pending',
    );
    assert.equal(
      weatherRequestEligibility({ booking: b, requesterRole: 'coach', requests: [pendingRow('coach', { status: 'declined' })], now: NOW }).code,
      'weather_request_already_used',
    );
    assert.equal(
      weatherRequestEligibility({ booking: b, requesterRole: 'student', requests: [pendingRow('coach', { status: 'declined' })], now: NOW }).ok,
      true,
      'the other participant can still ask after a decline',
    );
  });

  it('stale pending requests read as expired / closed', () => {
    assert.equal(effectiveWeatherRequestStatus(pendingRow('student'), confirmed(5), NOW), 'pending');
    assert.equal(effectiveWeatherRequestStatus(pendingRow('student', { expires_at: at(-1) }), confirmed(5), NOW), 'expired');
    assert.equal(effectiveWeatherRequestStatus(pendingRow('student'), { status: 'cancelled', scheduled_at: at(5) }, NOW), 'closed');
    assert.equal(effectiveWeatherRequestStatus(pendingRow('student', { status: 'declined' }), confirmed(5), NOW), 'declined');
  });
});

describe('serializeWeatherCancellation', () => {
  it('is viewer-relative: requester may withdraw, the other participant may respond', () => {
    const rows = [pendingRow('student', { note: 'Storms' })];
    const student = serializeWeatherCancellation(rows, { booking: confirmed(5), viewerRole: 'student', now: NOW });
    const coach = serializeWeatherCancellation(rows, { booking: confirmed(5), viewerRole: 'coach', now: NOW });
    assert.equal(student.request.requested_by_me, true);
    assert.equal(student.request.can_withdraw, true);
    assert.equal(student.request.can_respond, false);
    assert.equal(coach.request.can_respond, true);
    assert.equal(coach.request.note, 'Storms');
    assert.equal(coach.can_request, false);
    assert.equal(coach.request_unavailable_code, 'weather_request_already_pending');
  });

  it('non-participants can never act', () => {
    const block = serializeWeatherCancellation([pendingRow('student')], { booking: confirmed(5), viewerRole: null, now: NOW });
    assert.equal(block.can_request, false);
    assert.equal(block.request.can_respond, false);
    assert.equal(block.request.can_withdraw, false);
  });
});

describe('mutual weather split', () => {
  it('full refund even within 24h, whoever asked; invariant holds', () => {
    for (const cancelledBy of ['student', 'coach']) {
      const s = computeCancellationSplitCents({ totalChargeCents: 7501, isLateCancel: true, cancelledBy, mutualWeather: true });
      assert.deepEqual(s, { refundCents: 7501, penaltyCents: 0, penaltyReason: 'Weather cancellation (agreed)' });
    }
    const normal = computeCancellationSplitCents({ totalChargeCents: 7501, isLateCancel: true, cancelledBy: 'student' });
    assert.equal(normal.refundCents, 3750);
  });
});

describe('weather notification copy', () => {
  const base = { booking_id: 9, coach_name: 'Sam', student_name: 'Riley', lesson_title: 'Drills' };

  it('request: consequences for each recipient', () => {
    const toCoach = buildWeatherCancellationRequestedNotificationContent({ ...base, audience: 'coach', note: 'Storms' });
    assert.equal(toCoach.headline, 'Riley asked to cancel for weather');
    assert.match(toCoach.summary, /student gets a full refund\. You won’t be paid for it, and neither of you is penalized/);
    assert.equal(toCoach.note_line, '“Storms”');
    const toStudent = buildWeatherCancellationRequestedNotificationContent({ ...base, audience: 'student' });
    assert.equal(toStudent.headline, 'Sam asked to cancel for weather');
    assert.match(toStudent.summary, /you get a full refund/);
  });

  it('declined and accepted go to the requester', () => {
    const declined = buildWeatherCancellationDeclinedNotificationContent({ ...base, audience: 'student' });
    assert.equal(declined.headline, 'Sam declined your weather cancellation');
    assert.match(declined.summary, /still on.*normal cancellation rules apply/);
    const accepted = buildWeatherCancellationAcceptedNotificationContent({ ...base, audience: 'student', refund_amount: '60.00' });
    assert.equal(accepted.headline, 'Sam agreed to cancel for weather');
    assert.match(accepted.summary, /full refund of \$60\.00/);
  });

  it('emails exist for all three types', () => {
    for (const type of ['weather_cancellation_requested', 'weather_cancellation_declined', 'weather_cancellation_accepted']) {
      const payload = { ...base, audience: 'coach', headline: `H-${type}`, summary: 'S' };
      assert.equal(getEmailSubject(type, payload), `H-${type}`);
      const html = getEmailBodyFragment(type, payload);
      assert.match(html, new RegExp(`H-${type}`));
      assert.match(html, /\/bookings\/9/);
    }
  });
});
