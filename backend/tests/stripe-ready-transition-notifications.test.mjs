/**
 * stripe_ready transition notifications — coach is told when Stripe pauses or
 * (re)enables payouts, and ONLY on actual flips. Duplicate account.updated
 * webhook deliveries (same state) must stay silent.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  syncCoachStripeReadyFromAccount,
  stripeReadySyncDeps,
} from '../services/coachMarketplaceEligibility.js';
import {
  buildStripePayoutsDisabledNotificationContent,
  buildStripePayoutsEnabledNotificationContent,
} from '../notifications/payloadBuilders.js';
import { withNotificationRoute } from '../notifications/notificationRoutes.js';
import { getEmailSubject, getEmailContent } from '../notifications/emailTemplates.js';

const origLoad = stripeReadySyncDeps.loadNotificationService;

afterEach(() => {
  stripeReadySyncDeps.loadNotificationService = origLoad;
});

function coachProfileRow(stripeReady) {
  return {
    id: 7,
    user_id: 6,
    stripe_ready: stripeReady,
    stripe_onboarding_completed_at: stripeReady ? new Date('2026-07-01') : null,
    async update(patch) {
      Object.assign(this, patch);
    },
  };
}

function stubNotifications() {
  const calls = [];
  stripeReadySyncDeps.loadNotificationService = async () => ({
    notifyCoachStripePayoutsDisabled: async (userId) => calls.push(['disabled', userId]),
    notifyCoachStripePayoutsEnabled: async (userId) => calls.push(['enabled', userId]),
  });
  return calls;
}

const readyAccount = { payouts_enabled: true, details_submitted: true };
const revokedAccount = { payouts_enabled: false, details_submitted: true };

describe('syncCoachStripeReadyFromAccount transition notifications', () => {
  it('true→false notifies payouts disabled', async () => {
    const calls = stubNotifications();
    const profile = coachProfileRow(true);

    const ready = await syncCoachStripeReadyFromAccount(profile, revokedAccount);

    assert.equal(ready, false);
    assert.equal(profile.stripe_ready, false);
    assert.deepEqual(calls, [['disabled', 6]]);
  });

  it('false→false stays silent (duplicate webhook deliveries)', async () => {
    const calls = stubNotifications();
    const profile = coachProfileRow(false);

    await syncCoachStripeReadyFromAccount(profile, revokedAccount);
    await syncCoachStripeReadyFromAccount(profile, revokedAccount);

    assert.deepEqual(calls, []);
  });

  it('false→true notifies payouts enabled', async () => {
    const calls = stubNotifications();
    const profile = coachProfileRow(false);

    const ready = await syncCoachStripeReadyFromAccount(profile, readyAccount);

    assert.equal(ready, true);
    assert.deepEqual(calls, [['enabled', 6]]);
  });

  it('true→true stays silent', async () => {
    const calls = stubNotifications();
    const profile = coachProfileRow(true);

    await syncCoachStripeReadyFromAccount(profile, readyAccount);

    assert.deepEqual(calls, []);
  });

  it('notification failure never breaks the sync', async () => {
    stripeReadySyncDeps.loadNotificationService = async () => ({
      notifyCoachStripePayoutsDisabled: async () => {
        throw new Error('sendgrid down');
      },
      notifyCoachStripePayoutsEnabled: async () => {
        throw new Error('sendgrid down');
      },
    });
    const profile = coachProfileRow(true);

    const ready = await syncCoachStripeReadyFromAccount(profile, revokedAccount);

    assert.equal(ready, false);
    assert.equal(profile.stripe_ready, false, 'flag still synced despite notify failure');
  });
});

describe('stripe payout notification presentation', () => {
  it('in-app payloads satisfy the UI contract (headline/summary/route)', () => {
    for (const [type, builder] of [
      ['stripe_payouts_disabled', buildStripePayoutsDisabledNotificationContent],
      ['stripe_payouts_enabled', buildStripePayoutsEnabledNotificationContent],
    ]) {
      const payload = withNotificationRoute(type, builder());
      assert.ok(payload.headline.trim().length > 0, `${type}: headline`);
      assert.ok(payload.summary.trim().length > 0, `${type}: summary`);
      assert.ok(payload.route.startsWith('/'), `${type}: route`);
    }
  });

  it('email subject and body exist for both types (not generic fallback)', () => {
    for (const type of ['stripe_payouts_disabled', 'stripe_payouts_enabled']) {
      assert.notEqual(getEmailSubject(type), 'Notification from PickleCoach', `${type}: subject`);
      assert.doesNotMatch(
        getEmailContent(type, {}),
        /new notification from PickleCoach/,
        `${type}: body`,
      );
    }
  });
});
