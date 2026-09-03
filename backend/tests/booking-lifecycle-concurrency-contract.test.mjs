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
const stripeServiceSrc = readFileSync(join(__dirname, '../services/stripeService.js'), 'utf8');
const disputeControllerSrc = readFileSync(join(__dirname, '../controllers/disputeController.js'), 'utf8');
const paymentServiceSrc = readFileSync(join(__dirname, '../services/paymentService.js'), 'utf8');
const bookingControllerSrc = readFileSync(join(__dirname, '../controllers/bookingController.js'), 'utf8');
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
    assert.match(confirmSection, /\{\s*transaction,\s*coachId:\s*lesson\.coach_id,\s*studentId\s*\}/);
  });

  it('overlap check is coach-scoped and accepts a transaction option', () => {
    assert.match(bookingServiceSrc, /coach_id:\s*coachId/);
    assert.match(bookingServiceSrc, /transaction\s*=\s*null/);
  });

  it('also checks student-scoped schedule overlap when studentId is provided', () => {
    assert.match(bookingServiceSrc, /primary_student_id:\s*studentId/);
    assert.match(bookingServiceSrc, /checkStudentScheduleConflict/);
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
    assert.match(payoutWorkerSrc, /booking_admin_refund/);
    assert.match(payoutWorkerSrc, /booking_coach_no_show_refund/);
    assert.match(payoutWorkerSrc, /refund action pending/);
  });

  it('post-lesson payout waits for the 24h review window and locks the booking', () => {
    assert.match(payoutWorkerSrc, /isPostLessonFinancialReviewElapsed/);
    assert.match(payoutWorkerSrc, /lock:\s*transaction\.LOCK\.UPDATE/);
    assert.match(paymentServiceSrc, /Post-lesson payout is blocked until 24 hours after the lesson ends/);
    assert.match(paymentServiceSrc, /Post-lesson payout is blocked while a dispute is open/);
  });

  it('refund worker and reconcilers hold window-gated refund types until the 24h clock and skip open disputes', () => {
    assert.match(paymentServiceSrc, /shouldHoldPostLessonWindowGatedRefund/);
    assert.match(paymentServiceSrc, /post_lesson_refund_held_for_review_window/);
    assert.match(paymentServiceSrc, /payment_action_reconcile_held_for_review_window/);
  });

  it('admin refund is blocked during the post-lesson review window', () => {
    const refundSection = bookingControllerSrc.slice(
      bookingControllerSrc.indexOf('export const adminRefundBooking'),
    );
    assert.match(refundSection, /shouldHoldPostLessonWindowGatedRefund/);
    assert.match(refundSection, /financial_review_window_open/);
  });

  it('participant dispute create rechecks eligibility under a booking row lock', () => {
    assert.match(disputeControllerSrc, /lock:\s*transaction\.LOCK\.UPDATE/);
    assert.match(disputeControllerSrc, /checkDisputeCreateBookingEligibility\(locked/);
  });

  it('held escrow alone is still required', () => {
    assert.equal(isPaymentEscrowPayable({ escrow_status: 'held' }), true);
  });

  it('Connect transfers are only initiated from releaseEscrow (already window + dispute gated)', () => {
    const transferCallIdx = paymentServiceSrc.indexOf('stripeService.transferToConnectedAccount');
    assert.ok(transferCallIdx > 0);
    const releaseIdx = paymentServiceSrc.indexOf('export const releaseEscrow');
    const nextExport = paymentServiceSrc.indexOf('\nexport const ', releaseIdx + 1);
    assert.ok(transferCallIdx > releaseIdx && transferCallIdx < nextExport);
  });

  it('payout worker rechecks open disputes under the booking lock before releaseEscrow', () => {
    assert.match(payoutWorkerSrc, /export async function processHeldEscrowPayment/);
    const lockIdx = payoutWorkerSrc.indexOf('lock: transaction.LOCK.UPDATE');
    const disputeIdx = payoutWorkerSrc.indexOf("payoutBlockedReason = 'open_dispute'");
    const releaseIdx = payoutWorkerSrc.indexOf('paymentService.releaseEscrow');
    assert.ok(lockIdx > 0 && disputeIdx > lockIdx && releaseIdx > disputeIdx);
  });

  it('releaseEscrow claims held escrow under a payment lock before Stripe transfer', () => {
    const releaseIdx = paymentServiceSrc.indexOf('export const releaseEscrow');
    const nextExport = paymentServiceSrc.indexOf('\nexport const ', releaseIdx + 1);
    const section = paymentServiceSrc.slice(releaseIdx, nextExport);
    assert.match(section, /lock:\s*transaction\.LOCK\.UPDATE/);
    assert.match(section, /escrow_status:\s*'pending_release'/);
    assert.match(section, /shouldParkPayoutAfterFailedAttempts/);
    assert.match(section, /manual_payout_required/);
    const claimIdx = section.indexOf("escrow_status: 'pending_release'");
    const transferIdx = section.indexOf('stripeService.transferToConnectedAccount');
    assert.ok(claimIdx > 0 && transferIdx > claimIdx, 'claim must precede Stripe transfer');
  });

  it('payout worker treats releaseEscrow skipped as non-fatal', () => {
    assert.match(payoutWorkerSrc, /releaseResult\?\.skipped/);
  });

  it('Connect transfers honor the Stripe test double so cutoff races never hit live Stripe', () => {
    assert.match(stripeServiceSrc, /stripeTestDouble\?\.transferToConnectedAccount/);
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
