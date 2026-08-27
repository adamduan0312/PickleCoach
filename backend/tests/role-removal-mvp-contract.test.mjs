/**
 * Always-on contracts for role-removal MVP invariants (no DB required).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canSelfServiceRemoveRole } from '../utils/roleGovernance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const authSrc = readFileSync(join(__dirname, '../controllers/authController.js'), 'utf8');
const bookingSrc = readFileSync(join(__dirname, '../controllers/bookingController.js'), 'utf8');
const lifecycleSrc = readFileSync(join(__dirname, '../utils/userLifecycle.js'), 'utf8');
const eligibilitySrc = readFileSync(join(__dirname, '../services/coachMarketplaceEligibility.js'), 'utf8');

describe('role-removal MVP contracts', () => {
  it('self-service remove keeps at least one of student/coach', () => {
    assert.equal(canSelfServiceRemoveRole({}, 'coach', ['student', 'coach']), true);
    assert.equal(canSelfServiceRemoveRole({}, 'student', ['student', 'coach']), true);
    assert.equal(canSelfServiceRemoveRole({}, 'coach', ['coach']), false);
    assert.equal(canSelfServiceRemoveRole({}, 'student', ['student']), false);
  });

  it('remove path only destroys user_roles row (does not soft-delete coach profile)', () => {
    const removeIdx = authSrc.indexOf("action === 'remove'");
    assert.ok(removeIdx > 0);
    const slice = authSrc.slice(removeIdx, removeIdx + 2500);
    assert.match(slice, /UserRole\.destroy/);
    assert.doesNotMatch(slice, /CoachProfile\.(destroy|update)/);
    assert.doesNotMatch(slice, /Lesson\.(destroy|update)/);
    assert.doesNotMatch(slice, /Booking\.(destroy|update)/);
  });

  it('existing booking get/cancel authorize by participation ids', () => {
    assert.match(bookingSrc, /req\.user\.id === booking\.coach_id \|\| req\.user\.id === booking\.primary_student_id/);
    assert.match(bookingSrc, /isCoach = req\.user\.id === bookingPreview\.coach_id/);
    assert.match(bookingSrc, /isStudent = req\.user\.id === bookingPreview\.primary_student_id/);
  });

  it('accept booking gates on assigned coach_id (not current roles.includes)', () => {
    const acceptIdx = bookingSrc.indexOf('export const acceptBooking');
    const acceptBody = bookingSrc.slice(acceptIdx, acceptIdx + 2000);
    assert.match(acceptBody, /req\.user\.id !== booking\.coach_id/);
    assert.doesNotMatch(acceptBody, /roles\.includes\(['"]coach['"]\)/);
  });

  it('public/marketplace coach discovery requires effective coach role', () => {
    assert.match(lifecycleSrc, /getEffectiveRolesForUserRecord\(user\)\.includes\('coach'\)/);
    assert.match(eligibilitySrc, /roles\.includes\('coach'\)/);
  });
});
