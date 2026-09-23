import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getUsersQuerySchema,
  getDisputesQuerySchema,
  createAdminSchema,
} from '../config/validation.js';

describe('admin list query schemas', () => {
  it('accepts is_active for users list', () => {
    assert.equal(getUsersQuerySchema.validate({ is_active: 'true' }).error, undefined);
    assert.equal(getUsersQuerySchema.validate({ is_active: 'false' }).error, undefined);
    assert.ok(getUsersQuerySchema.validate({ is_active: 'maybe' }).error);
  });

  it('accepts deleted true/false for users list', () => {
    assert.equal(getUsersQuerySchema.validate({ deleted: 'true' }).error, undefined);
    assert.equal(getUsersQuerySchema.validate({ deleted: 'false' }).error, undefined);
    assert.ok(getUsersQuerySchema.validate({ deleted: 'all' }).error);
  });

  it('accepts user_id for disputes list', () => {
    assert.equal(getDisputesQuerySchema.validate({ user_id: 12, limit: 20 }).error, undefined);
    assert.ok(getDisputesQuerySchema.validate({ user_id: -1 }).error);
  });
});

describe('createAdminSchema', () => {
  it('requires full_name, email, and MVP password policy', () => {
    assert.ok(createAdminSchema.validate({}).error);
    assert.ok(
      createAdminSchema.validate({
        full_name: 'A',
        email: 'a@example.com',
        password: 'short',
      }).error,
    );
    assert.ok(
      createAdminSchema.validate({
        full_name: 'Admin User',
        email: 'a@example.com',
        password: 'alllowercase1',
      }).error,
    );
    const ok = createAdminSchema.validate({
      full_name: 'Admin User',
      email: 'admin@example.com',
      password: 'SecurePass1',
      timezone: 'America/New_York',
    });
    assert.equal(ok.error, undefined);
    assert.equal(ok.value.timezone, 'America/New_York');
  });

  it('defaults timezone to UTC', () => {
    const ok = createAdminSchema.validate({
      full_name: 'Admin User',
      email: 'admin2@example.com',
      password: 'SecurePass1',
    });
    assert.equal(ok.error, undefined);
    assert.equal(ok.value.timezone, 'UTC');
  });
});
