/**
 * Contract guards for critical booking/payment concurrency + money integrity fixes.
 * Source / pure-unit only (no DB, no Stripe).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculatePaymentAmounts,
  calculatePaymentAmountsFromAuthorizedTotalCents,
  dollarsToCents,
} from '../services/paymentEngine.js';
import { isPaymentEscrowPayable } from '../utils/payoutEscrowEligibility.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const intentSrc = readFileSync(join(__dirname, '../services/bookingIntentService.js'), 'utf8');
const bookingServiceSrc = readFileSync(join(__dirname, '../services/bookingService.js'), 'utf8');
const payoutWorkerSrc = readFileSync(join(__dirname, '../workers/payoutWorker.js'), 'utf8');
const courtControllerSrc = readFileSync(join(__dirname, '../controllers/courtController.js'), 'utf8');
const userLifecycleSrc = readFileSync(join(__dirname, '../utils/userLifecycle.js'), 'utf8');
const coachControllerSrc = readFileSync(join(__dirname, '../controllers/coachController.js'), 'utf8');

describe('confirm double-book race guards', () => {
  it('locks coach profile and rechecks availability inside the confirm transaction', () => {
    const confirmSection = intentSrc.slice(
      intentSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
    );
    assert.match(confirmSection, /CoachProfile\.findOne\(/);
    assert.match(confirmSection, /lock:\s*transaction\.LOCK\.UPDATE/);
    assert.match(confirmSection, /checkBookingAvailability\(/);
    assert.match(confirmSection, /\{\s*transaction,\s*coachId:\s*lesson\.coach_id\s*\}/);
  });

  it('overlap check is coach-scoped and accepts a transaction option', () => {
    assert.match(bookingServiceSrc, /coach_id:\s*coachId/);
    assert.match(bookingServiceSrc, /transaction\s*=\s*null/);
  });
});

describe('authorized amount snapshot at confirm', () => {
  it('does not recompute payment amounts from lesson.price at confirm', () => {
    const confirmSection = intentSrc.slice(
      intentSrc.indexOf('export async function confirmBookingFromPaymentIntent'),
    );
    assert.match(confirmSection, /calculatePaymentAmountsFromAuthorizedTotalCents/);
    assert.doesNotMatch(confirmSection, /calculatePaymentAmounts\(lesson\.price\)/);
  });

  it('snapshot total matches Stripe authorized cents even if lesson price drifted', () => {
    const intentAmounts = calculatePaymentAmounts(80);
    const authorizedCents = dollarsToCents(intentAmounts.total_charge_to_student);
    // Lesson later changed to $95 — confirm must still use authorized total.
    const drifted = calculatePaymentAmounts(95);
    assert.notEqual(
      dollarsToCents(drifted.total_charge_to_student),
      authorizedCents,
    );
    const snap = calculatePaymentAmountsFromAuthorizedTotalCents(authorizedCents);
    assert.equal(dollarsToCents(snap.total_charge_to_student), authorizedCents);
    assert.equal(dollarsToCents(snap.lesson_price), authorizedCents);
    assert.equal(
      dollarsToCents(snap.platform_fee_amount) + dollarsToCents(snap.coach_payout_expected),
      authorizedCents,
    );
  });
});

describe('payout vs dispute refund race', () => {
  it('payout worker skips pending dispute_refund_* payment actions', () => {
    assert.match(payoutWorkerSrc, /dispute_refund_full/);
    assert.match(payoutWorkerSrc, /dispute_refund_partial/);
    assert.match(payoutWorkerSrc, /dispute refund action pending/);
  });

  it('held escrow alone is still required', () => {
    assert.equal(isPaymentEscrowPayable({ escrow_status: 'held' }), true);
  });
});

describe('shared court soft-delete restore symmetry', () => {
  it('deleteCourt does not destroy coach_court_locations', () => {
    const deleteSection = courtControllerSrc.slice(
      courtControllerSrc.indexOf('export const deleteCourt'),
      courtControllerSrc.indexOf('export const createCourt'),
    );
    assert.match(deleteSection, /deleted_at:\s*new Date\(\)/);
    assert.doesNotMatch(deleteSection, /CoachCourtLocation\.destroy/);
  });
});

describe('governance-revoked coaches hidden from discovery', () => {
  it('findPublicActiveCoach checks effective roles', () => {
    assert.match(userLifecycleSrc, /getEffectiveRolesForUserRecord/);
    assert.match(userLifecycleSrc, /includes\('coach'\)/);
  });

  it('getCoaches / getCoachById filter effective coach role', () => {
    assert.match(coachControllerSrc, /getEffectiveRolesForUserRecord\(coach\)\.includes\('coach'\)/);
  });
});
