/**
 * Stripe Connect onboarding — create-once / resume-anytime contract.
 *
 * Account Links are single-use and expire (~5 min). A coach who abandons the hosted
 * flow must be able to call POST /coaches/me/stripe-connect/onboard again and get a
 * fresh link for their EXISTING account. The old behavior 409'd whenever
 * stripe_account_id was set, permanently stranding half-onboarded coaches.
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { User, CoachProfile } from '../models/index.js';
import {
  initiateStripeConnectOnboarding,
  stripeConnectOnboardDeps,
} from '../controllers/coachController.js';

const orig = {
  findByPk: User.findByPk,
  profileFindOne: CoachProfile.findOne,
  loadStripeService: stripeConnectOnboardDeps.loadStripeService,
  loadAudit: stripeConnectOnboardDeps.loadAudit,
};

afterEach(() => {
  User.findByPk = orig.findByPk;
  CoachProfile.findOne = orig.profileFindOne;
  stripeConnectOnboardDeps.loadStripeService = orig.loadStripeService;
  stripeConnectOnboardDeps.loadAudit = orig.loadAudit;
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

function coachUser() {
  return {
    id: 6,
    email: 'coach6@example.com',
    role_governance_locked: false,
    admin_allowed_roles: null,
    userRoles: [{ role: 'coach' }],
  };
}

function coachProfileRow({ stripe_account_id = null, stripe_ready = false } = {}) {
  const row = {
    id: 7,
    user_id: 6,
    stripe_account_id,
    stripe_ready,
    updates: [],
    async update(patch) {
      this.updates.push(patch);
      Object.assign(this, patch);
    },
  };
  return row;
}

function stubDeps({ onCreateAccount, onCreateLink } = {}) {
  const calls = { createAccount: 0, createLink: [], audits: [] };
  stripeConnectOnboardDeps.loadStripeService = async () => ({
    createConnectAccount: async (email, metadata) => {
      calls.createAccount += 1;
      if (onCreateAccount) return onCreateAccount(email, metadata);
      return { id: 'acct_new_123' };
    },
    createAccountLink: async (accountId, returnUrl, refreshUrl) => {
      calls.createLink.push({ accountId, returnUrl, refreshUrl });
      if (onCreateLink) return onCreateLink(accountId);
      return { url: `https://connect.stripe.com/setup/e/${accountId}/fresh`, expires_at: 1234567890 };
    },
  });
  stripeConnectOnboardDeps.loadAudit = async () => ({
    logAudit: async (userId, action) => {
      calls.audits.push(action);
    },
  });
  return calls;
}

const req = () => ({ user: { id: 6, roles: ['coach'] }, body: {} });

describe('POST /api/coaches/me/stripe-connect/onboard', () => {
  it('creates the Connect account and stores it on first call (201)', async () => {
    User.findByPk = async () => coachUser();
    const profile = coachProfileRow();
    CoachProfile.findOne = async () => profile;
    const calls = stubDeps();

    const res = mockRes();
    await initiateStripeConnectOnboarding(req(), res);

    assert.equal(res.statusCode, 201);
    assert.equal(calls.createAccount, 1);
    assert.equal(profile.stripe_account_id, 'acct_new_123');
    assert.equal(profile.stripe_ready, false);
    assert.equal(res.payload.data.account_id, 'acct_new_123');
    assert.match(res.payload.data.onboarding_url, /acct_new_123/);
    assert.deepEqual(calls.audits, ['stripe_connect_onboarding_initiated']);
  });

  it('resumes with a fresh link for an existing unfinished account (200, no new account)', async () => {
    User.findByPk = async () => coachUser();
    const profile = coachProfileRow({ stripe_account_id: 'acct_1Tz1Iz9auWv0U6YZ', stripe_ready: false });
    CoachProfile.findOne = async () => profile;
    const calls = stubDeps();

    const res = mockRes();
    await initiateStripeConnectOnboarding(req(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls.createAccount, 0, 'must never create a second Connect account');
    assert.deepEqual(profile.updates, [], 'profile row untouched on resume');
    assert.equal(calls.createLink.length, 1);
    assert.equal(calls.createLink[0].accountId, 'acct_1Tz1Iz9auWv0U6YZ');
    assert.equal(res.payload.data.account_id, 'acct_1Tz1Iz9auWv0U6YZ');
    assert.match(res.payload.message, /refreshed/i);
    assert.deepEqual(calls.audits, ['stripe_connect_onboarding_link_refreshed']);
  });

  it('409s only when onboarding is already complete, without calling Stripe', async () => {
    User.findByPk = async () => coachUser();
    CoachProfile.findOne = async () =>
      coachProfileRow({ stripe_account_id: 'acct_done', stripe_ready: true });
    const calls = stubDeps();

    const res = mockRes();
    await initiateStripeConnectOnboarding(req(), res);

    assert.equal(res.statusCode, 409);
    assert.match(res.payload.message, /already complete/i);
    assert.equal(calls.createAccount, 0);
    assert.equal(calls.createLink.length, 0);
  });

  it('forbids non-coach users', async () => {
    const res = mockRes();
    await initiateStripeConnectOnboarding({ user: { id: 9, roles: ['student'] }, body: {} }, res);
    assert.equal(res.statusCode, 403);
  });
});
