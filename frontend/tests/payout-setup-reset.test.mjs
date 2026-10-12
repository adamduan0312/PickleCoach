import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  PAYOUT_SETUP_RESET_MESSAGE,
  nextPayoutSetupReset,
  payoutSetupResetStorageKey,
} from '../src/domain/payoutSetupReset.js';

describe('payout setup reset state', () => {
  it('turns on when the server cleared a missing Stripe account', () => {
    assert.equal(nextPayoutSetupReset(false, { onboarded: false, cleared_invalid_account: true }), true);
  });

  it('stays on across later status checks until payouts are ready again', () => {
    assert.equal(nextPayoutSetupReset(true, { onboarded: false, stripe_ready: false }), true);
    assert.equal(nextPayoutSetupReset(true, null), true);
    assert.equal(nextPayoutSetupReset(true, { onboarded: true, stripe_ready: true }), false);
  });

  it('stays off when nothing was cleared', () => {
    assert.equal(nextPayoutSetupReset(false, { onboarded: false, stripe_ready: false }), false);
  });

  it('is scoped per user and tells the coach how to recover', () => {
    assert.notEqual(payoutSetupResetStorageKey(1), payoutSetupResetStorageKey(2));
    assert.match(PAYOUT_SETUP_RESET_MESSAGE, /Set up payouts again/);
  });

  it('dashboard shows the reset notice to unlisted coaches', () => {
    const src = readFileSync(new URL('../src/pages/coach/CoachDashboardPage.jsx', import.meta.url), 'utf8');
    assert.match(src, /payoutSetupReset && !listed/);
    assert.match(src, /PAYOUT_SETUP_RESET_MESSAGE/);
  });
});
