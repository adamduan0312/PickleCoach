import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TERMINAL_BOOKING_PAYOUT_STATUSES,
  nextBookingPayoutStatusAfterReleaseEscrow,
  nextBookingPayoutStatusAfterTransferConfirmed,
} from '../utils/bookingPayoutStatus.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('booking payout_status machine', () => {
  it('treats paid and forfeited as terminal', () => {
    assert.deepEqual([...TERMINAL_BOOKING_PAYOUT_STATUSES], ['paid', 'forfeited']);
  });

  it('releaseEscrow: pending/none → processing while transfer is in flight', () => {
    assert.equal(
      nextBookingPayoutStatusAfterReleaseEscrow({
        currentPayoutStatus: 'pending',
        escrowStatus: 'pending_release',
      }),
      'processing',
    );
    assert.equal(
      nextBookingPayoutStatusAfterReleaseEscrow({
        currentPayoutStatus: 'none',
        escrowStatus: 'manual_payout_required',
      }),
      'processing',
    );
  });

  it('releaseEscrow: already-released escrow (zero-amount or webhook race) → paid', () => {
    assert.equal(
      nextBookingPayoutStatusAfterReleaseEscrow({
        currentPayoutStatus: 'pending',
        escrowStatus: 'released',
      }),
      'paid',
    );
    assert.equal(
      nextBookingPayoutStatusAfterReleaseEscrow({
        currentPayoutStatus: 'processing',
        escrowStatus: 'released',
      }),
      'paid',
    );
  });

  it('releaseEscrow: does not overwrite paid or forfeited', () => {
    assert.equal(
      nextBookingPayoutStatusAfterReleaseEscrow({
        currentPayoutStatus: 'paid',
        escrowStatus: 'pending_release',
      }),
      'paid',
    );
    assert.equal(
      nextBookingPayoutStatusAfterReleaseEscrow({
        currentPayoutStatus: 'forfeited',
        escrowStatus: 'released',
      }),
      'forfeited',
    );
  });

  it('transfer confirmed → paid except forfeited', () => {
    assert.equal(nextBookingPayoutStatusAfterTransferConfirmed('pending'), 'paid');
    assert.equal(nextBookingPayoutStatusAfterTransferConfirmed('processing'), 'paid');
    assert.equal(nextBookingPayoutStatusAfterTransferConfirmed('none'), 'paid');
    assert.equal(nextBookingPayoutStatusAfterTransferConfirmed('paid'), 'paid');
    assert.equal(nextBookingPayoutStatusAfterTransferConfirmed('forfeited'), 'forfeited');
  });
});

describe('payout_status wiring (source)', () => {
  it('webhook finalize and zero-amount path mark the booking paid', () => {
    const paymentService = readFileSync(join(root, 'services/paymentService.js'), 'utf8');
    assert.match(paymentService, /export async function markBookingPayoutPaid/);
    assert.match(paymentService, /markBookingPayoutPaid\(payment\.booking_id/);
    assert.match(paymentService, /payout_zero_after_refund[\s\S]*markBookingPayoutPaid/);
  });

  it('payoutWorker sets processing in flight and does not overwrite paid', () => {
    const worker = readFileSync(join(root, 'workers/payoutWorker.js'), 'utf8');
    assert.match(worker, /nextBookingPayoutStatusAfterReleaseEscrow/);
    assert.match(worker, /healReleasedBookingsStillProcessing/);
  });

  it('attendance lock still treats processing as finalized (in-flight transfer)', () => {
    const controller = readFileSync(join(root, 'controllers/bookingController.js'), 'utf8');
    assert.match(
      controller,
      /\['processing',\s*'paid',\s*'forfeited'\]\.includes\(String\(booking\.payout_status/,
    );
  });
});
