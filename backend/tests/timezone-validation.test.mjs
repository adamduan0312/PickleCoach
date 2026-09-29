import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isValidTimeZone,
  registerSchema,
  updateProfileSchema,
  updateUserSchema,
} from '../config/validation.js';

describe('timezone validation', () => {
  it('recognizes real IANA zones and UTC', () => {
    assert.equal(isValidTimeZone('America/Chicago'), true);
    assert.equal(isValidTimeZone('Asia/Tokyo'), true);
    assert.equal(isValidTimeZone('UTC'), true);
  });

  it('rejects made-up or empty zones', () => {
    assert.equal(isValidTimeZone('Mars/Base'), false);
    assert.equal(isValidTimeZone(''), false);
    assert.equal(isValidTimeZone(null), false);
  });

  it('profile update rejects an invalid timezone with a friendly message', () => {
    const { error } = updateProfileSchema.validate({ timezone: 'Mars/Base' });
    assert.ok(error);
    assert.match(error.message, /valid time zone/);
    assert.equal(updateProfileSchema.validate({ timezone: 'America/Los_Angeles' }).error, undefined);
  });

  it('admin user update and register apply the same rule', () => {
    assert.ok(updateUserSchema.validate({ timezone: 'Mars/Base' }).error);
    const { error, value } = registerSchema.validate({
      full_name: 'Test User',
      email: 't@example.com',
      password: 'Password123',
      role: 'student',
    });
    assert.equal(error, undefined);
    assert.equal(value.timezone, 'UTC');
    assert.ok(registerSchema.validate({
      full_name: 'Test User',
      email: 't@example.com',
      password: 'Password123',
      role: 'student',
      timezone: 'Mars/Base',
    }).error);
  });
});
