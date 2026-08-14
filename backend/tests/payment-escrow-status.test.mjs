/**
 * Escrow hold = captured funds only (not Stripe authorization).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ESCROW_HELD,
  ESCROW_PENDING,
  ESCROW_RELEASED,
  escrowAfterSuccessfulCapture,
  escrowAfterUncapturedVoid,
  escrowForUncapturedAuthorization,
} from '../utils/paymentEscrowStatus.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('payment escrow status helpers', () => {
  it('authorization is pending, not held', () => {
    assert.equal(escrowForUncapturedAuthorization(), ESCROW_PENDING);
    assert.notEqual(escrowForUncapturedAuthorization(), ESCROW_HELD);
  });

  it('successful capture is held', () => {
    assert.equal(escrowAfterSuccessfulCapture(), ESCROW_HELD);
  });

  it('pre-capture void is released (never held)', () => {
    assert.equal(escrowAfterUncapturedVoid(), ESCROW_RELEASED);
  });
});

describe('escrow wiring (source)', () => {
  it('confirm creates authorized payments with uncaptured escrow helper', () => {
    const src = readFileSync(join(root, 'services/bookingIntentService.js'), 'utf8');
    assert.match(src, /escrowForUncapturedAuthorization\(\)/);
    assert.doesNotMatch(src, /escrow_status: 'held'/);
  });

  it('capture finalize uses held helper', () => {
    const src = readFileSync(join(root, 'services/paymentService.js'), 'utf8');
    assert.match(src, /escrowAfterSuccessfulCapture\(\)/);
    assert.match(src, /escrowForUncapturedAuthorization\(\)/);
    assert.match(src, /escrowAfterUncapturedVoid\(\)/);
  });

  it('canceled webhook releases uncaptured escrow', () => {
    const src = readFileSync(join(root, 'controllers/webhookController.js'), 'utf8');
    assert.match(src, /escrowAfterUncapturedVoid/);
    assert.match(src, /payment_intent\.canceled/);
  });
});
