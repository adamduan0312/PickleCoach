import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RELIABILITY_EXCUSED_REASONS,
  RELIABILITY_POLICY_LINE,
  cancelReasonSharedHint,
  cancelReliabilityConsequenceCopy,
  cancellationPolicySummary,
  coachCancellationPolicyLines,
  fullRefundDeadlineAt,
  isWithinLateCancelWindow,
  studentCancellationPolicyLines,
} from '../src/domain/cancellationPolicy.js';
import { cancelMoneyConsequenceCopy, checkoutCancellationNoShowPolicyLines } from '../src/domain/bookingStatus.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const TZ = 'America/New_York';
const at = (hoursFromNow) => new Date(NOW + hoursFromNow * HOUR).toISOString();

const backendPenaltySrc = readFileSync(new URL('../../backend/services/reliabilityPenaltyService.js', import.meta.url), 'utf8');
const detailSrc = readFileSync(new URL('../src/pages/bookings/BookingDetailPage.jsx', import.meta.url), 'utf8');

test('excused reasons mirror the backend reliability classification', () => {
  const block = backendPenaltySrc.match(/NON_PENALIZED_REASONS = \[([\s\S]*?)\]/)[1];
  const backend = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...RELIABILITY_EXCUSED_REASONS].sort(), backend);
});

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
  assert.ok(lines.includes(RELIABILITY_POLICY_LINE));
});

test('coach policy: decline free, cancel = full refund + no pay, reliability line', () => {
  const text = coachCancellationPolicyLines().join('\n');
  assert.match(text, /Declining a request doesn’t affect your reliability score/);
  assert.match(text, /cancel an accepted lesson, the student gets a full refund and you aren’t paid/);
  assert.match(text, /mark Student no-show/);
  assert.match(text, /Once a lesson is accepted, cancelling for weather, sickness, or an emergency doesn’t affect your reliability score\. Other reasons may affect it, especially within 24 hours\./);
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
  assert.match(pending.body, /^Cancelling before your coach accepts doesn’t affect your reliability score\./);

  assert.equal(cancellationPolicySummary({ status: 'confirmed', scheduled_at: at(-1) }, { now: NOW, tz: TZ }), null);
  assert.equal(cancellationPolicySummary({ status: 'completed', scheduled_at: at(30) }, { now: NOW, tz: TZ }), null);
});

test('coach booking detail: before accepting, and when cancelling', () => {
  const pending = cancellationPolicySummary({ status: 'pending', scheduled_at: at(30) }, { audience: 'coach', now: NOW, tz: TZ });
  assert.equal(pending.headline, 'Before you accept');
  assert.match(pending.body, /student gets a full refund and you aren’t paid.*Declining now doesn’t affect your reliability/);

  const confirmed = cancellationPolicySummary({ status: 'confirmed', scheduled_at: at(30) }, { audience: 'coach', now: NOW, tz: TZ });
  assert.equal(confirmed.headline, 'If you need to cancel');
  assert.match(confirmed.body, /more so after .*less than 24 hours away/);
});

test('cancel dialog reliability line follows the selected reason and timing', () => {
  const far = { status: 'confirmed', scheduled_at: at(30) };
  const near = { status: 'confirmed', scheduled_at: at(2) };
  assert.equal(cancelReliabilityConsequenceCopy('weather', near, NOW), 'Cancelling for weather doesn’t affect your reliability score.');
  assert.match(cancelReliabilityConsequenceCopy('sickness', near, NOW), /doesn’t affect/);
  assert.match(cancelReliabilityConsequenceCopy('emergency', near, NOW), /doesn’t affect/);
  assert.equal(cancelReliabilityConsequenceCopy('schedule_conflict', far, NOW), 'This may affect your reliability score.');
  assert.match(cancelReliabilityConsequenceCopy('forgot', near, NOW), /less than 24 hours before the lesson count more/);
  const pendingNear = { status: 'pending', scheduled_at: at(2) };
  for (const reason of ['forgot', 'schedule_conflict', 'weather']) {
    assert.equal(
      cancelReliabilityConsequenceCopy(reason, pendingNear, NOW),
      'Your coach hasn’t accepted yet, so cancelling doesn’t affect your reliability score.',
    );
  }
  assert.match(cancelReasonSharedHint('student'), /honestly.*shared with your coach/);
  assert.match(cancelReasonSharedHint('coach'), /shared with your student/);
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

test('booking detail shows the policy section and a reason-aware cancel form', () => {
  assert.match(detailSrc, /<CancellationPolicySection booking=\{booking\}/);
  assert.match(detailSrc, /<option value="" disabled>Select a reason<\/option>/);
  assert.match(detailSrc, /disabled=\{busy \|\| !reason\}/);
  assert.match(detailSrc, /cancelReliabilityConsequenceCopy\(reason, booking, now\)/);
  assert.match(detailSrc, /If you cancel after accepting, the student gets a full refund and you aren’t paid\./);
});
