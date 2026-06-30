/**
 * Dev seed Stripe stub — prefix + DB hydration (no live Stripe key required).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDevSeedPaymentIntentId } from '../services/stripeService.js';

describe('isDevSeedPaymentIntentId', () => {
  it('matches pi_seed_dev_ prefix in non-production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      assert.equal(isDevSeedPaymentIntentId('pi_seed_dev_pending_for_accept_99'), true);
      assert.equal(isDevSeedPaymentIntentId('pi_real_abc'), false);
      assert.equal(isDevSeedPaymentIntentId(null), false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('never matches in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.equal(isDevSeedPaymentIntentId('pi_seed_dev_pending_for_accept_99'), false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
