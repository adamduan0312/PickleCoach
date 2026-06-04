import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  getCoachUiPhase,
  hasCoachRole,
  isCoachReady,
  isStudentReady,
  computeCoachReadiness,
} from '../src/domain/userReadiness.js';

describe('userReadiness', () => {
  test('coach role without profile → start_setup', () => {
    assert.equal(getCoachUiPhase({ roles: ['coach', 'student'] }), 'start_setup');
  });

  test('coach + profile, no stripe → connect_stripe', () => {
    assert.equal(
      getCoachUiPhase({ roles: ['coach'], coachProfile: { user_id: 1, stripe_account_id: null } }),
      'connect_stripe',
    );
  });

  test('no coach role → hidden even if ghost profile on client', () => {
    assert.equal(
      getCoachUiPhase({ roles: ['student'], coachProfile: { user_id: 1, stripe_account_id: 'acct_123' } }),
      'hidden',
    );
  });

  test('isCoachReady relaxed when status omitted', () => {
    const user = {
      roles: ['coach'],
      coachProfile: { stripe_account_id: 'acct_x', deleted_at: null },
    };
    assert.equal(isCoachReady(user), true);
  });

  test('isCoachReady false when Connect status incomplete', () => {
    const user = {
      roles: ['coach'],
      coachProfile: { stripe_account_id: 'acct_x' },
    };
    assert.equal(
      isCoachReady(user, { payouts_enabled: false, details_submitted: true }),
      false,
    );
  });

  test('student ready from role only', () => {
    assert.equal(isStudentReady({ roles: ['student'] }), true);
    assert.equal(isStudentReady({ roles: ['coach'] }), false);
  });

  test('computeCoachReadiness exposes flags', () => {
    const r = computeCoachReadiness({
      roles: ['coach'],
      coachProfile: { stripe_account_id: 'acct_1' },
    });
    assert.equal(r.isCoachRole, true);
    assert.equal(r.hasCoachProfile, true);
    assert.equal(r.hasStripeConnected, true);
    assert.equal(r.coachUiPhase, 'ready');
  });
});
