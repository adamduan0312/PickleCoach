/**
 * Admin role removal rules for `PUT /api/users/:id` (see `userController.updateUser`).
 * `otherAdminUserCount` in production is **`countOtherLiveAdmins(targetUserId)`** — not a raw `user_roles` count (soft-deleted admins must not count).
 * Coach/Stripe: removing the `coach` role does not delete `coach_profiles` or `stripe_account_id`;
 * escrow release uses `payments.coach_id` and the coach user's `CoachProfile`, not session roles.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Payment from '../models/Payment.js';
import Payout from '../models/Payout.js';
import { validateAdminRoleRemovalSafeguards, validateAdminSuspendSafeguards } from '../utils/userRoleChangeGuards.js';

describe('validateAdminRoleRemovalSafeguards', () => {
  it('allows removal when another admin exists', () => {
    const r = validateAdminRoleRemovalSafeguards({
      actorUserId: 1,
      targetUserId: 2,
      previousRoles: ['admin'],
      nextRoles: ['student'],
      otherAdminUserCount: 1,
    });
    assert.equal(r.ok, true);
  });

  it('returns 409 when removing last admin (not self)', () => {
    const r = validateAdminRoleRemovalSafeguards({
      actorUserId: 1,
      targetUserId: 2,
      previousRoles: ['admin'],
      nextRoles: ['coach'],
      otherAdminUserCount: 0,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.message, /At least one admin must remain/i);
  });

  it('returns 400 when admin removes own admin role, e.g. ["admin","coach"] -> ["coach"] on own user id (even if other admins exist)', () => {
    const r = validateAdminRoleRemovalSafeguards({
      actorUserId: 1,
      targetUserId: 1,
      previousRoles: ['admin', 'coach'],
      nextRoles: ['coach'],
      otherAdminUserCount: 5,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.message, /cannot remove your own admin role/i);
  });

  it('no-op when admin role retained', () => {
    const r = validateAdminRoleRemovalSafeguards({
      actorUserId: 1,
      targetUserId: 1,
      previousRoles: ['admin', 'coach'],
      nextRoles: ['admin', 'coach'],
      otherAdminUserCount: 0,
    });
    assert.equal(r.ok, true);
  });

  it('no-op when target was not admin', () => {
    const r = validateAdminRoleRemovalSafeguards({
      actorUserId: 1,
      targetUserId: 2,
      previousRoles: ['student', 'coach'],
      nextRoles: ['student'],
      otherAdminUserCount: 0,
    });
    assert.equal(r.ok, true);
  });
});

describe('validateAdminSuspendSafeguards', () => {
  it('allows suspending a non-admin', () => {
    const r = validateAdminSuspendSafeguards({
      actorUserId: 1,
      targetUserId: 2,
      targetIsLiveAdmin: false,
      otherAdminUserCount: 0,
    });
    assert.equal(r.ok, true);
  });

  it('allows suspending an admin when another live admin exists', () => {
    const r = validateAdminSuspendSafeguards({
      actorUserId: 1,
      targetUserId: 2,
      targetIsLiveAdmin: true,
      otherAdminUserCount: 1,
    });
    assert.equal(r.ok, true);
  });

  it('blocks suspending the last live admin', () => {
    const r = validateAdminSuspendSafeguards({
      actorUserId: 1,
      targetUserId: 2,
      targetIsLiveAdmin: true,
      otherAdminUserCount: 0,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.message, /At least one admin must remain/i);
  });

  it('blocks self-suspend when you are the only live admin', () => {
    const r = validateAdminSuspendSafeguards({
      actorUserId: 1,
      targetUserId: 1,
      targetIsLiveAdmin: true,
      otherAdminUserCount: 0,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.message, /cannot suspend yourself/i);
  });

  it('allows self-suspend when another live admin exists', () => {
    const r = validateAdminSuspendSafeguards({
      actorUserId: 1,
      targetUserId: 1,
      targetIsLiveAdmin: true,
      otherAdminUserCount: 2,
    });
    assert.equal(r.ok, true);
  });
});

describe('Coach role downgrade and payouts (data contract)', () => {
  it('Payment and Payout rows keep coach_id for historical transfers after coach role is removed from user_roles', () => {
    assert.ok('coach_id' in Payment.rawAttributes, 'Payment.coach_id backs escrow/payout worker');
    assert.ok('coach_id' in Payout.rawAttributes, 'Payout.coach_id records historical payouts');
  });
});
