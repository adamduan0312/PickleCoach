# Payment system (canonical model)

## Webhook + replay contracts

Operational rules (dedupe, refund mirror, idempotency key formats, `payment_actions` typing) live in **`paymentStripeContract.js`** and are covered by **`tests/payment-stripe-contract.test.mjs`**. Refactor handlers to call these helpers so contract tests stay aligned with production.

## DB + Stripe test-double integration (optional)

For orchestration-level checks (MySQL + `setStripeTestDouble` in-memory charge/refunds, `processRefund`, `applyRefundStateFromStripeCharge`, `reconcileRefundPaymentActionsWithStripe`), run from `backend/`:

`npm run test:payment:integration`

Requires `RUN_PAYMENT_INTEGRATION=1` (set by the script), a reachable DB from `config/config.json` / env, and migrations applied. Default `npm test` does **not** run this file so CI stays green without MySQL.

## Source of truth

| Concern | Module |
|--------|--------|
| **All pure money math** (cents, fees, splits, caps, reconciliation comparisons) | `services/paymentEngine.js` |
| **Tunable constants** (fee %, min charge, reschedule fee env) | `services/paymentConstants.js` |
| **Stripe calls, DB writes, workers, webhooks** | `services/paymentService.js` |

Controllers and workers must **not** reimplement fee, refund, or payout proportions. Import from `paymentEngine.js` or use `paymentService` re-exports that delegate to the engine.

## Initial charge (lesson booking)

- **Lesson price** → integer cents via `dollarsToCents`.
- **Platform fee** = `round(lessonCents × platform_fee_percent / 100)` (default **8%** of lesson).
- **Total charge to student** = `lessonCents + platform_fee_cents`.
- **Coach payout expected** = `round(lessonCents × coach_commission_percent / 100)` (default **92%** of lesson — not of total charge).

Implemented as `calculatePaymentAmounts(lessonPrice)` in `paymentEngine.js`. Persisted on `payments` as DECIMAL fields; values are derived from cent-rounded intermediates for determinism.

## Cancellations and refund policy

- **Total charge basis**: `parseTotalChargeCentsFromBooking(payment, booking)`.
- **Split**: `computeCancellationSplitCents` (late student = half refund / half penalty; coach cancel = full refund; etc.). Invariant: `refundCents + penaltyCents === totalChargeCents`.
- **Stripe cap**: `applyStripeRefundCap` clamps refund to remaining charge balance; same invariant.

## Post-refund coach vs platform split

When mirroring Stripe refund state or computing escrow payout:

- **Coach share ratio** = `coach_payout_expected_cents / total_charge_cents` (from the payment row at capture / current stored snapshot).
- **Net retained** = charge gross cents − refunded cents (Stripe charge object for mirror; payment row fields for escrow payout path).
- **Coach portion** = `round(net × ratio)`, capped to `net`; **platform** = `net − coach` (remainder absorbs cent rounding).

Implemented as `splitNetRetainedCoachPlatformCents` and `computeEscrowCoachTransferCents` in `paymentEngine.js`. Used by `applyRefundStateFromStripeCharge` and `releaseEscrow`.

## Rounding rules

- **Money to cents**: `dollarsToCents` — `Math.round(n × 100)`.
- **Cents to DECIMAL string**: `centsToDecimalString` — non-negative, two fractional digits.
- **Stripe integers**: `normalizeStripeCurrencyCents`.
- **Reconciliation slack**: `centsNearEqual(a, b, toleranceCents = 1)` for Stripe vs local DECIMAL drift.

## Idempotency (high level)

- **Refunds**: `payment_actions` rows carry `idempotency_key` / `stripe_idempotency_key`; `processRefund` uses `SELECT … FOR UPDATE` on `payments` and skips duplicate pending when appropriate.
- **Webhooks**: `charge.refunded` and consistency checks use `applyRefundStateFromStripeCharge` so local `refunded_amount` / statuses align with Stripe.

See `payment-system-audit.md` for risks and follow-ups.
