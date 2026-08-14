/**
 * GET /api/coaches/me/stripe-connect/status — graceful handling of missing/invalid accounts.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { CoachProfile } from '../models/index.js';
import {
  getStripeConnectStatus,
  isStripeConnectAccountMissingError,
  isPlausibleStripeConnectAccountId,
  stripeConnectStatusDeps,
} from '../controllers/coachController.js';

const orig = {
  profileFindOne: CoachProfile.findOne,
  loadStripeService: stripeConnectStatusDeps.loadStripeService,
};

afterEach(() => {
  CoachProfile.findOne = orig.profileFindOne;
  stripeConnectStatusDeps.loadStripeService = orig.loadStripeService;
});

function mockRes() {
  return {
    statusCode: 200,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(payload) {
      this.payload = payload;
    },
  };
}

function coachProfileRow({
  stripe_account_id = 'acct_testflow_seed',
  stripe_ready = true,
} = {}) {
  return {
    id: 7,
    user_id: 6,
    stripe_account_id,
    stripe_ready,
    stripe_onboarding_completed_at: stripe_ready ? new Date('2026-01-01') : null,
    updates: [],
    async update(patch) {
      this.updates.push(patch);
      Object.assign(this, patch);
    },
  };
}

describe('isStripeConnectAccountMissingError', () => {
  it('detects resource_missing', () => {
    assert.equal(isStripeConnectAccountMissingError({ code: 'resource_missing' }), true);
  });

  it('detects StripeInvalidRequestError with no such account', () => {
    assert.equal(
      isStripeConnectAccountMissingError({
        type: 'StripeInvalidRequestError',
        message: "No such account: 'acct_testflow_seed'",
      }),
      true,
    );
  });

  it('detects live StripePermissionError account_invalid (deleted/inaccessible)', () => {
    assert.equal(
      isStripeConnectAccountMissingError({
        type: 'StripePermissionError',
        code: 'account_invalid',
        statusCode: 403,
        message:
          "The provided key 'sk_test_…' does not have access to account 'acct_1AAAA' (or that account does not exist). Application access may have been revoked.",
      }),
      true,
    );
  });

  it('rejects generic network errors', () => {
    assert.equal(
      isStripeConnectAccountMissingError({
        type: 'StripeConnectionError',
        message: 'An error occurred with our connection to Stripe',
      }),
      false,
    );
  });

  it('rejects authentication / misconfiguration errors (do not clear account)', () => {
    assert.equal(
      isStripeConnectAccountMissingError({
        type: 'StripeAuthenticationError',
        statusCode: 401,
        message: 'You did not provide an API key.',
      }),
      false,
    );
  });
});

describe('isPlausibleStripeConnectAccountId', () => {
  it('accepts Stripe-shaped account ids', () => {
    assert.equal(isPlausibleStripeConnectAccountId('acct_1Tz1Iz9auWv0U6YZ'), true);
  });

  it('rejects seed fakes with underscores in the suffix', () => {
    assert.equal(isPlausibleStripeConnectAccountId('acct_testflow_seed'), false);
    assert.equal(isPlausibleStripeConnectAccountId('acct_restored_70'), false);
  });
});

describe('GET /api/coaches/me/stripe-connect/status', () => {
  it('returns onboarded:false without calling Stripe when no account id', async () => {
    const profile = coachProfileRow({ stripe_account_id: null, stripe_ready: false });
    CoachProfile.findOne = async () => profile;
    let retrieved = false;
    stripeConnectStatusDeps.loadStripeService = async () => {
      retrieved = true;
      return { default: { accounts: { retrieve: async () => ({}) } } };
    };

    const res = mockRes();
    await getStripeConnectStatus({ user: { id: 6, roles: ['coach'] }, query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.onboarded, false);
    assert.equal(retrieved, false);
  });

  it('clears implausible seed account ids without calling Stripe', async () => {
    const profile = coachProfileRow({
      stripe_account_id: 'acct_testflow_seed',
      stripe_ready: true,
    });
    CoachProfile.findOne = async () => profile;
    let retrieved = false;
    stripeConnectStatusDeps.loadStripeService = async () => {
      retrieved = true;
      return { default: { accounts: { retrieve: async () => ({}) } } };
    };

    const res = mockRes();
    await getStripeConnectStatus({ user: { id: 6, roles: ['coach'] }, query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.cleared_invalid_account, true);
    assert.equal(res.payload.data.onboarded, false);
    assert.equal(retrieved, false);
    assert.equal(profile.stripe_account_id, null);
  });

  it('clears stale account and returns 200 when Stripe says account is missing', async () => {
    const profile = coachProfileRow({
      stripe_account_id: 'acct_1DeletedAccount99',
      stripe_ready: true,
    });
    CoachProfile.findOne = async () => profile;
    stripeConnectStatusDeps.loadStripeService = async () => ({
      default: {
        accounts: {
          retrieve: async () => {
            const err = new Error("No such account: 'acct_1DeletedAccount99'");
            err.type = 'StripeInvalidRequestError';
            err.code = 'resource_missing';
            err.statusCode = 404;
            throw err;
          },
        },
      },
    });

    const res = mockRes();
    await getStripeConnectStatus({ user: { id: 6, roles: ['coach'] }, query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.onboarded, false);
    assert.equal(res.payload.data.cleared_invalid_account, true);
    assert.equal(res.payload.data.account_id, null);
    assert.equal(res.payload.data.stripe_ready, false);
    assert.equal(profile.stripe_account_id, null);
    assert.equal(profile.stripe_ready, false);
    assert.ok(profile.updates.some((u) => u.stripe_account_id === null));
  });

  it('clears well-formed account when Stripe returns account_invalid PermissionError', async () => {
    const profile = coachProfileRow({
      stripe_account_id: 'acct_1DeletedAccount99',
      stripe_ready: true,
    });
    CoachProfile.findOne = async () => profile;
    stripeConnectStatusDeps.loadStripeService = async () => ({
      default: {
        accounts: {
          retrieve: async () => {
            const err = new Error(
              "The provided key 'sk_test_x' does not have access to account 'acct_1DeletedAccount99' (or that account does not exist).",
            );
            err.type = 'StripePermissionError';
            err.code = 'account_invalid';
            err.statusCode = 403;
            throw err;
          },
        },
      },
    });

    const res = mockRes();
    await getStripeConnectStatus({ user: { id: 6, roles: ['coach'] }, query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.cleared_invalid_account, true);
    assert.equal(profile.stripe_account_id, null);
  });

  it('returns 502 and keeps account on StripeAuthenticationError', async () => {
    const profile = coachProfileRow({
      stripe_account_id: 'acct_1RealLooking',
      stripe_ready: true,
    });
    CoachProfile.findOne = async () => profile;
    stripeConnectStatusDeps.loadStripeService = async () => ({
      default: {
        accounts: {
          retrieve: async () => {
            const err = new Error('Invalid API Key provided');
            err.type = 'StripeAuthenticationError';
            err.statusCode = 401;
            throw err;
          },
        },
      },
    });

    const res = mockRes();
    await getStripeConnectStatus({ user: { id: 6, roles: ['coach'] }, query: {} }, res);

    assert.equal(res.statusCode, 502);
    assert.equal(profile.stripe_account_id, 'acct_1RealLooking');
  });

  it('returns 502 (not 500) on transient Stripe connection failures', async () => {
    const profile = coachProfileRow({
      stripe_account_id: 'acct_1RealLooking',
      stripe_ready: true,
    });
    CoachProfile.findOne = async () => profile;
    stripeConnectStatusDeps.loadStripeService = async () => ({
      default: {
        accounts: {
          retrieve: async () => {
            const err = new Error('An error occurred with our connection to Stripe');
            err.type = 'StripeConnectionError';
            throw err;
          },
        },
      },
    });

    const res = mockRes();
    await getStripeConnectStatus({ user: { id: 6, roles: ['coach'] }, query: {} }, res);

    assert.equal(res.statusCode, 502);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.code, 'stripe_connect_status_unavailable');
    assert.equal(profile.stripe_account_id, 'acct_1RealLooking');
  });

  it('returns onboarded account details on successful Stripe retrieve', async () => {
    const profile = coachProfileRow({
      stripe_account_id: 'acct_ready123',
      stripe_ready: false,
    });
    CoachProfile.findOne = async () => profile;
    stripeConnectStatusDeps.loadStripeService = async () => ({
      default: {
        accounts: {
          retrieve: async () => ({
            id: 'acct_ready123',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            email: 'coach@example.com',
          }),
        },
      },
    });

    const res = mockRes();
    await getStripeConnectStatus({ user: { id: 6, roles: ['coach'] }, query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.onboarded, true);
    assert.equal(res.payload.data.account_id, 'acct_ready123');
    assert.equal(res.payload.data.charges_enabled, true);
    assert.equal(res.payload.data.payouts_enabled, true);
    assert.equal(res.payload.data.stripe_ready, true);
  });
});
