/**
 * Student schedule-overlap invariant — unit + source-contract tests (no DB).
 *
 * Rule: a student cannot have two pending/confirmed/awaiting_verification
 * bookings that overlap in time, regardless of coach.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STUDENT_SCHEDULE_CONFLICT_CODE,
  SLOT_NO_LONGER_AVAILABLE_CODE,
} from '../utils/bookingIntentContract.js';
import {
  bookingIntervalsOverlap,
  STUDENT_ACTIVE_SCHEDULE_STATUSES,
} from '../services/bookingService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bookingServiceSrc = readFileSync(join(__dirname, '../services/bookingService.js'), 'utf8');
const bookingIntentServiceSrc = readFileSync(
  join(__dirname, '../services/bookingIntentService.js'),
  'utf8',
);

describe('bookingIntervalsOverlap (pure)', () => {
  const t10 = '2026-09-01T10:00:00.000Z';
  const t1030 = '2026-09-01T10:30:00.000Z';
  const t11 = '2026-09-01T11:00:00.000Z';
  const t14 = '2026-09-01T14:00:00.000Z';

  it('detects exact same window', () => {
    assert.equal(bookingIntervalsOverlap(t10, 60, t10, 60), true);
  });

  it('detects partial overlap', () => {
    assert.equal(bookingIntervalsOverlap(t10, 60, t1030, 60), true);
    assert.equal(bookingIntervalsOverlap(t1030, 60, t10, 60), true);
  });

  it('allows adjacent (touching) windows', () => {
    // 10–11 and 11–12 touch at the boundary; not overlapping.
    assert.equal(bookingIntervalsOverlap(t10, 60, t11, 60), false);
  });

  it('allows non-overlapping times (different coaches shopping)', () => {
    assert.equal(bookingIntervalsOverlap(t10, 60, t14, 60), false);
  });
});

describe('student active schedule statuses', () => {
  it('blocks pending, confirmed, and awaiting_verification', () => {
    assert.deepEqual(
      [...STUDENT_ACTIVE_SCHEDULE_STATUSES].sort(),
      ['awaiting_verification', 'confirmed', 'pending'],
    );
  });

  it('does not treat cancelled as blocking', () => {
    assert.equal(STUDENT_ACTIVE_SCHEDULE_STATUSES.includes('cancelled'), false);
  });
});

describe('student schedule conflict contract', () => {
  it('exports a distinct conflict code from coach slot-taken', () => {
    assert.equal(STUDENT_SCHEDULE_CONFLICT_CODE, 'student_schedule_conflict');
    assert.notEqual(STUDENT_SCHEDULE_CONFLICT_CODE, SLOT_NO_LONGER_AVAILABLE_CODE);
  });

  it('checks student overlap by primary_student_id inside bookingService', () => {
    assert.match(bookingServiceSrc, /primary_student_id:\s*studentId/);
    assert.match(bookingServiceSrc, /STUDENT_SCHEDULE_CONFLICT_CODE|student_schedule_conflict/);
    assert.match(bookingServiceSrc, /STUDENT_ACTIVE_SCHEDULE_STATUSES/);
  });

  it('passes studentId into availability checks on intent and confirm', () => {
    assert.match(bookingIntentServiceSrc, /checkBookingAvailability\([\s\S]*?\{\s*studentId\s*\}/);
    const confirmSection = bookingIntentServiceSrc.slice(
      bookingIntentServiceSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
    );
    assert.match(confirmSection, /studentId\s*[,}]/);
    assert.match(confirmSection, /STUDENT_SCHEDULE_CONFLICT_CODE/);
  });

  it('locks the student row during confirm to serialize cross-coach races', () => {
    const confirmSection = bookingIntentServiceSrc.slice(
      bookingIntentServiceSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
    );
    assert.match(confirmSection, /User\.findByPk\(\s*studentId/);
    assert.match(confirmSection, /lock:\s*transaction\.LOCK\.UPDATE/);
  });

  it('writes confirm audit log after transaction commit (avoids user-row lock wait)', () => {
    const confirmSection = bookingIntentServiceSrc.slice(
      bookingIntentServiceSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
    );
    const commitIdx = confirmSection.indexOf('await transaction.commit()');
    const auditIdx = confirmSection.indexOf("action: 'booking_confirmed_after_authorization'");
    assert.ok(commitIdx > -1, 'confirm should commit transaction');
    assert.ok(auditIdx > -1, 'confirm should audit');
    assert.ok(auditIdx > commitIdx, 'audit log must run after commit, not inside locked transaction');
  });
});
