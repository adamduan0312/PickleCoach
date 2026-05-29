# Payment system audit — canonicalization phase (2026-05-21)

- **Stripe webhook + replay** — `tests/payment-stripe-contract.test.mjs` locks idempotency (`shouldStripeWebhookSkipAsDuplicate`), `charge.refunded` mirror classification, `processRefund` pending-duplicate guard, idempotency key formats, partial-refund cent sequence, and `payment_actions` reconciliation typing. `transfer.reversed` is explicitly documented as not handled yet.

## Objectives completed

1. **`paymentEngine.js`** — Single source of truth for:
   - `dollarsToCents`, `centsToDecimalString`, `normalizeStripeCurrencyCents`
   - `calculatePaymentAmounts` (deterministic cent-based fee/total/coach breakdown)
   - Cancellation split + Stripe refund cap
   - Net-retained coach/platform split + escrow payout cents
   - `remainingRefundableOnChargeCents`, `centsNearEqual`

2. **`paymentConstants.js`** — `PLATFORM_FEE_PERCENT`, `COACH_COMMISSION_PERCENT`, `MIN_CHARGE_USD`, `PAID_RESCHEDULE_FEE_USD`.

3. **`paymentStripeContract.js`** — Shared operational contracts: webhook dedupe, `charge.refunded` mirror classification (`applyRefundStateFromStripeCharge` uses this), `processRefund` pending-duplicate guard + idempotency key builders, `payment_actions` hydrate vs fixed-cents sets (reconcile worker).

4. **`paymentService.js`** — Delegates pure math to the engine and contracts to `paymentStripeContract.js`; **re-exports** engine helpers from `paymentService` for backward compatibility. `webhookController` imports webhook dedupe from the contract module.

5. **`config/validation.js`** — Imports `MIN_LESSON_PRICE_USD` from `paymentEngine.js` (avoids pulling service side-effects for Joi).

6. **Tests** — `tests/payment-engine.test.mjs` (pure money); `tests/payment-stripe-contract.test.mjs` (webhook replay, refund lifecycle, payment_actions typing).

7. **Docs** — `payment-system.md` (this folder) describes canonical flow and rounding.

## Mismatches / bugs addressed

| Issue | Resolution |
|-------|------------|
| **Webhook replay vs `applyRefundState` drift** | Dedupe + mirror classification live in `paymentStripeContract.js` and are consumed by `webhookController` / `paymentService` — contract tests prevent silent divergence. |
| **`calculatePaymentAmounts` mixed float math** | Replaced with integer-cent pipeline then DECIMAL-safe outputs; removes float-only drift vs Stripe integer amounts. |
| **Duplicate coach/platform split** | `releaseEscrow` and `applyRefundStateFromStripeCharge` shared the same ratio math; unified in `splitNetRetainedCoachPlatformCents`. |
| **`parseFloat` × 100 for local refunded amount** | `assertStripePaymentConsistency` now uses `dollarsToCents` + `centsNearEqual` vs Stripe. |
| **Inconsistent `Math.round` on Stripe fields** | Centralized as `normalizeStripeCurrencyCents` + `remainingRefundableOnChargeCents`. |

## Architectural notes

- **Stripe remains authoritative** for captured/refunded currency units; the engine expresses **policy** and **local persistence shape** in cents.
- **`payment_actions`** pipeline unchanged structurally; worker still calls `processRefund`.

## Remaining risks (not fully eliminated in this phase)

1. **End-to-end reconciliation** — No live Stripe test harness in CI; `assertStripePaymentConsistency` is runtime/heal-oriented.
2. **Concurrent paths** — Booking cancel vs dispute vs admin refund still rely on application-level guards (`getLatestBookingRefundState`); row locks exist on payment in `processRefund` but not on every multi-table path.
3. **Transfer reversal / Connect edge cases** — Not modeled in `paymentEngine`; still service-specific.
4. **Historical rows** — Payments created before this change may differ slightly in stored DECIMALs from recomputation with the new cent pipeline for edge prices; no automatic backfill was run.

## Recommended future hardening

- Add **DB-backed** tests (test DB + Stripe mock) for one full refund and one partial refund path.
- Optional **`payments` model ↔ `flattenPaymentForPersistence`** parity test once a single flatten helper exists for writes.
- Centralize **PaymentIntent amount** construction to always use `dollarsToCents(total_charge)` → Stripe `amount` to avoid float `totalCharge` in `createPaymentIntent` (currently still passes a number from DECIMAL-derived total).
