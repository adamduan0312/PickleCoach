import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAdminUsersListOrder } from '../utils/adminUsersListOrder.js';

describe('buildAdminUsersListOrder', () => {
  it('All: suspended before active, then created_at DESC', () => {
    assert.deepEqual(buildAdminUsersListOrder({}), [
      ['is_active', 'ASC'],
      ['created_at', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('Active / Suspended: created_at DESC', () => {
    assert.deepEqual(buildAdminUsersListOrder({ is_active: 'true' }), [
      ['created_at', 'DESC'],
      ['id', 'DESC'],
    ]);
    assert.deepEqual(buildAdminUsersListOrder({ is_active: 'false' }), [
      ['created_at', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('Deleted: deleted_at DESC', () => {
    assert.deepEqual(buildAdminUsersListOrder({ deleted: 'true' }), [
      ['deleted_at', 'DESC'],
      ['id', 'DESC'],
    ]);
  });
});
