/**
 * Authorize-first booking flow — unit tests (no DB, no Stripe).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BOOKING_INTENT_FLOW_METADATA,
  SLOT_NO_LONGER_AVAILABLE_CODE,
  buildBookingIntentStripeMetadata,
  isAuthorizeThenBookIntent,
  isPaymentIntentAuthorizedForBookingConfirm,
  parseBookingIntentMetadata,
} from '../utils/bookingIntentContract.js';
import { affectsReliability } from '../services/reliabilityPenaltyService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bookingControllerSrc = readFileSync(
  join(__dirname, '../controllers/bookingController.js'),
  'utf8',
);
const bookingIntentServiceSrc = readFileSync(
  join(__dirname, '../services/bookingIntentService.js'),
  'utf8',
);
const workersSrc = readFileSync(join(__dirname, '../workers/index.js'), 'utf8');
const paymentAuthServiceSrc = readFileSync(
  join(__dirname, '../services/paymentAuthorizationService.js'),
  'utf8',
);

describe('booking intent metadata contract', () => {
  const scheduledAt = new Date('2026-07-01T15:00:00.000Z');

  it('builds Stripe metadata with authorize_then_book flow', () => {
    const meta = buildBookingIntentStripeMetadata({
      studentId: 5,
      lessonId: 12,
      coachId: 3,
      scheduledAt,
      durationMinutes: 60,
      courtLocationId: 9,
      idempotencyKey: 'idem_abc',
      paymentMethod: 'stripe',
    });
    assert.equal(meta.flow, BOOKING_INTENT_FLOW_METADATA);
    assert.equal(meta.student_id, '5');
    assert.equal(meta.lesson_id, '12');
    assert.equal(meta.court_location_id, '9');
    assert.equal(meta.player_ids, undefined);
    assert.equal(isAuthorizeThenBookIntent(meta), true);
  });

  it('parses valid metadata for owning student', () => {
    const parsed = parseBookingIntentMetadata(
      {
        flow: BOOKING_INTENT_FLOW_METADATA,
        student_id: '5',
        lesson_id: '12',
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: '60',
        court_location_id: '9',
        // Legacy metadata may still contain player_ids; ignored
        player_ids: '[1,2]',
        idempotency_key: 'idem_abc',
        payment_method: 'stripe',
      },
      5,
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.lessonId, 12);
    assert.equal(parsed.courtLocationId, 9);
    assert.equal(parsed.playerIds, undefined);
    assert.equal(parsed.idempotencyKey, 'idem_abc');
  });

  it('rejects metadata missing court_location_id', () => {
    const parsed = parseBookingIntentMetadata(
      {
        flow: BOOKING_INTENT_FLOW_METADATA,
        student_id: '5',
        lesson_id: '12',
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: '60',
      },
      5,
    );
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, 'payment_intent_invalid_metadata');
  });

  it('rejects wrong student ownership', () => {
    const parsed = parseBookingIntentMetadata(
      {
        flow: BOOKING_INTENT_FLOW_METADATA,
        student_id: '99',
        lesson_id: '1',
        scheduled_at: scheduledAt.toISOString(),
        court_location_id: '9',
      },
      5,
    );
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, 'payment_intent_not_owned');
  });

  it('rejects non-booking-intent PaymentIntents', () => {
    const parsed = parseBookingIntentMetadata({ flow: 'other' }, 5);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, 'payment_intent_invalid_flow');
  });
});

describe('authorization gate for confirm', () => {
  it('accepts requires_capture with positive amount_capturable', () => {
    assert.equal(
      isPaymentIntentAuthorizedForBookingConfirm({
        id: 'pi_1',
        status: 'requires_capture',
        amount_capturable: 5400,
      }),
      true,
    );
  });

  it('rejects requires_payment_method (failed / not authorized)', () => {
    assert.equal(
      isPaymentIntentAuthorizedForBookingConfirm({
        id: 'pi_1',
        status: 'requires_payment_method',
        amount_capturable: 0,
      }),
      false,
    );
  });

  it('rejects canceled PaymentIntent (expired authorization)', () => {
    assert.equal(
      isPaymentIntentAuthorizedForBookingConfirm({
        id: 'pi_1',
        status: 'canceled',
        amount_capturable: 0,
      }),
      false,
    );
  });
});

describe('confirm service wiring', () => {
  it('exposes amount in USD dollars and amount_cents for Stripe', () => {
    const createIntentSection = bookingIntentServiceSrc.slice(
      bookingIntentServiceSrc.indexOf('export async function createBookingIntent'),
      bookingIntentServiceSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
    );
    assert.match(createIntentSection, /amount: totalCharge/);
    assert.match(createIntentSection, /amount_cents: dollarsToCents\(totalCharge\)/);
    assert.match(createIntentSection, /currency: 'usd'/);
  });

  it('creates payment as authorized immediately', () => {
    assert.match(bookingIntentServiceSrc, /payment_status: 'authorized'/);
    assert.match(bookingIntentServiceSrc, /flow: 'authorize_then_book'/);
  });

  it('marks coach notify claimed on confirm so webhook cannot double-send', () => {
    assert.match(bookingIntentServiceSrc, /COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY/);
    const confirmSection = bookingIntentServiceSrc.slice(
      bookingIntentServiceSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
      bookingIntentServiceSrc.length,
    );
    assert.match(confirmSection, /\[COACH_BOOKING_REQUEST_NOTIFIED_METADATA_KEY\]: true/);
  });

  it('notifies coach after confirm, not at intent creation', () => {
    const createIntentSection = bookingIntentServiceSrc.slice(
      bookingIntentServiceSrc.indexOf('export async function createBookingIntent'),
      bookingIntentServiceSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
    );
    assert.doesNotMatch(createIntentSection, /notifyCoachNewBookingRequest/);
    assert.match(bookingIntentServiceSrc, /notifyCoachNewBookingRequest\(booking\.id\)/);
  });

  it('cancels PaymentIntent and returns 409 on slot conflict', () => {
    assert.match(bookingIntentServiceSrc, /cancelPaymentIntent\(paymentIntentId\)/);
    assert.match(bookingIntentServiceSrc, /err\.statusCode = 409/);
    assert.match(bookingIntentServiceSrc, /SLOT_NO_LONGER_AVAILABLE_CODE/);
  });

  it('is idempotent per payment_intent_id', () => {
    assert.match(bookingIntentServiceSrc, /where: \{ payment_intent_id: paymentIntentId \}/);
    assert.match(bookingIntentServiceSrc, /idempotentReplay: true/);
  });

  it('re-checks availability inside confirm path', () => {
    const confirmSection = bookingIntentServiceSrc.slice(
      bookingIntentServiceSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
      bookingIntentServiceSrc.length,
    );
    const availabilityCalls = confirmSection.match(/checkBookingAvailability/g) || [];
    assert.ok(availabilityCalls.length >= 1, 'confirm must re-check slot availability');
  });
});

describe('API routes and deprecation', () => {
  it('mounts POST /api/booking-intents', () => {
    const routesSrc = readFileSync(join(__dirname, '../routes/index.js'), 'utf8');
    assert.match(routesSrc, /\/booking-intents/);
    const intentRoutesSrc = readFileSync(join(__dirname, '../routes/bookingIntentRoutes.js'), 'utf8');
    assert.match(intentRoutesSrc, /bookingIntentController\.createBookingIntent/);
  });

  it('mounts POST /api/bookings/confirm before /:id', () => {
    const bookingRoutesSrc = readFileSync(join(__dirname, '../routes/bookingRoutes.js'), 'utf8');
    const confirmIdx = bookingRoutesSrc.indexOf("'/confirm'");
    const idIdx = bookingRoutesSrc.indexOf("'/:id'");
    assert.ok(confirmIdx > -1 && idIdx > confirmIdx, '/confirm must be registered before /:id');
    assert.match(bookingRoutesSrc, /confirmBookingSchema/);
  });

  it('deprecates POST /api/bookings with 410', () => {
    const createSection = bookingControllerSrc.slice(
      bookingControllerSrc.indexOf('export const createBooking'),
      bookingControllerSrc.indexOf('export const confirmBooking'),
    );
    assert.match(createSection, /410/);
    assert.match(createSection, /booking_create_deprecated_use_intent_flow/);
    assert.doesNotMatch(createSection, /Booking\.create/);
  });

  it('confirmBooking returns booking and payment payload', () => {
    const confirmSection = bookingControllerSrc.slice(
      bookingControllerSrc.indexOf('export const confirmBooking'),
      bookingControllerSrc.indexOf('const lessonHasEnded'),
    );
    assert.match(confirmSection, /confirmBookingFromPaymentIntent/);
    assert.match(confirmSection, /\{ booking: bookingData, payment: paymentData \}/);
  });
});

describe('coach acceptance timeout (marketplace liquidity)', () => {
  it('schedules coach acceptance timeout worker (not authorization timeout)', () => {
    assert.match(workersSrc, /pendingBookingExpiryWorker/);
    assert.match(workersSrc, /expireStalePendingBookings/);
    assert.match(workersSrc, /Coach acceptance timeout/);
  });

  it('expirePendingBookingNoCoachResponse voids authorized holds', () => {
    const paymentServiceSrc = readFileSync(
      join(__dirname, '../services/paymentService.js'),
      'utf8',
    );
    const section = paymentServiceSrc.slice(
      paymentServiceSrc.indexOf('export const expirePendingBookingNoCoachResponse'),
      paymentServiceSrc.indexOf('export const releaseEscrow'),
    );
    assert.match(section, /SYSTEM_EXPIRE_PENDING/);
    assert.match(section, /authorized/);
    assert.match(section, /cancelPaymentIntent/);
  });
});

describe('removed authorization-timeout concepts', () => {
  it('webhook auth handlers no-op without payment row (intent-only)', () => {
    assert.match(paymentAuthServiceSrc, /intent_only_flow/);
    assert.doesNotMatch(
      paymentAuthServiceSrc,
      /Payment not found for PaymentIntent.*retry when payment row exists/,
    );
  });
});

describe('post-confirm lifecycle (pure)', () => {
  it('pending means waiting for coach, not payment authorization', () => {
    assert.match(bookingIntentServiceSrc, /status: 'pending'/);
    assert.match(bookingIntentServiceSrc, /payment_status: 'authorized'/);
  });

  it('reliability still applies to real bookings after authorize-first', () => {
    assert.equal(affectsReliability('travel_delay'), true);
    assert.equal(affectsReliability('weather'), false);
  });

  it('race: second confirm uses idempotency or 409 slot conflict', () => {
    assert.match(bookingIntentServiceSrc, /SequelizeUniqueConstraintError/);
    assert.equal(SLOT_NO_LONGER_AVAILABLE_CODE, 'slot_no_longer_available');
  });
});
