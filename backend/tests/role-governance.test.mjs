import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  canSelfServiceAddRole,
  effectiveRolesFromGovernance,
  getEffectiveRolesForUserRecord,
  isRoleGovernanceLocked,
  parseAdminAllowedRoles,
} from '../utils/roleGovernance.js';

const userOpen = { role_governance_locked: false, admin_allowed_roles: null };
const userLockedStudent = {
  role_governance_locked: true,
  admin_allowed_roles: ['student'],
};

describe('roleGovernance', () => {
  test('open mode: self-service can add coach', () => {
    assert.equal(canSelfServiceAddRole(userOpen, 'coach', ['student']), true);
  });

  test('locked student-only: cannot add coach', () => {
    assert.equal(canSelfServiceAddRole(userLockedStudent, 'coach', ['student']), false);
  });

  test('locked student+coach allow-list: can add coach when missing', () => {
    const u = { role_governance_locked: true, admin_allowed_roles: ['student', 'coach'] };
    assert.equal(canSelfServiceAddRole(u, 'coach', ['student']), true);
  });

  test('effectiveRoles strips coach when not in allow-list', () => {
    const u = userLockedStudent;
    assert.deepEqual(effectiveRolesFromGovernance(['student', 'coach'], u), ['student']);
  });

  test('parseAdminAllowedRoles handles array', () => {
    assert.deepEqual(parseAdminAllowedRoles(userLockedStudent), ['student']);
  });

  test('isRoleGovernanceLocked', () => {
    assert.equal(isRoleGovernanceLocked(userOpen), false);
    assert.equal(isRoleGovernanceLocked(userLockedStudent), true);
  });

  test('getEffectiveRolesForUserRecord hides ghost coach when governance is student-only', () => {
    const user = {
      role_governance_locked: true,
      admin_allowed_roles: ['student'],
      userRoles: [{ role: 'student' }, { role: 'coach' }],
    };
    assert.deepEqual(getEffectiveRolesForUserRecord(user).sort(), ['student']);
  });
});
