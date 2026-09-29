import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateProfileSchema, registerSchema } from '../config/validation.js';

describe('phone validation', () => {
  it('profile update rejects letters', () => {
    const { error } = updateProfileSchema.validate({ phone: 'fwfwefwewf' });
    assert.ok(error);
    assert.match(error.message, /only contain digits/);
  });

  it('profile update rejects too few digits', () => {
    const { error } = updateProfileSchema.validate({ phone: '123' });
    assert.ok(error);
    assert.match(error.message, /7–15 digits/);
  });

  it('profile update rejects + anywhere but the start', () => {
    assert.ok(updateProfileSchema.validate({ phone: '555+1234567' }).error);
    assert.ok(updateProfileSchema.validate({ phone: '++15551234567' }).error);
  });

  it('profile update accepts formatted numbers and empty string', () => {
    assert.equal(updateProfileSchema.validate({ phone: '(555) 123-4567' }).error, undefined);
    assert.equal(updateProfileSchema.validate({ phone: '+1 555 123 4567' }).error, undefined);
    assert.equal(updateProfileSchema.validate({ phone: '' }).error, undefined);
  });

  it('register applies the same rule', () => {
    const { error } = registerSchema.validate({
      full_name: 'Test User',
      email: 't@example.com',
      password: 'Password123',
      role: 'student',
      phone: 'call me',
    });
    assert.ok(error);
    assert.match(error.message, /only contain digits/);
  });
});
