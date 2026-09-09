import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ensureCheckoutAttemptParams,
  getCheckoutAttemptId,
} from '../src/utils/checkoutAttempt.js';

describe('checkout attempt id', () => {
  it('reads attempt from search params', () => {
    const params = new URLSearchParams({
      lesson: '1',
      court: '2',
      at: '2026-09-10T15:00:00.000Z',
      attempt: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    assert.equal(getCheckoutAttemptId(params), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('mints attempt once and keeps it stable on ensure', () => {
    const params = new URLSearchParams({
      lesson: '1',
      court: '2',
      at: '2026-09-10T15:00:00.000Z',
    });
    const first = ensureCheckoutAttemptParams(params, () => 'fixed-attempt-id-01');
    assert.equal(first.created, true);
    assert.equal(first.attemptId, 'fixed-attempt-id-01');
    assert.equal(first.params.get('attempt'), 'fixed-attempt-id-01');

    const second = ensureCheckoutAttemptParams(first.params, () => 'should-not-run');
    assert.equal(second.created, false);
    assert.equal(second.attemptId, 'fixed-attempt-id-01');
  });

  it('does not treat short attempt values as valid', () => {
    const params = new URLSearchParams({ attempt: 'short' });
    assert.equal(getCheckoutAttemptId(params), null);
  });
});
