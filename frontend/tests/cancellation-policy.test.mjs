import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COACH_CANCEL_WEATHER_HINT,
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

test('cancel and decline forms say nothing about reliability, whatever reason is picked', () => {
  assert.equal(cancelReasonSharedHint('student'), 'Select the reason that best describes your cancellation. It’s shared with your coach.');
  assert.match(cancelReasonSharedHint('coach'), /shared with your student/);
  assert.doesNotMatch(policySrc, /doesn’t affect your reliability|may affect your reliability|penalized/);
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

test('Weather is never a unilateral reason for coaches, nor for students inside 24h', () => {
  const values = (audience, hours, status = 'confirmed') =>
    cancelReasonsFor(audience, CANCEL_REASONS, { status, scheduled_at: at(hours) }, NOW).map((r) => r.value);
  assert.equal(values('coach', 30).includes('weather'), false);
  assert.ok(values('coach', 30).includes('emergency'));
  assert.equal(values('student', 30).includes('weather'), true, 'more than 24h out: normal full-refund cancel');
  assert.equal(values('student', 2).includes('weather'), false);
  assert.ok(values('student', 2).includes('sickness'), 'sickness stays available (50%, excused)');
  assert.equal(values('student', 2, 'pending').includes('weather'), true, 'pending is free anyway');

  const hint = (audience, hours) => cancelWeatherHint(audience, { status: 'confirmed', scheduled_at: at(hours) }, NOW);
  assert.equal(hint('coach', 30), COACH_CANCEL_WEATHER_HINT);
  assert.equal(hint('student', 2), 'Bad weather? Send your coach a weather cancellation request instead. If they agree, you get a full refund.');
  assert.equal(hint('student', 30), null);
  assert.match(COACH_CANCEL_WEATHER_HINT, /Send the student a weather cancellation request instead/);
  for (const h of [hint('coach', 30), hint('student', 2)]) assert.doesNotMatch(h, RELIABILITY_WORDING);
  assert.match(detailSrc, /cancelReasonsFor\(isCoach \? 'coach' : 'student', CANCEL_REASONS, booking, now\)/);
  assert.match(detailSrc, /cancelWeatherHint\(isCoach \? 'coach' : 'student', booking, now\)/);
  assert.match(coachCancellationPolicyLines().join('\n'), /Weather isn’t a reason you can pick when cancelling on your own/);
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
