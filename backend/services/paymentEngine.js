/**
 * Canonical payment math — single source of truth for fees, splits, cents, and payout/refund proportions.
 * Side-effecting Stripe/DB code stays in `paymentService.js`; all pure money logic belongs here.
 */

import {
  PLATFORM_FEE_PERCENT,
  COACH_COMMISSION_PERCENT,
  MIN_CHARGE_USD,
} from './paymentConstants.js';

// ---------------------------------------------------------------------------
// Normalization & cents
// ---------------------------------------------------------------------------

/**
 * Integer cents from decimal dollars string/number.
 * Uses Math.round(n * 100) so float edge cases (e.g. 12.34 * 100) land on whole cents before Stripe.
 */
export const dollarsToCents = (value) => {
  const n = Number.parseFloat(String(value ?? '0'), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

/** DECIMAL(12,2) / API-safe string from integer cents (avoids float artifacts). */
export const centsToDecimalString = (cents) => {
  const c = Math.max(0, Math.round(cents));
  const whole = Math.floor(c / 100);
  const frac = c % 100;
  return `${whole}.${String(frac).padStart(2, '0')}`;
};

/** Stripe amounts are integer currency units (cents for USD). */
export const normalizeStripeCurrencyCents = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * Minimum lesson price (USD) — student is charged the listed lesson price only,
 * so lesson must meet Stripe MIN_CHARGE_USD by itself.
 */
export const minLessonPriceUsd = () => MIN_CHARGE_USD;

/** Exported for Joi validation (`config/validation.js`). */
export const MIN_LESSON_PRICE_USD = minLessonPriceUsd();

// ---------------------------------------------------------------------------
// Initial charge breakdown (capture-time payment row)
// ---------------------------------------------------------------------------

/**
 * Deterministic lesson → student charge, platform commission, coach expected payout.
 *
 * Pricing model (MVP):
 * - Student pays exactly the listed lesson price (no add-on fee).
 * - Platform retains PLATFORM_FEE_PERCENT of the lesson (internal commission).
 * - Coach receives COACH_COMMISSION_PERCENT of the lesson.
 * - Platform absorbs Stripe processing fees from its commission.
 *
 * Uses integer-cent intermediates so DB DECIMAL fields stay stable vs float-only math.
 */
export const calculatePaymentAmounts = (lessonPrice) => {
  const lessonCents = dollarsToCents(lessonPrice);
  const platformFeeCents = Math.round((lessonCents * PLATFORM_FEE_PERCENT) / 100);
  const totalChargeCents = lessonCents;
  const coachPayoutCents = Math.round((lessonCents * COACH_COMMISSION_PERCENT) / 100);

  return {
    lesson_price: Number.parseFloat(centsToDecimalString(lessonCents)),
    platform_fee_percent: PLATFORM_FEE_PERCENT,
    platform_fee_amount: Number.parseFloat(centsToDecimalString(platformFeeCents)),
    total_charge_to_student: Number.parseFloat(centsToDecimalString(totalChargeCents)),
    coach_payout_expected: Number.parseFloat(centsToDecimalString(coachPayoutCents)),
  };
};

/**
 * Rebuild payment snapshot from the Stripe-authorized total (integer cents).
 * Trusts the authorized amount as total_charge_to_student (= listed lesson price)
 * so confirm cannot drift if lesson.price changes between intent and confirm.
 * Platform fee / coach payout are derived from that authorized lesson total.
 */
export const calculatePaymentAmountsFromAuthorizedTotalCents = (totalChargeCents) => {
  const t = Math.max(0, Math.round(Number(totalChargeCents) || 0));
  // Authorized total IS the lesson price (student is not charged an add-on fee).
  const lessonCents = t;
  const platformFeeCents = Math.round((lessonCents * PLATFORM_FEE_PERCENT) / 100);
  const coachPayoutCents = Math.round((lessonCents * COACH_COMMISSION_PERCENT) / 100);

  return {
    lesson_price: Number.parseFloat(centsToDecimalString(lessonCents)),
    platform_fee_percent: PLATFORM_FEE_PERCENT,
    platform_fee_amount: Number.parseFloat(centsToDecimalString(platformFeeCents)),
    total_charge_to_student: Number.parseFloat(centsToDecimalString(t)),
    coach_payout_expected: Number.parseFloat(centsToDecimalString(coachPayoutCents)),
  };
};

// ---------------------------------------------------------------------------
// Cancellation / refund policy (whole cents)
// ---------------------------------------------------------------------------

/**
 * Policy total for cancellations: `payment.total_charge_to_student` when a payment row exists;
 * otherwise `booking.price` (never charged / no payment row).
 */
export const parseTotalChargeCentsFromBooking = (payment, booking) => {
  if (payment) {
    const fromPayment = dollarsToCents(payment.total_charge_to_student);
    if (fromPayment > 0) return fromPayment;
  }
  if (booking) {
    return dollarsToCents(booking.price);
  }
  return 0;
};

/**
 * Split cancellation into refund vs penalty in whole cents; invariant refundCents + penaltyCents === totalChargeCents.
 */
export const computeCancellationSplitCents = ({ totalChargeCents, isLateCancel, cancelledBy }) => {
  const t = Math.round(totalChargeCents);
  if (t < 1) {
    return { refundCents: 0, penaltyCents: 0, penaltyReason: null };
  }

  if (isLateCancel && cancelledBy === 'student') {
    const refundCents = Math.floor(t / 2);
    const penaltyCents = t - refundCents;
    return { refundCents, penaltyCents, penaltyReason: 'Late cancellation' };
  }

  if (cancelledBy === 'coach') {
    return { refundCents: t, penaltyCents: 0, penaltyReason: 'Coach cancellation' };
  }

  return { refundCents: t, penaltyCents: 0, penaltyReason: null };
};

/**
 * Cap policy refund by Stripe remaining balance; invariant refundCents + penaltyCents === totalChargeCents.
 */
export const applyStripeRefundCap = ({ policyRefundCents, totalChargeCents, remainingCents }) => {
  const t = Math.round(totalChargeCents);
  const r = Math.max(0, Math.round(remainingCents));
  const policy = Math.min(Math.max(0, Math.round(policyRefundCents)), t);
  const refundCents = Math.min(policy, r);
  const penaltyCents = t - refundCents;
  return { refundCents, penaltyCents, capped: refundCents < policy };
};

// ---------------------------------------------------------------------------
// Coach vs platform split on PickleCoach "net retained" (gross − refunds only)
// ---------------------------------------------------------------------------
// "net retained" here is NOT Stripe Dashboard "Net amount" (which also subtracts
// Stripe processing fees). Platform absorbs processing fees under MVP policy.
// ---------------------------------------------------------------------------

export const computeCoachShareRatio = (totalChargeCents, coachPayoutExpectedCents) => {
  const tt = Math.max(0, Math.round(totalChargeCents));
  if (tt < 1) return 0;
  return Math.max(0, Math.round(coachPayoutExpectedCents)) / tt;
};

/**
 * Split PickleCoach net retained (gross charge − refunds, before Stripe fees)
 * into coach vs platform using the same ratio as at capture:
 * coachPortion = round(net * coachShare), capped to net; platform = net - coach (remainder absorbs rounding).
 */
export const splitNetRetainedCoachPlatformCents = ({
  netRetainedCents,
  totalChargeCents,
  coachPayoutExpectedCents,
}) => {
  const net = Math.max(0, Math.round(netRetainedCents));
  const tt = Math.max(0, Math.round(totalChargeCents));
  const coachOrig = Math.max(0, Math.round(coachPayoutExpectedCents));
  const share = computeCoachShareRatio(tt, coachOrig);
  let coachPayoutCents = Math.round(net * share);
  coachPayoutCents = Math.min(net, Math.max(0, coachPayoutCents));
  const platformFeeCents = net - coachPayoutCents;
  return {
    coachPayoutCents,
    platformFeeCents,
    coachShareRatio: share,
  };
};

/** Coach payout at full capture, derived from persisted lesson_price (stable after partial-refund mirror). */
export const resolveCaptureCoachPayoutCents = (lessonPrice) =>
  dollarsToCents(calculatePaymentAmounts(Number(lessonPrice)).coach_payout_expected);

/**
 * Coach escrow transfer from persisted payment fields after refunds.
 * Net retained = `total_charge_to_student` − `refunded_amount` (Stripe-mirrored actuals).
 * `lesson_price` supplies the capture-time coach/total ratio only — never the payout amount when refunded > 0.
 */
export const computeCoachEscrowPayoutFromPaymentSnapshot = ({
  totalChargeToStudent,
  refundedAmount,
  lessonPrice,
}) => {
  const totalChargeCents = dollarsToCents(totalChargeToStudent);
  const refundedCents = dollarsToCents(refundedAmount);
  const captureCoachPayoutCents = resolveCaptureCoachPayoutCents(lessonPrice);
  return computeEscrowCoachTransferCents({
    totalChargeCents,
    refundedCents,
    coachPayoutExpectedCents: captureCoachPayoutCents,
  });
};

/** Escrow payout to coach (whole cents) before Stripe transfer — same ratio as `splitNetRetainedCoachPlatformCents`. */
export const computeEscrowCoachTransferCents = ({
  totalChargeCents,
  refundedCents,
  coachPayoutExpectedCents,
}) => {
  const total = Math.max(0, Math.round(totalChargeCents));
  const refunded = Math.max(0, Math.round(refundedCents));
  const netRetainedCents = Math.max(0, total - refunded);
  const { coachPayoutCents, coachShareRatio } = splitNetRetainedCoachPlatformCents({
    netRetainedCents,
    totalChargeCents: total,
    coachPayoutExpectedCents,
  });
  return { payoutCents: coachPayoutCents, netRetainedCents, coachShareRatio };
};

/** Remaining refundable balance on a Stripe Charge (cents). */
export const remainingRefundableOnChargeCents = (chargeAmountCents, amountRefundedCents) => {
  const gross = normalizeStripeCurrencyCents(chargeAmountCents);
  const refunded = Math.max(0, normalizeStripeCurrencyCents(amountRefundedCents));
  return Math.max(0, gross - refunded);
};

// ---------------------------------------------------------------------------
// Reconciliation helpers
// ---------------------------------------------------------------------------

/** True if two cent amounts match within tolerance (Stripe vs local float noise). */
export const centsNearEqual = (a, b, toleranceCents = 1) =>
  Math.abs(Math.round(a) - Math.round(b)) <= toleranceCents;
