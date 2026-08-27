# Money-flow reference (source of truth)

**What happens to the money?** Implementation lives in [`payment-system.md`](./payment-system.md). Booking status lives in [`booking-state-machine.md`](./booking-state-machine.md). Do **not** expand this file with Stripe API calls, webhooks, columns, or worker internals.

Default split on a **$50** lesson: student is charged **$50**, coach expected **$46** (92%), platform **$4** (8% PickleCoach commission). **Stripe processing fees are a separate cost** from that 8%. They are **not** automatically returned to the platform on every refund — so a $50 charge does **not** mean the platform always nets exactly $4. Details: [`payment-system.md`](./payment-system.md) (PickleCoach net retained vs Stripe Dashboard “Net amount”).

## Invariants

1. **Authorization ≠ capture.**
2. **`escrow_status: pending`** = authorized but **not** captured. PickleCoach is not holding funds.
3. **`escrow_status: held`** = **captured** money retained by the platform pending settlement (payout or refund).
4. **Pre-capture cancellation / decline / accept-timeout = void**, not a Stripe refund.
5. **Post-capture cancellation = refund** against the original captured charge (`payment_actions` → `stripe.refunds.create`).
6. **Attendance marks do not themselves move money** (complete, student no-show, admin coach no-show).
7. **Open in-app disputes block automatic settlement** (payout and window-gated auto/admin refunds).
8. **Admin dispute resolve can move money during the post-lesson 24h window** (refunds are not on that clock). Coach payout for `completed` / `student_no_show` still waits until lesson end + 24h.
9. **Coach payout is ~92% of PickleCoach net retained** (gross charge − refunds), not 92% of Stripe Dashboard “Net amount.”
10. **The platform’s ~8% is taken from that same retained charge**, not charged separately to the student.
11. **Settlement allowed ≠ settlement completed.** The review window ending makes automatic payout/refund **eligible**. Workers and Stripe still have to run. `payout_status = paid` (or a succeeded refund) is completed settlement.
12. **Stripe processing fees ≠ the 8% commission.** Fees are a separate platform cost and are not automatically returned on every refund.

## Escrow vs a card hold

A card **authorization** is a reservation against the student’s available credit or funds. The money has **not** been transferred to PickleCoach.

Do **not** describe `pending` as “the student’s bank still has a $50 bucket we own.” Stripe has authorized the PaymentIntent; `escrow_status: pending` means **no captured money**.

A **refund** is issued **against the student’s original captured charge**. Stripe does not keep a labeled per-student cash drawer; after capture the funds are part of the **platform Stripe balance**. Conceptually the refund reverses that charge. If a Connect transfer has already succeeded (`payout_status = paid`), this app does **not** automatically reverse it; the refund may then be funded by the platform Stripe balance unless you reverse the transfer separately in Stripe.

```text
AUTHORIZE
   ↓
escrow = pending          (no captured money)
   │
   ├── decline / timeout / early cancellation (uncaptured)
   │       ↓
   │     VOID
   │       ↓
   │     escrow released (never held)
   │
   └── coach accepts
           ↓
        CAPTURE
           ↓
      escrow = held       (captured; retained pending settlement)
           ↓
      24h review window after lesson end
           │
           ├── open dispute → automatic settlement stays **blocked**
           │                 (admin resolve refund may still run)
           └── no open dispute
                  ↓
             settlement **allowed** (not yet completed)
                  ↓
             payoutWorker (~10 min) and/or refund worker (~2 min)
                  ↓
             Connect transfer + `transfer.*` webhook (if paying coach)
                  ↓
             settlement **completed** (`payout_status = paid` and/or refund succeeded)
```

| `escrow_status` | Meaning |
|-----------------|--------|
| `pending` | Authorized / uncaptured. Not platform-held funds. |
| `held` | Captured; platform retains pending payout or refund. |
| `pending_release` | Connect transfer initiated. |
| `released` | Payout completed, **or** pre-capture void finished (never captured). |
| `refunded` | Captured charge fully refunded. Partial refunds stay `held` + `partially_refunded`. |

## Two clocks (do not mix)

| Clock | Anchor | What it controls |
|-------|--------|------------------|
| **Late-cancel** | 24 hours **before `scheduled_at`** | Student cancel of a **captured** charge → 50% refund / 50% retained (then 92/8 of retained). Uncaptured pending bookings void in full (no 50/50). |
| **Financial review** | 24 hours **after lesson end** (`scheduled_at` + duration) | Automatic **payout** (`completed`, `student_no_show`), automatic **coach-no-show refund**, **admin refund endpoint**. Participant **dispute create**. |

Attendance buttons are **not** on the review clock: they may run as soon as the lesson has ended; money still waits.

**Not** on the review clock: pre-lesson capture/void/`booking_cancel_refund`; late-cancel retained coach payout (that payout is before the lesson); admin **dispute resolve** refunds; Stripe card chargebacks.

## Settlement allowed vs settlement completed

The 24-hour review window **ending does not itself settle the booking**. It only makes automatic settlement **allowed**.

```text
Lesson ends
   ↓
24-hour review window
   │
   ├── dispute → automatic settlement blocked
   │             (resolve refunds may still run)
   │
   └── no dispute
          ↓
   settlement becomes **allowed**
          ↓
   payoutWorker runs (~10 min)     [or coach-no-show refund enqueue]
          ↓
   Connect transfer (if paying coach)
          ↓
   transfer webhook
          ↓
   payout_status = paid            ← settlement **completed**
                                   (Connect transfer succeeded; not necessarily
                                    in the coach’s bank account yet)
```

Until that last step, this combination is possible:

`review window ended` + `escrow_status = held` + `payout_status != paid`

During that gap (typically **up to ~10 minutes** on a healthy box; longer if workers are down, Connect is not ready, or the transfer fails), an admin refund can still hit the **original captured charge** before the coach receives the transfer.

**Operational rule:** if you discover the student should get a refund, **do not wait for the payout worker**. Resolve an in-app dispute **during the 24-hour review window** whenever possible. Once `payout_status = paid`, this app **does not** automatically reverse the Connect transfer (transfer succeeded ≠ money already in the coach’s bank). A later refund against the original charge can become a **platform-funded** refund unless you reverse the transfer separately in Stripe.

This distinction matters if you later change `payoutWorker` timing: eligibility (`isPostLessonFinancialReviewElapsed`) and completion (`payout_status` / escrow / refund action status) must stay separate.

---

## A. Before the lesson (review clock does not apply)

| # | Situation | Movement | Against / from | Notes |
|---|-----------|----------|----------------|-------|
| A1 | Student authorizes (`POST /booking-intents` → confirm) | Card **authorization** only. **$0 captured.** | Reservation on student’s card | `escrow_status: pending` |
| A2 | Coach **accepts** | **Capture** full lesson price | Student’s PaymentIntent → platform Stripe balance, `held` | |
| A3 | Coach **declines** (still uncaptured) | **Void** PaymentIntent | Release authorization | No `payment_actions` refund |
| A4 | Coach accept **timeout** | Same as A3 | Void | Worker |
| A5 | Cancel while **uncaptured** (`pending`) | **Void 100%** | Release authorization | No 50/50, no coach payout (student, coach, or admin) |
| A6 | Student cancel **≥24h before start**, already captured | **Refund 100%** | Original captured charge | `booking_cancel_refund` |
| A7 | Student cancel **&lt;24h before start**, already captured | **Refund 50%**; retain 50% | Charge → student refund; remainder split 92/8 coach/platform | Refund worker **then** payout (not the post-lesson clock) |
| A8 | **Coach** cancel, captured, still pre-lesson | **Refund 100%** | Original captured charge | No coach payout |
| A9 | **Admin** cancel, captured, pre-lesson | **Refund 100%** even if &lt;24h | Original captured charge | No reliability hit |

If A5–A9 never captured: void, not refund.

---

## B. After lesson end — during the 24h review window

Escrow stays **held** unless an **admin dispute resolve** enqueues a refund. Open disputes block **automatic** payout and window-gated refunds.

| # | Situation | Money in this request? | If window ends with no open dispute |
|---|---------|------------------------|-------------------------------------|
| B1 | Coach marks **complete** | No | Coach payout 92% of charge |
| B2 | Coach/admin marks **student no-show** | No | Same as completed (92/8). No student refund |
| B3 | Admin marks **coach no-show** | No (`auto_refund: held_until_review`) | Full refund against captured charge; coach $0 |
| B4 | Auto-complete (still `awaiting_verification` at ~24h after end) | No until eligible | Then same as B1 |
| B5 | Student or coach **opens in-app dispute** | Holds automatic settlement | Wait for resolve (or window + no dispute if they never opened) |
| B6 | Admin **`POST /api/admin/bookings/:id/refund`** | **409** `financial_review_window_open` | Allowed after window if no open dispute |

### Dispute resolve (may run **during** the window)

Refunds: `dispute_refund_full` / `dispute_refund_partial` — issued **against the original captured charge**. Payout for `student_no_show` / `completed` still waits for the review clock.

| Resolve | Student | Coach | Platform | Notes |
|---------|---------|-------|----------|-------|
| Attendance **`student_no_show` + `no_change`** | No refund | **92%** of charge after window | 8% | Same as completed. **Not** 100% to coach |
| Attendance **`coach_no_show` + `refund_student`** | Full refund **now** | $0 | $0 of lesson (Stripe fee still platform) | |
| Attendance **`coach_no_show` + `refund_student_partial`** | Partial refund **now** | 92% of **net retained** when payable | 8% of remainder | |
| Behavior / `other` + **`no_change`** | No refund | Follows booking status (usually completed path after window) | Commission if payout | |
| Behavior + **`refund_student` / partial** | Refund **now** | $0 or 92% of remainder | 8% of remainder | |

---

## C. After the review window (no open dispute)

Normally **financially final** in the product sense: participant disputes close; automatic settlement is **allowed**. C1 / C2 / C3 are **alternative outcomes**, not sequential steps on one booking.

| # | Situation | Movement | Against / from |
|---|-----------|----------|----------------|
| C1 | `completed` or `student_no_show`, escrow still `held` | Connect payout 92% when worker runs | Captured charge on platform balance → coach; 8% platform |
| C2 | `coach_no_show`, refundable captured charge | Full refund when worker runs | Original captured charge → student. Coach is **not** paid. |
| C3 | Admin **`POST …/refund`** | Exceptional override: full or remaining partial | Original captured charge → student. **Does not** change attendance status. |
| C4 | Student/coach **create dispute** | **400** `dispute_create_financial_review_closed` | — |
| C5 | **Admin** opens/resolves a dispute | Same as B resolve table | Charge for refunds; payout only if still `held` and status is payable |

**C3 while still `held`:** student refund reduces (or zeros) what a later payout can send. That is the short post-window race above.

`payout_status = paid` means the **Connect transfer succeeded**. It does **not** necessarily mean the funds have reached the coach’s bank.

```text
Student $50
    ↓
Platform Stripe balance
    ↓ $46 Connect transfer
Coach connected Stripe balance
    ↓
Coach bank
```

**C3 after `payout_status = paid`:** the refund still targets the **original charge**. The app does **not automatically reverse the Connect transfer**. If the coach has already received the transfer, the refund may be funded by the **platform Stripe balance**; recovering the coach’s funds requires a separate Connect transfer reversal / support action.

The refund code operates on the **original $50 charge**. There is no automatic step that says “we’re refunding the student, so take $46 back from the coach.” Connect funds are **not auto-reversed** by this app; they can still be recovered **outside** the app (Stripe Dashboard / support).

### Wrong-way money (no automatic recovery flow)

There is **no automatic** transfer-reversal or “unrefund” in application code. Money can still be recovered with **exceptional/manual** Stripe or support work.

| Need | In-app automatic flow? | What actually happens |
|------|------------------------|------------------------|
| Student should be refunded, coach **not** paid yet | Yes | Dispute resolve during the window, or C3 while escrow still `held` |
| Student should be refunded, coach **already** `paid` | Refund API still runs | Charge refund; **platform Stripe balance** may fund it. Recovering the coach’s transfer is a **separate** Connect reversal / support action — not automatic |
| Coach should be paid, student **already fully refunded** | No | See below |
| Score is wrong | Reliability API only | `PUT /api/admin/users/:id/reliability` does **not** move money |

**Coach should be paid, student already fully refunded:** the original charge has no meaningful refundable/retained balance, so the normal payout flow cannot pay the coach. The app has **no automatic recovery flow**. A completed Stripe refund is **not** something the app can “unrefund”; you cannot reverse the student’s refund and automatically pull the money back from the student. Resolution requires a **new authorized charge** to the student or a **manual Connect transfer** to the coach funded by the platform/support.

---

## D. Stripe card chargeback (external)

Not the in-app review window. Booking may park in `disputed`.

| Stripe outcome | Typical money | Notes |
|----------------|---------------|--------|
| Platform **wins** | Charge remains | May leave `disputed` → `completed` |
| **Lost** / `charge_refunded` | Student credited via Stripe | Against the charge / platform Stripe balance. If the coach was already paid, platform may absorb unless reversed manually |

---

## Cheat sheet

```text
AUTHORIZE → escrow pending (no captured money)
    │
    ├── VOID (decline / timeout / uncaptured cancel) → released
    └── CAPTURE on accept → escrow held (platform Stripe balance)
            │
            ├── pre-lesson: cancel refunds / late-cancel 50/50 + coach share of remainder
            │
            └── post-lesson
                    │
                    ├── during 24h review: attendance = no money;
                    │     dispute refunds allowed on resolve;
                    │     auto payout / auto coach-no-show refund / admin refund blocked
                    │
                    └── after 24h, no open dispute:
                          settlement **allowed**, not yet completed
                          completed | student_no_show → payoutWorker → 92% coach
                          coach_no_show → refund against captured charge
```

## Who funds each outcome

| Outcome | Precise wording |
|---------|-----------------|
| Coach paid | **92% of net retained** from the captured lesson charge (same charge the student paid). |
| Student refunded | **Stripe refund against the original captured charge** (or void if never captured). |
| Platform commission | **8% of net retained** from that same charge, not a second checkout fee. |
| Stripe processing fee | **Separate from the 8% commission.** Platform expense (MVP). Not automatically returned on every refund. Do not assume a $50 lesson always nets the platform $4. See [`payment-system.md`](./payment-system.md). |
| Refund after coach already paid (`payout_status = paid`) | Refund against the **original charge**; Connect transfer is **not auto-reversed**. May be funded by **platform Stripe balance** until/unless you reverse the transfer in Stripe. |
| Coach owed after student fully refunded | **No automatic recovery.** Normal payout sees ~$0 net retained. Cannot unrefund. Needs a **new authorized charge** or a **manual Connect transfer** funded by the platform/support. |
| Coach receives 100% of lesson price | **Does not happen** on this MVP split. |
