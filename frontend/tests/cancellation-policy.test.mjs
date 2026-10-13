import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COACH_CANCEL_RELIABILITY_WARNING,
  COACH_PENDING_STAY_ON_PLATFORM_STEP,
  MESSAGES_STAY_ON_PLATFORM_NOTE,
  STAY_ON_PLATFORM_BODY,
  STAY_ON_PLATFORM_TITLE,
  WEATHER_TIMING_POLICY_LINE,
  COACH_PENDING_IN_APP_STEP,
  cancelReasonsFor,
  cancelWeatherHint,
  IN_APP_BOOKING_CHANGES_LINE,
  MESSAGES_BOOKING_CHANGES_NOTE,
  MESSAGES_BOOKING_CHANGES_TITLE,
  cancelReasonSharedHint,
  cancellationPolicySummary,
  coachCancellationPolicyLines,
  fullRefundDeadlineAt,
  isWithinLateCancelWindow,
  rescheduleHint,
  studentCancellationPolicyLines,
} from '../src/domain/cancellationPolicy.js';
import { CANCEL_REASONS, canStudentCancel, cancelMoneyConsequenceCopy, checkoutCancellationNoShowPolicyLines } from '../src/domain/bookingStatus.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const TZ = 'America/New_York';
const at = (hoursFromNow) => new Date(NOW + hoursFromNow * HOUR).toISOString();

const detailSrc = readFileSync(new URL('../src/pages/bookings/BookingDetailPage.jsx', import.meta.url), 'utf8');
const policySrc = readFileSync(new URL('../src/domain/cancellationPolicy.js', import.meta.url), 'utf8');
const RELIABILITY_WORDING = /reliab|penaliz/i;

test('student policy (checkout) covers every rule, without "may" hedging on the 50%', () => {
  const lines = studentCancellationPolicyLines();
  assert.deepEqual(checkoutCancellationNoShowPolicyLines(), lines);
  const text = lines.join('\n');
  assert.match(text, /Until your coach accepts, you can cancel for free/);
  assert.match(text, /at least 24 hours before the lesson for a full refund/);
  assert.match(text, /less than 24 hours before the lesson receive a 50% refund/);
  assert.match(text, /If your coach cancels, you get a full refund/);
  assert.match(text, /don’t show up.*isn’t automatically refunded/);
  assert.doesNotMatch(text, /may receive a 50%/);
  const cancelLines = lines.filter((l) => !/don’t show up/.test(l));
  assert.ok(cancelLines.every((l) => !RELIABILITY_WORDING.test(l)), 'cancellation rules never mention reliability');
});

test('coach policy: decline releases the authorization, cancel = full refund + no pay, no reliability wording', () => {
  const text = coachCancellationPolicyLines().join('\n');
  assert.match(text, /decline a request, the student’s card authorization is released/);
  assert.match(text, /cancel an accepted lesson, the student gets a full refund and you aren’t paid/);
  assert.match(text, /mark Student no-show/);
  assert.match(text, /If the student cancels less than 24 hours before the lesson, they get 50% back and you’re paid your share of the rest\./);
  assert.doesNotMatch(text, RELIABILITY_WORDING);
});

test('full-refund deadline is 24h before the lesson', () => {
  const booking = { status: 'confirmed', scheduled_at: at(30) };
  assert.equal(fullRefundDeadlineAt(booking), at(6));
  assert.equal(isWithinLateCancelWindow(booking, NOW), false);
  assert.equal(isWithinLateCancelWindow({ ...booking, scheduled_at: at(2) }, NOW), true);
  assert.equal(isWithinLateCancelWindow({ ...booking, scheduled_at: at(-1) }, NOW), false, 'started');
});

test('student booking detail: concrete deadline before it passes, 50% after', () => {
  const early = cancellationPolicySummary({ status: 'confirmed', scheduled_at: at(30) }, { audience: 'student', now: NOW, tz: TZ });
  assert.match(early.headline, /^Full refund until /);
  assert.match(early.headline, /2:00 PM/);
  assert.match(early.body, /6h(?: 0m)? left\. After that, cancellations receive a 50% refund\./);

  const late = cancellationPolicySummary({ status: 'confirmed', scheduled_at: at(2) }, { audience: 'student', now: NOW, tz: TZ });
  assert.equal(late.headline, 'Cancelling now refunds 50%');
  assert.match(late.body, /The full-refund deadline was .*If it’s because of bad weather, send your coach a weather cancellation request instead/);

  const pending = cancellationPolicySummary({ status: 'pending', scheduled_at: at(30) }, { audience: 'student', now: NOW, tz: TZ });
  assert.match(pending.headline, /Free to cancel/);
  assert.match(pending.body, /full refund until .*After that, cancellations receive a 50% refund/);
  const latePending = cancellationPolicySummary({ status: 'pending', scheduled_at: at(2) }, { audience: 'student', now: NOW, tz: TZ });
  assert.match(latePending.body, /Once your coach accepts, cancellations receive a 50% refund/);
  for (const s of [early, late, pending]) assert.doesNotMatch(`${s.headline} ${s.body}`, RELIABILITY_WORDING);

  assert.equal(cancellationPolicySummary({ status: 'confirmed', scheduled_at: at(-1) }, { now: NOW, tz: TZ }), null);
  assert.equal(cancellationPolicySummary({ status: 'completed', scheduled_at: at(30) }, { now: NOW, tz: TZ }), null);
});

test('coach booking detail: before accepting, and when cancelling', () => {
  const pending = cancellationPolicySummary({ status: 'pending', scheduled_at: at(30) }, { audience: 'coach', now: NOW, tz: TZ });
  assert.equal(pending.headline, 'Before you accept');
  assert.equal(pending.body, 'If you accept and later cancel, the student gets a full refund and you aren’t paid.');

  for (const hours of [30, 2]) {
    const confirmed = cancellationPolicySummary({ status: 'confirmed', scheduled_at: at(hours) }, { audience: 'coach', now: NOW, tz: TZ });
    assert.equal(confirmed.headline, 'If you need to cancel');
    assert.equal(confirmed.body, 'The student gets a full refund and you aren’t paid.');
  }
});

test('reliability only appears as the broad coach cancel warning; no reason is singled out', () => {
  assert.equal(cancelReasonSharedHint('student'), 'Select the reason that best describes your cancellation. It’s shared with your coach.');
  assert.match(cancelReasonSharedHint('coach'), /shared with your student/);
  assert.doesNotMatch(policySrc, /doesn’t affect your reliability|won’t affect your reliability|penalized/);
  assert.equal((policySrc.match(/may affect your reliability/g) || []).length, 2, 'only COACH_CANCEL_RELIABILITY_WARNING (+ the doc comment)');
  assert.doesNotMatch(COACH_CANCEL_RELIABILITY_WARNING, /sick|emergenc|excus|weather/i, 'doesn’t reveal which reasons are reliability-neutral');
  const cancelForm = detailSrc.slice(detailSrc.indexOf('function CancelForm'), detailSrc.indexOf('function DeclineForm'));
  const declineForm = detailSrc.slice(detailSrc.indexOf('function DeclineForm'), detailSrc.indexOf('function DeclineForm') + 3000);
  assert.doesNotMatch(cancelForm, RELIABILITY_WORDING);
  assert.doesNotMatch(declineForm, RELIABILITY_WORDING);
});

test('students can cancel pending and confirmed bookings, including inside 24h', () => {
  assert.equal(canStudentCancel({ status: 'pending', scheduled_at: at(2) }), true);
  assert.equal(canStudentCancel({ status: 'confirmed', scheduled_at: at(30) }), true);
  assert.equal(canStudentCancel({ status: 'confirmed', scheduled_at: at(2) }), true);
  assert.equal(canStudentCancel({ status: 'awaiting_verification', scheduled_at: at(-3) }), false);
});

test('cancel money copy states exact outcomes', () => {
  const pay = { payment_status: 'captured', total_charge_to_student: 75 };
  const late = cancelMoneyConsequenceCopy({ status: 'confirmed', scheduled_at: new Date(Date.now() + 2 * HOUR).toISOString() }, pay, { audience: 'student' });
  assert.match(late, /less than 24 hours away, so you’ll be refunded 50% \(\$37\.50 of \$75\.00\)/);
  const early = cancelMoneyConsequenceCopy({ status: 'confirmed', scheduled_at: new Date(Date.now() + 48 * HOUR).toISOString() }, pay, { audience: 'student' });
  assert.match(early, /full refund of \$75\.00/);
  const coach = cancelMoneyConsequenceCopy({ status: 'confirmed', scheduled_at: new Date(Date.now() + 2 * HOUR).toISOString() }, pay, { audience: 'coach' });
  assert.equal(coach, 'The student gets a full refund and you aren’t paid for this lesson.');
});

test('booking detail shows the policy section and a cancel form that requires a reason', () => {
  assert.match(detailSrc, /<CancellationPolicySection booking=\{booking\}/);
  assert.match(detailSrc, /<option value="" disabled>Select a reason<\/option>/);
  assert.match(detailSrc, /disabled=\{busy \|\| !reason\}/);
  assert.match(detailSrc, /If you cancel after accepting, the student gets a full refund and you aren’t paid\./);
});

test('reschedule hint: same rule for both sides, role-specific action', () => {
  const hint = (status, hours, audience) => rescheduleHint({ status, scheduled_at: at(hours) }, audience, NOW);
  assert.equal(hint('pending', 30, 'coach'), 'There is no reschedule option. If the student needs a different time, decline this request and ask them to book a new slot.');
  assert.equal(hint('pending', 2, 'student'), 'There is no reschedule option. If you need a different time, cancel this request (it’s free) and book a new slot.');
  assert.equal(hint('confirmed', 30, 'student'), 'There is no reschedule option. To change the time, cancel this booking and book a new slot.');
  assert.equal(hint('confirmed', 30, 'coach'), 'There is no reschedule option. If the student needs a different time, cancel this booking and ask them to book a new slot.');
  assert.equal(
    hint('confirmed', 2, 'student'),
    'There is no reschedule option. You can cancel this booking for a 50% refund. For bad weather, send your coach a weather cancellation request — if they agree, you get a full refund.',
  );
  assert.equal(
    hint('confirmed', 2, 'coach'),
    'There is no reschedule option. If you can’t make it, you can still cancel — the student gets a full refund. For bad weather, send a weather cancellation request so the student can agree to the cancellation.',
  );
  assert.doesNotMatch(hint('confirmed', 2, 'coach'), /ask your coach/);
  assert.equal(hint('confirmed', -0.5, 'coach'), null, 'lesson started');
  assert.equal(rescheduleHint({ status: 'completed' }, 'coach'), null);
  assert.match(detailSrc, /rescheduleHint\(booking, isCoach \? 'coach' : 'student', now\)/);
  assert.match(detailSrc, /title: 'Need a different time\?', body: reschedule/, 'shown in What happens next');
});

test('Weather: either side can pick it until 24h before; inside 24h it needs the other to agree', () => {
  const values = (hours, status = 'confirmed') =>
    cancelReasonsFor(CANCEL_REASONS, { status, scheduled_at: at(hours) }, NOW).map((r) => r.value);
  assert.equal(values(72).includes('weather'), true);
  assert.equal(values(24 + 1 / 60).includes('weather'), true);
  assert.equal(values(24 - 1 / 60).includes('weather'), false);
  assert.equal(values(2).includes('weather'), false);
  for (const r of ['emergency', 'sickness', 'schedule_conflict']) assert.ok(values(2).includes(r), r);
  assert.equal(values(2, 'pending').includes('weather'), true, 'pending cancels are free');
  assert.match(detailSrc, /reasons=\{cancelReasonsFor\(CANCEL_REASONS, booking, now\)\}/);

  const hint = (audience, hours, status = 'confirmed') => cancelWeatherHint(audience, { status, scheduled_at: at(hours) }, NOW);
  assert.equal(hint('coach', 72), 'Cancelling this booking may affect your reliability score. Please only cancel when necessary.');
  assert.equal(
    hint('coach', 2),
    'Cancelling this booking may affect your reliability score. Please only cancel when necessary. Weather cancellations must be handled through a weather cancellation request.',
  );
  assert.equal(hint('student', 2), 'Bad weather? Send your coach a weather cancellation request instead. If they agree, you get a full refund.');
  assert.equal(hint('student', 72), null);
  assert.equal(hint('student', 2, 'pending'), null, 'pending cancels are free');
  assert.equal(
    cancelWeatherHint('student', { status: 'confirmed', scheduled_at: at(2), weather_cancellation: { request: { id: 1, status: 'declined' } } }, NOW),
    null,
    'the booking’s one weather request is used: don’t suggest another',
  );
  assert.doesNotMatch(hint('student', 2), RELIABILITY_WORDING);
  assert.match(detailSrc, /cancelWeatherHint\(isCoach \? 'coach' : 'student', booking, now\)/);

  assert.equal(
    WEATHER_TIMING_POLICY_LINE,
    'Weather cancellations are available up to 24 hours before the lesson. Inside 24 hours, both sides must agree to a weather cancellation.',
  );
  for (const lines of [coachCancellationPolicyLines(), studentCancellationPolicyLines()]) {
    assert.ok(lines.includes(WEATHER_TIMING_POLICY_LINE));
    assert.doesNotMatch(lines.join('\n'), /Weather isn’t a reason you can pick/);
  }
});

test('booking changes only count in PickleCoach: checkout, coach pending request, messages', () => {
  assert.equal(
    IN_APP_BOOKING_CHANGES_LINE,
    'Cancellations, weather cancellations, attendance and issue reports only count when completed in PickleCoach. Agreements made in messages, by text, or elsewhere don’t change the booking. There is no reschedule option — to change the time, cancel and book a new slot.',
  );
  const checkoutSrc = readFileSync(new URL('../src/components/bookings/CheckoutPolicyExplainer.jsx', import.meta.url), 'utf8');
  assert.match(checkoutSrc, /\{IN_APP_BOOKING_CHANGES_LINE\}/);

  assert.match(COACH_PENDING_IN_APP_STEP.body, /Agreements in messages or by text don’t change the booking/);
  const nextStepsSrc = detailSrc.slice(detailSrc.indexOf('function bookingDetailNextSteps'));
  const pendingCoach = nextStepsSrc.slice(nextStepsSrc.indexOf("case 'pending':"), nextStepsSrc.indexOf("case 'confirmed':"));
  assert.match(pendingCoach, /COACH_PENDING_IN_APP_STEP/);

  const messagesSrc = readFileSync(new URL('../src/pages/messages/MessagesPages.jsx', import.meta.url), 'utf8');
  const chatCard = messagesSrc.slice(messagesSrc.indexOf('className={`card chat'));
  assert.ok(
    chatCard.indexOf('chat-booking-changes-note') < chatCard.indexOf('className="chat-list"'),
    'notice sits at the top of the conversation, before the messages',
  );
  assert.ok(messagesSrc.indexOf('View booking') < messagesSrc.indexOf('chat-booking-changes-note'), 'below the booking header');
  assert.match(chatCard, /!locked && data\.booking_id \? \(\s*<div className="chat-booking-changes-note">/);
  assert.equal(MESSAGES_BOOKING_CHANGES_TITLE, 'Keep booking changes on the booking page');
  assert.match(MESSAGES_BOOKING_CHANGES_NOTE, /doesn’t update the booking\. Use the booking page/);
});

test('stay on PickleCoach: checkout, coach pending request, messages — no “monitored” promise', () => {
  assert.equal(STAY_ON_PLATFORM_TITLE, 'Stay on PickleCoach');
  assert.equal(
    STAY_ON_PLATFORM_BODY,
    'Keep communication, booking, and payment on PickleCoach. Off-platform arrangements aren’t permitted and may result in loss of platform protections and account restrictions.',
  );
  const checkoutSrc = readFileSync(new URL('../src/components/bookings/CheckoutPolicyExplainer.jsx', import.meta.url), 'utf8');
  assert.match(checkoutSrc, /\{STAY_ON_PLATFORM_TITLE\}/);
  assert.match(checkoutSrc, /\{STAY_ON_PLATFORM_BODY\}/);

  assert.deepEqual(COACH_PENDING_STAY_ON_PLATFORM_STEP, { title: STAY_ON_PLATFORM_TITLE, body: STAY_ON_PLATFORM_BODY });
  const nextStepsSrc = detailSrc.slice(detailSrc.indexOf('function bookingDetailNextSteps'));
  const pendingCoach = nextStepsSrc.slice(nextStepsSrc.indexOf("case 'pending':"), nextStepsSrc.indexOf("case 'confirmed':"));
  assert.match(pendingCoach, /COACH_PENDING_STAY_ON_PLATFORM_STEP/);

  assert.equal(
    MESSAGES_STAY_ON_PLATFORM_NOTE,
    'Keep your lesson on PickleCoach. Don’t exchange payment information or arrange PickleCoach bookings outside the platform. Messages may be reviewed for safety, fraud prevention, and policy enforcement.',
  );
  const messagesSrc = readFileSync(new URL('../src/pages/messages/MessagesPages.jsx', import.meta.url), 'utf8');
  const note = messagesSrc.slice(messagesSrc.indexOf('<div className="chat-booking-changes-note">'), messagesSrc.indexOf('className="chat-list"'));
  assert.match(note, /\{MESSAGES_STAY_ON_PLATFORM_NOTE\}/);

  for (const copy of [STAY_ON_PLATFORM_BODY, MESSAGES_STAY_ON_PLATFORM_NOTE]) {
    assert.doesNotMatch(copy, /monitored|will be reviewed|detect/i);
  }
});
