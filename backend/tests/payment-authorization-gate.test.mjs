/**
 * Payment authorization gating — unit tests (no DB, no Stripe).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  assertPaymentReadyForCoachCapture,
  COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY,
  hasAuthFailureCancellationHistory,
  isBookingTerminalForAuthFailureCancel,
  isPaymentIntentAuthorizedForManualCapture,
  isPendingBookingVisibleToCoach,
  PAYMENT_AUTH_FAILURE_CANCELLATION_NOTE,
  wasCoachBookingRequestNotified,
} from '../utils/paymentAuthorizationGate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('isPaymentIntentAuthorizedForManualCapture', () => {
  it('accepts requires_capture with positive amount_capturable', () => {
    assert.equal(
      isPaymentIntentAuthorizedForManualCapture({
        status: 'requires_capture',
        amount_capturable: 10800,
      }),
      true,
    );
  });

  it('rejects requires_payment_method', () => {
    assert.equal(
      isPaymentIntentAuthorizedForManualCapture({ status: 'requires_payment_method', amount_capturable: 0 }),
      false,
    );
  });

  it('rejects requires_capture with zero capturable', () => {
    assert.equal(
      isPaymentIntentAuthorizedForManualCapture({ status: 'requires_capture', amount_capturable: 0 }),
      false,
    );
  });
});

describe('coach pending visibility', () => {
  it('shows pending only when payment is authorized', () => {
    assert.equal(isPendingBookingVisibleToCoach('authorized'), true);
    assert.equal(isPendingBookingVisibleToCoach('pending'), false);
    assert.equal(isPendingBookingVisibleToCoach('failed'), false);
  });

  it('allows legacy pending without payment row', () => {
    assert.equal(isPendingBookingVisibleToCoach(null), true);
  });
});

describe('authorization failure cancellation idempotency helpers', () => {
  it('detects existing auth-failure cancellation history', () => {
    assert.equal(hasAuthFailureCancellationHistory([]), false);
    assert.equal(
      hasAuthFailureCancellationHistory([
        { cancelled_by: 'system', reason_notes: PAYMENT_AUTH_FAILURE_CANCELLATION_NOTE },
      ]),
      true,
    );
    assert.equal(
      hasAuthFailureCancellationHistory([{ cancelled_by: 'coach', reason_notes: 'other' }]),
      false,
    );
  });

  it('skips cancel when booking already terminal', () => {
    assert.equal(isBookingTerminalForAuthFailureCancel('cancelled'), true);
    assert.equal(isBookingTerminalForAuthFailureCancel('pending'), false);
  });
});

describe('coach notification idempotency metadata', () => {
  it('reads notified flag from payment metadata', () => {
    assert.equal(wasCoachBookingRequestNotified({}), false);
    assert.equal(
      wasCoachBookingRequestNotified({ [COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY]: true }),
      true,
    );
  });
});

describe('assertPaymentReadyForCoachCapture', () => {
  it('allows authorized + requires_capture', () => {
    assert.doesNotThrow(() =>
      assertPaymentReadyForCoachCapture('authorized', 'requires_capture'),
    );
  });

  it('blocks pending authorization', () => {
    assert.throws(
      () => assertPaymentReadyForCoachCapture('pending', 'requires_payment_method'),
      (err) => err.code === 'payment_authorization_pending',
    );
  });

  it('blocks failed payment', () => {
    assert.throws(
      () => assertPaymentReadyForCoachCapture('failed'),
      (err) => err.code === 'payment_not_authorized_for_accept',
    );
  });

  it('blocks authorized when Stripe PI is not requires_capture', () => {
    assert.throws(
      () => assertPaymentReadyForCoachCapture('authorized', 'requires_payment_method'),
      (err) => err.code === 'payment_not_authorized_for_accept',
    );
  });
});

describe('wiring contracts', () => {
  it('createBooking is deprecated in favor of intent + confirm flow', () => {
    const src = readFileSync(join(__dirname, '../controllers/bookingController.js'), 'utf8');
    const createSection = src.slice(src.indexOf('export const createBooking'), src.indexOf('export const confirmBooking'));
    assert.match(createSection, /booking_create_deprecated_use_intent_flow/);
    assert.match(src, /export const confirmBooking/);
    assert.match(src, /confirmBookingFromPaymentIntent/);
  });

  it('webhook handles amount_capturable_updated and delegates auth failure cancel', () => {
    const src = readFileSync(join(__dirname, '../controllers/webhookController.js'), 'utf8');
    assert.match(src, /payment_intent\.amount_capturable_updated/);
    assert.match(src, /handlePaymentAuthorizationSucceeded/);
    assert.match(src, /handlePaymentAuthorizationFailed/);
  });

  it('booking state machine allows pending → cancelled on auth failure', async () => {
    const { canTransitionBookingStatus, BookingTransitionVia } = await import('../services/bookingStateMachine.js');
    const r = canTransitionBookingStatus(
      'pending',
      'cancelled',
      BookingTransitionVia.PAYMENT_AUTHORIZATION_FAILED,
    );
    assert.equal(r.ok, true);
  });
});

describe('authorization flow scenarios (pure)', () => {
  it('success path: authorized pending is visible and acceptable', () => {
    assert.equal(isPendingBookingVisibleToCoach('authorized'), true);
    assert.doesNotThrow(() =>
      assertPaymentReadyForCoachCapture('authorized', 'requires_capture'),
    );
    assert.equal(wasCoachBookingRequestNotified({}), false);
  });

  it('failure path: failed payment is hidden and not acceptable', () => {
    assert.equal(isPendingBookingVisibleToCoach('failed'), false);
    assert.throws(() => assertPaymentReadyForCoachCapture('failed'));
    assert.equal(isBookingTerminalForAuthFailureCancel('cancelled'), true);
  });

  it('webhook retry: duplicate notification skipped when metadata flag set', () => {
    assert.equal(
      wasCoachBookingRequestNotified({ [COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY]: true }),
      true,
    );
  });

  it('webhook retry: duplicate cancellation skipped when history exists', () => {
    assert.equal(
      hasAuthFailureCancellationHistory([
        { cancelled_by: 'system', reason_notes: PAYMENT_AUTH_FAILURE_CANCELLATION_NOTE },
      ]),
      true,
    );
  });
});
