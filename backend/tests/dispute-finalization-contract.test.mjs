/**
 * Contract tests for dispute-driven attendance finalization — no DB, no HTTP.
 * Guards runtime invariants described in `backend/docs/dispute-finalization.md`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  checkAttendanceFinalized,
  DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES,
  validateAttendanceOutcomeTransition,
} from '../utils/bookingAttendanceStatus.js';

const disputeSources = new Set(DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES);

const __dirname = dirname(fileURLToPath(import.meta.url));
const disputeControllerPath = join(__dirname, '../controllers/disputeController.js');
const bookingControllerPath = join(__dirname, '../controllers/bookingController.js');

test('resolveDispute transaction always sets attendance_finalized on booking update (all dispute types)', () => {
  const src = readFileSync(disputeControllerPath, 'utf8');
  assert.match(
    src,
    /patch:\s*\{\s*attendance_finalized:\s*true\s*\}/,
    'booking status change from resolve must include attendance_finalized: true in applyBookingStatusTransition patch',
  );
  assert.match(
    src,
    /if \(bookingStatusChanging \|\| bookingFinalizationChanging\)/,
    'booking row must update when only finalization flips (e.g. behavior on completed)',
  );
});

test('admin no-show handlers call checkAttendanceFinalized after active-dispute guard', () => {
  const src = readFileSync(bookingControllerPath, 'utf8');
  const coachIdx = src.indexOf('export const adminMarkCoachNoShow');
  const studentIdx = src.indexOf('export const adminMarkBookingNoShow');
  assert.ok(coachIdx > 0 && studentIdx > 0);
  const coachSlice = src.slice(coachIdx, coachIdx + 3500);
  const studentSlice = src.slice(studentIdx, studentIdx + 3500);
  assert.match(coachSlice, /checkAttendanceFinalized\(booking\)/);
  assert.match(studentSlice, /checkAttendanceFinalized\(booking\)/);
});

test('coach complete and student-no-show call checkAttendanceFinalized', () => {
  const src = readFileSync(bookingControllerPath, 'utf8');
  const completeIdx = src.indexOf('export const completeBooking');
  const noShowIdx = src.indexOf('export const markBookingNoShow');
  assert.ok(completeIdx > 0 && noShowIdx > 0);
  const completeSlice = src.slice(completeIdx, completeIdx + 2500);
  const noShowSlice = src.slice(noShowIdx, noShowIdx + 3500);
  assert.match(completeSlice, /checkAttendanceFinalized\(booking\)/);
  assert.match(noShowSlice, /checkAttendanceFinalized\(booking\)/);
});

test('accept and decline lock booking row like cancel', () => {
  const src = readFileSync(bookingControllerPath, 'utf8');
  const acceptIdx = src.indexOf('export const acceptBooking');
  const declineIdx = src.indexOf('export const declineBooking');
  const cancelIdx = src.indexOf('export const cancelBooking');
  assert.ok(acceptIdx > 0 && declineIdx > 0 && cancelIdx > 0);
  const acceptSlice = src.slice(acceptIdx, declineIdx);
  const declineSlice = src.slice(declineIdx, cancelIdx);
  assert.match(acceptSlice, /lock:\s*t\.LOCK\.UPDATE/);
  assert.match(declineSlice, /lock:\s*t\.LOCK\.UPDATE/);
  assert.match(acceptSlice, /sequelize\.transaction/);
  assert.match(declineSlice, /sequelize\.transaction/);
});

test('after finalize: admin path would be blocked (checkAttendanceFinalized)', () => {
  const r = checkAttendanceFinalized({
    id: 1,
    status: 'completed',
    attendance_finalized: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'attendance_finalized_locked');
});

test('new attendance dispute resolve can override: student_no_show → coach_no_show allowed from dispute sources', () => {
  const t = validateAttendanceOutcomeTransition(
    'student_no_show',
    'coach_no_show',
    disputeSources,
  );
  assert.equal(t.ok, true, t.message || '');
});

test('new attendance dispute resolve can override: completed → student_no_show allowed', () => {
  const t = validateAttendanceOutcomeTransition(
    'completed',
    'student_no_show',
    disputeSources,
  );
  assert.equal(t.ok, true, t.message || '');
});

test('behavior dispute codes are misconduct and lesson_not_completed (doc contract)', () => {
  const src = readFileSync(join(__dirname, '../config/validation.js'), 'utf8');
  assert.match(
    src,
    /Joi\.valid\('misconduct', 'lesson_not_completed'\)/,
    'resolveDisputeSchema must list behavior dispute codes that require penalize_role',
  );
});

test('other resolve releases disputed bookings via deriveResolvedBookingStatusFromDisputeResolve', () => {
  const src = readFileSync(disputeControllerPath, 'utf8');
  assert.match(
    src,
    /deriveResolvedBookingStatusFromDisputeResolve/,
    'resolveDispute must derive booking status through shared helper',
  );
  assert.match(
    src,
    /deriveDisputeResolveBookingTransitionVia/,
    'resolveDispute must pick state-machine via through shared helper',
  );
});
