import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { envSchema } from '../config/validation.js';

describe('production envSchema gate', () => {
  const base = {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(32),
    FRONTEND_URL: 'https://app.example.com',
    STRIPE_SECRET_KEY: 'sk_live_abc',
    STRIPE_WEBHOOK_SECRET: 'whsec_abc123456',
  };

  it('accepts a minimal valid production env', () => {
    const { error } = envSchema.validate(base);
    assert.equal(error, undefined);
  });

  it('rejects missing FRONTEND_URL in production', () => {
    const { error } = envSchema.validate({ ...base, FRONTEND_URL: undefined });
    assert.ok(error);
    assert.match(error.message, /FRONTEND_URL/);
  });

  it('rejects Stripe test secret keys in production', () => {
    const { error } = envSchema.validate({ ...base, STRIPE_SECRET_KEY: 'sk_test_abc' });
    assert.ok(error);
    assert.match(error.message, /sk_live_/);
  });

  it('rejects missing STRIPE_WEBHOOK_SECRET in production', () => {
    const { error } = envSchema.validate({ ...base, STRIPE_WEBHOOK_SECRET: undefined });
    assert.ok(error);
    assert.match(error.message, /STRIPE_WEBHOOK_SECRET/);
  });

  it('still allows development without Stripe live keys', () => {
    const { error } = envSchema.validate({
      NODE_ENV: 'development',
      JWT_SECRET: 'x'.repeat(32),
      STRIPE_SECRET_KEY: 'sk_test_abc',
    });
    assert.equal(error, undefined);
  });
});
