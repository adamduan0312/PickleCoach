import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  validateAttendanceOutcomeTransition,
  DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES,
  ADMIN_MARK_NO_SHOW_SOURCE_STATUSES,
  checkAttendanceFinalized,
} from '../utils/bookingAttendanceStatus.js';

const disputeSources = new Set(DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES);
const adminSources = new Set(ADMIN_MARK_NO_SHOW_SOURCE_STATUSES);

describe('bookingAttendanceStatus', () => {
  it('allows disputed → coach_no_show for dispute resolve', () => {
    const r = validateAttendanceOutcomeTransition('disputed', 'coach_no_show', disputeSources);
    assert.equal(r.ok, true);
  });

  it('allows completed → student_no_show for dispute resolve', () => {
    const r = validateAttendanceOutcomeTransition('completed', 'student_no_show', disputeSources);
    assert.equal(r.ok, true);
  });

  it('rejects cancelled → coach_no_show', () => {
    const r = validateAttendanceOutcomeTransition('cancelled', 'coach_no_show', disputeSources);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'invalid_attendance_status_transition');
  });

  it('noop same status passes', () => {
    const r = validateAttendanceOutcomeTransition(
      'student_no_show',
      'student_no_show',
      adminSources,
    );
    assert.equal(r.ok, true);
  });
});

/**
 * `checkAttendanceFinalized` is the guardrail wired into both admin no-show
 * endpoints. These tests pin its semantics so future controller refactors
 * don't accidentally regress the hard-resolution contract (see
 * `backend/docs/dispute-finalization.md`).
 */
describe('checkAttendanceFinalized', () => {
  it('returns ok when booking has not been finalized', () => {
    const r = checkAttendanceFinalized({
      id: 1,
      status: 'student_no_show',
      attendance_finalized: false,
    });
    assert.equal(r.ok, true);
  });

  it('returns ok when the field is missing entirely (pre-migration row)', () => {
    const r = checkAttendanceFinalized({ id: 1, status: 'completed' });
    assert.equal(r.ok, true);
  });

  it('treats null/undefined booking as not finalized (no false-positive lock)', () => {
    assert.equal(checkAttendanceFinalized(null).ok, true);
    assert.equal(checkAttendanceFinalized(undefined).ok, true);
  });

  it('blocks with attendance_finalized_locked when finalized=true', () => {
    const r = checkAttendanceFinalized({
      id: 1,
      status: 'student_no_show',
      attendance_finalized: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'attendance_finalized_locked');
    assert.match(r.message, /finalized/i);
    assert.match(r.message, /new dispute/i);
  });

  it('does not unlock just because status is still mutable elsewhere', () => {
    // Even if the booking looks like one the admin endpoints could normally
    // toggle (e.g. coach_no_show ↔ student_no_show), the flag wins.
    const r = checkAttendanceFinalized({
      id: 1,
      status: 'coach_no_show',
      attendance_finalized: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'attendance_finalized_locked');
  });

  it('only true (boolean) triggers the lock — truthy is not enough', () => {
    // Defensive against e.g. raw DB query results returning 1/0 ints.
    const r1 = checkAttendanceFinalized({ id: 1, attendance_finalized: 1 });
    assert.equal(r1.ok, true);
    const r2 = checkAttendanceFinalized({ id: 1, attendance_finalized: 'true' });
    assert.equal(r2.ok, true);
  });
});
