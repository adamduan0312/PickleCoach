import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cancelReasonSharedHint,
  cancellationPolicySummary,
  cancelWeatherAlternativeHint,
  coachCancellationPolicyLines,
  fullRefundDeadlineAt,
  isWithinLateCancelWindow,
  rescheduleHint,
  studentCancellationPolicyLines,
} from '../src/domain/cancellationPolicy.js';
import { cancelMoneyConsequenceCopy, checkoutCancellationNoShowPolicyLines } from '../src/domain/bookingStatus.js';

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
  assert.match(late.body, /full-refund deadline was/);

  const pending = cancellationPolicySummary({ status: 'pending', scheduled_at: at(30) }, { audience: 'student', now: NOW, tz: TZ });
  assert.match(pending.headline, /Free to cancel/);
  assert.match(pending.body, /full refund until .*After that, cancellations receive a 50% refund/);
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
  for (const reason of ['weather', 'sickness', 'emergency', 'forgot', 'schedule_conflict']) {
    const hint = cancelWeatherAlternativeHint(reason, { status: 'confirmed', scheduled_at: at(2), weather_cancellation: { can_request: true } }, { audience: 'student', now: NOW });
    assert.doesNotMatch(hint || '', RELIABILITY_WORDING);
  }
  assert.doesNotMatch(policySrc, /doesn’t affect your reliability|may affect your reliability|penalized/);
  const cancelForm = detailSrc.slice(detailSrc.indexOf('function CancelForm'), detailSrc.indexOf('function DeclineForm'));
  const declineForm = detailSrc.slice(detailSrc.indexOf('function DeclineForm'), detailSrc.indexOf('function DeclineForm') + 3000);
  assert.doesNotMatch(cancelForm, RELIABILITY_WORDING);
  assert.doesNotMatch(declineForm, RELIABILITY_WORDING);
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

test('reschedule hint: coaches decline pending requests; everyone else cancels and rebooks', () => {
  const cancelAndRebook = 'There is no reschedule option yet. To change the time, cancel this booking and book a new slot.';
  assert.equal(
    rescheduleHint({ status: 'pending' }, 'coach'),
    'Need a different time? Decline this request and ask the student to book a new slot.',
  );
  assert.equal(rescheduleHint({ status: 'pending' }, 'student'), cancelAndRebook);
  assert.equal(rescheduleHint({ status: 'confirmed' }, 'student'), cancelAndRebook);
  assert.equal(rescheduleHint({ status: 'confirmed' }, 'coach'), cancelAndRebook);
  assert.equal(rescheduleHint({ status: 'completed' }, 'coach'), null);
  assert.match(detailSrc, /rescheduleHint\(booking, isCoach \? 'coach' : 'student'\)/);
});
