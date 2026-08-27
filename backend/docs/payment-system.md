# Payment system (canonical model)

## Persistence roles

| Table | Role |
|-------|------|
| **`payments`** | Underlying payment / escrow state (`authorized`, `captured`, refunded amounts, etc.) |
| **`payment_actions`** | Asynchronous **post-capture refund** work queue (`processPendingRefundPaymentActions`) |
| **`payouts`** | Coach Connect payout / transfer records |

**Pre-capture** cancel or coach decline voids the Stripe PaymentIntent (authorization released). That path does **not** create a `payment_actions` refund row and does not call Stripe Refunds.

## Escrow vs Stripe authorization

Do **not** call a card authorization an escrow hold. `escrow_status = held` means captured funds only.

**Scenario map** (authorize vs capture, both 24h clocks, no-shows, disputes, who the refund/payout is issued against): [`money-movement.md`](./money-movement.md).

| State | Meaning |
|-------|---------|
| `payment_status: authorized` + `escrow_status: pending` | Stripe authorized/reserved the card. **No captured money.** PickleCoach is not holding funds. |
| `payment_status: captured` + `escrow_status: held` | Capture succeeded. PickleCoach is holding the charge for later payout or refund. |
| `escrow_status: pending_release` | Connect transfer initiated; waiting for `transfer.*` webhook. |
| `escrow_status: released` | After payout: captured funds released to the coach. Also used after a **pre-capture void** (`payment_status: failed`) — there was never captured money to hold. |
| `escrow_status: refunded` | Captured charge fully refunded (Stripe refund succeeded / `charge.refunded`). Partial refunds stay `held` with `payment_status: partially_refunded`. |

Pre-capture void (decline / early cancel / expire): `pending_void` then webhook `failed`, `escrow_status: released`. No refund, no `payment_actions`, no payout. Stripe refund processing time is not the same as the student seeing the money in their bank.

**Post-capture** money returned to the student (late cancel, coach cancel after capture, dispute `refund_student` / partial, coach no-show auto-refund, admin refund) enqueues a `payment_actions` row; the refund worker executes `stripe.refunds.create` and marks the action `succeeded` or `failed`.

See also [`database-tables.md`](./database-tables.md).

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
| **Tunable constants** (fee %, min charge) | `services/paymentConstants.js` |
| **Stripe calls, DB writes, workers, webhooks** | `services/paymentService.js` |

Controllers and workers must **not** reimplement fee, refund, or payout proportions. Import from `paymentEngine.js` or use `paymentService` re-exports that delegate to the engine.

## Initial charge (lesson booking)

**Authorize-first flow (current):** `POST /api/booking-intents` creates a manual-capture PaymentIntent with no booking row. After client authorization (`requires_capture`), `POST /api/bookings/confirm` creates `bookings` + `payments` with `payment_status: authorized`. Coach accept captures funds. See `docs/MIGRATION_AUTHORIZE_FIRST_BOOKING.md`.

- **Lesson price** → integer cents via `dollarsToCents`.
- **Student charge** = lesson price exactly (no add-on fee at checkout).
- **Platform commission** = `round(lessonCents × platform_fee_percent / 100)` (default **8%** of lesson) — internal accounting only; does **not** increase what the student pays.
- **Coach payout expected** = `round(lessonCents × coach_commission_percent / 100)` (default **92%** of lesson).
- Platform absorbs Stripe processing fees from its commission (MVP).

Implemented as `calculatePaymentAmounts(lessonPrice)` in `paymentEngine.js`. Persisted on `payments` as DECIMAL fields; values are derived from cent-rounded intermediates for determinism.

| Lesson | Student pays | Coach receives | Platform commission |
|--------|--------------|----------------|---------------------|
| $50 | $50 | $46 | $4 |
| $100 | $100 | $92 | $8 |

## Terminology: PickleCoach “net retained” vs Stripe “Net amount”

**Do not confuse these.** They use different bases.

| Term | Meaning |
|------|---------|
| **PickleCoach “net retained”** | Gross charge − refunds only (`total_charge_to_student` − `refunded_amount`). Code/docs that say “net retained” mean **this**. |
| **Stripe Dashboard “Net amount”** | Stripe’s balance impact after **refunds and Stripe processing fees**. Not used as the coach/platform split base. |
| **Coach payout** | ~92% of PickleCoach net retained |
| **Platform share** | ~8% of PickleCoach net retained |
| **Stripe processing fee** | Platform expense under current MVP policy (not passed to student or coach in app math) |

**Example (C3c late cancel on a $55 lesson):**

```
$55.00  charge
−$27.50 refund
───────────
$27.50  PickleCoach "net retained"  ← split base
  Coach:    92% ≈ $25.30
  Platform:  8% ≈ $2.20

Stripe separately:
$55.00 charge − $27.50 refund − ~$1.90 processing fee ≈ $25.60 Stripe "Net amount"
```

Do **not** compare Stripe’s ~$25.60 Net to the ~$25.30 coach payout and conclude the coach should get 92% of $25.60. Student refund stays **$27.50** (no fee deducted from the refund). Record Stripe’s fee as a platform cost; C3c expectations use PickleCoach retained math only.

## Cancellations and refund policy

- **Total charge basis**: `parseTotalChargeCentsFromBooking(payment, booking)`.
- **Split**: `computeCancellationSplitCents` (late student = half refund / half penalty; coach cancel = full refund; etc.). Invariant: `refundCents + penaltyCents === totalChargeCents`.
- **Stripe cap**: `applyStripeRefundCap` clamps refund to remaining charge balance; same invariant.
- **Student late cancel (<24h) retained revenue**: After the partial refund executes on a **captured** charge, the remaining charge balance is treated as lesson revenue. **`payoutWorker`** releases escrow to the coach using the normal capture-time coach/platform ratio. **Uncaptured** authorize-only PaymentIntents (`pending`, no `charge_id`) are **voided in full** on cancel — no retained funds, no coach payout (common on **`pending`** bookings before coach accept).
- **Payout ordering (late cancel)**: Cancel → enqueue `booking_cancel_refund` → Stripe partial refund → `charge.refunded` mirror sets `payment_status: partially_refunded` and `refund_status: succeeded` → **only then** may `payoutWorker` call `releaseEscrow`. Guards block payout while a cancel refund `payment_actions` row is pending, while `refund_status === pending`, or before `partially_refunded` + succeeded.

## Post-lesson coach payout (completed lessons)

**Product rule:** Students and coaches have **24 hours after the lesson** to report a payment or lesson problem. During that period, payout is protected. After the review period closes, the booking is **normally financially final**. Exceptional post-settlement corrections may require **manual Stripe operations** (this app does not auto-claw back a Connect transfer).

Timeline is aligned with a **24-hour financial review window after lesson end** (not after Complete / no-show clicks):

1. Lesson ends → `confirmed` → `awaiting_verification` (worker, ~5 min). Coach may mark **Complete** or **student no-show** immediately; those are **attendance** only.
2. During the 24h window: escrow stays **held**. Students and coaches may open in-app disputes. Open disputes block payout. Complete does **not** release money.
3. **24h after lesson end** with no open dispute → payout becomes eligible (`completed` or `student_no_show`). `autoConfirmWorker` may also set `completed` if the coach never confirmed attendance.
4. **`payoutWorker`** (~10 min) releases escrow only when `bookings.status` is **`completed`** or **`student_no_show`**, **and** `financial_review_until` (lesson end + 24h) has passed, **and** there is no open dispute. Late-cancel `cancelled` payouts are pre-lesson and skip this clock.
5. Booking **`payout_status`**: `pending` (owed) → `processing` (Connect transfer initiated) → **`paid`**. **`forfeited` is reserved** and is not assigned by live code.

Coach **`POST .../complete`** does **not** skip the 24h wait. **`awaiting_verification` is not a payable status**. **`student_no_show` is not an immediate payout** — it uses the same 24h clock.

**`coach_no_show`:** marking attendance does **not** refund immediately. After the same 24h window with no open dispute, `payoutWorker` enqueues `booking_coach_no_show_refund`. Dispute resolve can still refund sooner via admin `financial_action`.

### What the 24h clock gates (and what it does not)

Automatic post-lesson settlement waits until **lesson end + 24h** **and** there is **no open dispute**. That includes every path that would otherwise finalize money without an in-app report:

| Path | During 24h window | After window, no open dispute |
|---|---|---|
| Connect transfer / `releaseEscrow` for `completed` or `student_no_show` | Blocked (`payoutWorker` skip + `releaseEscrow` throw) | Eligible |
| `booking_coach_no_show_refund` | Held (enqueue + refund worker + Stripe reconcile replay) | Eligible |
| `POST /api/admin/bookings/:id/refund` (`booking_admin_refund`) | **409** `financial_review_window_open`; worker/reconcile also hold if a row already exists | Eligible if no open dispute |

**Not** on this clock (by design):

- Pre-lesson capture / void / `booking_cancel_refund`
- Late-cancel retained coach payout (`cancelled`) — that payout is scheduled **before** the lesson
- Admin **dispute resolve** refunds (`dispute_refund_full` / `dispute_refund_partial`) — someone already reported; adjudication may move money during the window
- Stripe card chargebacks (external)

Open disputes also block payout and the gated auto/admin refunds. Payout and participant dispute-create both `SELECT … FOR UPDATE` the booking row so a report at 23:59:59 cannot race a payout that thinks the clock has elapsed.

**Boundary:** `window_open` is `now < review_until`; `elapsed` is `now >= review_until`. At the exact instant the window ends, participant dispute create closes and automatic settlement becomes eligible (XOR, no overlap).

## Post-refund coach vs platform split

When mirroring Stripe refund state or computing escrow payout:

- **Coach share ratio** = `coach_payout_expected_cents / total_charge_cents` (from the payment row at capture / current stored snapshot).
- **PickleCoach net retained** = charge **gross** cents − refunded cents only (payment row / Stripe charge refund fields — **not** Stripe Dashboard “Net amount” after processing fees).
- **Coach portion** = `round(net_retained × ratio)`, capped to net retained; **platform** = remainder (cent rounding).

Implemented as `splitNetRetainedCoachPlatformCents` and `computeEscrowCoachTransferCents` in `paymentEngine.js`. Used by `applyRefundStateFromStripeCharge` and `releaseEscrow`.

**Late-cancel / partial-refund payout (C3c):** `releaseEscrow` uses  
`net_retained = total_charge_to_student − refunded_amount`  
(e.g. $55 − $27.50 = **$27.50**). Transfer ≈ **$25.30** coach / **$2.20** platform. Stripe’s separate ~$1.90 processing fee and Dashboard “Net amount” (~$25.60) are **not** the split base — platform absorbs the fee.

## Rounding rules

- **Money to cents**: `dollarsToCents` — `Math.round(n × 100)`.
- **Cents to DECIMAL string**: `centsToDecimalString` — non-negative, two fractional digits.
- **Stripe integers**: `normalizeStripeCurrencyCents`.
- **Reconciliation slack**: `centsNearEqual(a, b, toleranceCents = 1)` for Stripe vs local DECIMAL drift.

## Idempotency (high level)

- **Refunds**: `payment_actions` rows carry `idempotency_key` / `stripe_idempotency_key`; `processRefund` uses `SELECT … FOR UPDATE` on `payments` and skips duplicate pending when appropriate.
- **Webhooks**: `charge.refunded` and consistency checks use `applyRefundStateFromStripeCharge` so local `refunded_amount` / statuses align with Stripe.

## Postman money scenarios (live Stripe test mode)

Faster than manual book → accept → cancel. From `backend/`:

```bash
npm run seed:postman-money
# or subset:
npm run seed:postman-money -- --only=C3b,C3c,C3d,C4
```

| Key | Fixture ready for | You only call |
|-----|-------------------|---------------|
| **C3a** | pending + authorized | coach `PUT …/decline` (void) |
| **C3b** | pending + authorized, lesson ≥24h out | student `POST …/cancel` (void; no `payment_actions`) |
| **C3c** | confirmed + captured, `scheduled_at` ~12h out | student `POST …/cancel` → half refund; then coach payout = 92% of PickleCoach net retained (gross − refund), **not** 92% of Stripe Dashboard Net |
| **C3d** | confirmed + captured | coach `POST …/cancel` (full refund → `payment_actions`) |
| **C4** | confirmed + captured, lesson ended **>24h ago** | coach `POST …/complete` then wait `payoutWorker` |
| **C5** | authorized PI (no booking), pending accept, captured cancel | double confirm / accept / cancel |

**C3c expect (example $55 lesson):** $55 charge → $27.50 student refund → **$27.50 PickleCoach net retained** → ≈ **$25.30 coach / $2.20 platform**. Separately note Stripe processing fee on the Dashboard; do not use Stripe “Net amount” as the split base. See [Terminology](#terminology-picklecoach-net-retained-vs-stripe-net-amount).

Default users: `student.testflow@picklecoach.example.org` / `coach7@example.com` (password `Test1234!Ab`). Requires `sk_test_…`, `stripe listen`, and workers.

See `payment-system-audit.md` for risks and follow-ups.
