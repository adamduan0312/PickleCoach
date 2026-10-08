import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COACH_CANCEL_WEATHER_HINT,
  COACH_PENDING_IN_APP_STEP,
  cancelReasonsFor,
  IN_APP_BOOKING_CHANGES_LINE,
  MESSAGES_BOOKING_CHANGES_NOTE,
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

test('student policy (checkout) covers every rule: no late cancel, no 50% refund', () => {
  const lines = studentCancellationPolicyLines();
  assert.deepEqual(checkoutCancellationNoShowPolicyLines(), lines);
  const text = lines.join('\n');
  assert.match(text, /Until your coach accepts, you can cancel for free/);
  assert.match(text, /up to 24 hours before the lesson for a full refund/);
  assert.match(text, /Less than 24 hours before the lesson, you can’t cancel it yourself/);
  assert.match(text, /If your coach cancels, you get a full refund/);
  assert.match(text, /don’t show up.*isn’t automatically refunded/);
  assert.doesNotMatch(text, /50%/);
  const cancelLines = lines.filter((l) => !/don’t show up/.test(l));
  assert.ok(cancelLines.every((l) => !RELIABILITY_WORDING.test(l)), 'cancellation rules never mention reliability');
});

test('coach policy: decline releases the authorization, cancel = full refund + no pay, no reliability wording', () => {
  const text = coachCancellationPolicyLines().join('\n');
  assert.match(text, /decline a request, the student’s card authorization is released/);
  assert.match(text, /cancel an accepted lesson, the student gets a full refund and you aren’t paid/);
  assert.match(text, /mark Student no-show/);
  assert.match(text, /Students can cancel for a full refund up to 24 hours before the lesson\. After that, they can’t cancel it themselves\./);
  assert.doesNotMatch(text, /50%/);
  assert.doesNotMatch(text, RELIABILITY_WORDING);
});

test('full-refund deadline is 24h before the lesson', () => {
  const booking = { status: 'confirmed', scheduled_at: at(30) };
  assert.equal(fullRefundDeadlineAt(booking), at(6));
  assert.equal(isWithinLateCancelWindow(booking, NOW), false);
  assert.equal(isWithinLateCancelWindow({ ...booking, scheduled_at: at(2) }, NOW), true);
  assert.equal(isWithinLateCancelWindow({ ...booking, scheduled_at: at(-1) }, NOW), false, 'started');
});

test('student booking detail: concrete deadline before it passes, no cancelling after', () => {
  const early = cancellationPolicySummary({ status: 'confirmed', scheduled_at: at(30) }, { audience: 'student', now: NOW, tz: TZ });
  assert.match(early.headline, /^Full refund until /);
  assert.match(early.headline, /2:00 PM/);
  assert.match(early.body, /6h(?: 0m)? left\. After that, you can’t cancel it yourself\./);

  const late = cancellationPolicySummary({ status: 'confirmed', scheduled_at: at(2) }, { audience: 'student', now: NOW, tz: TZ });
  assert.equal(late.headline, 'This lesson can no longer be cancelled');
  assert.match(late.body, /Cancelling closed at .*24 hours before the lesson\. If it’s because of bad weather, send your coach a weather cancellation request/);

  const pending = cancellationPolicySummary({ status: 'pending', scheduled_at: at(30) }, { audience: 'student', now: NOW, tz: TZ });
  assert.match(pending.headline, /Free to cancel/);
  assert.match(pending.body, /full refund until .*After that, you can’t cancel it yourself/);
  const latePending = cancellationPolicySummary({ status: 'pending', scheduled_at: at(2) }, { audience: 'student', now: NOW, tz: TZ });
  assert.match(latePending.body, /Once your coach accepts, you can’t cancel/);
  for (const s of [early, late, pending, latePending]) assert.doesNotMatch(`${s.headline} ${s.body}`, /50%/);
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

test('students can cancel pending anytime, confirmed only until 24h before', () => {
  assert.equal(canStudentCancel({ status: 'pending', scheduled_at: at(2) }, NOW), true);
  assert.equal(canStudentCancel({ status: 'confirmed', scheduled_at: at(30) }, NOW), true);
  assert.equal(canStudentCancel({ status: 'confirmed', scheduled_at: at(24 + 1 / 60) }, NOW), true);
  assert.equal(canStudentCancel({ status: 'confirmed', scheduled_at: at(24 - 1 / 60) }, NOW), false);
  assert.equal(canStudentCancel({ status: 'confirmed', scheduled_at: at(2) }, NOW), false);
  assert.equal(canStudentCancel({ status: 'awaiting_verification', scheduled_at: at(-3) }, NOW), false);
  assert.match(detailSrc, /isStudent && canStudentCancel\(booking, now\)/);
});

test('cancel money copy states exact outcomes', () => {
  const pay = { payment_status: 'captured', total_charge_to_student: 75 };
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
    'There is no reschedule option, and this lesson is less than 24 hours away, so you can’t cancel it. For bad weather, send your coach a weather cancellation request — if they agree, you get a full refund.',
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

test('coaches can’t pick Weather when cancelling on their own; students still can', () => {
  const coachReasons = cancelReasonsFor('coach', CANCEL_REASONS).map((r) => r.value);
  assert.equal(coachReasons.includes('weather'), false);
  assert.ok(coachReasons.includes('emergency'));
  assert.equal(cancelReasonsFor('student', CANCEL_REASONS).some((r) => r.value === 'weather'), true);
  assert.match(COACH_CANCEL_WEATHER_HINT, /Send the student a weather cancellation request instead/);
  assert.doesNotMatch(COACH_CANCEL_WEATHER_HINT, RELIABILITY_WORDING);
  assert.match(detailSrc, /cancelReasonsFor\(audience, CANCEL_REASONS\)/);
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
  assert.match(messagesSrc, /!locked && data\.booking_id \? \(\s*<p className="small muted chat-booking-changes-note">\{MESSAGES_BOOKING_CHANGES_NOTE\}<\/p>/);
  assert.match(MESSAGES_BOOKING_CHANGES_NOTE, /doesn’t update the booking\. Use the booking page/);
});
