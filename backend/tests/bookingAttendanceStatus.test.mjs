import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  validateAttendanceOutcomeTransition,
  DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES,
  ADMIN_MARK_NO_SHOW_SOURCE_STATUSES,
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
