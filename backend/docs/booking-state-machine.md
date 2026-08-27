# Booking state machine (`bookings.status`)

## Single module

All **allowed** lifecycle arcs and **channels** (who/what triggers them) live in:

`backend/services/bookingStateMachine.js`

Mutations should use:

- `canTransitionBookingStatus(from, to, via)` — pure validation
- `applyBookingStatusTransition(booking, { toStatus, via, patch, options })` — validate + `booking.update`
- `assertBulkBookingStatusTransition(from, to, via)` — for `Booking.update({ where: … })` workers

Attendance **source sets** and outcome validation still live in `utils/bookingAttendanceStatus.js`; the state machine calls those validators when `via` is an attendance-related channel.

## States (DB enum)

| Status | Meaning (short) |
|--------|-----------------|
| `pending` | Student requested; coach has not accepted (payment already authorized in authorize-first flow) |
| `confirmed` | Coach accepted (or payment-captured equivalent) |
| `awaiting_verification` | Lesson end passed; coach has not marked outcome |
| `completed` | Lesson treated as completed |
| `cancelled` | Pre-lesson cancel or coach decline / expiry |
| `disputed` | Stripe chargeback parking — operational warning that payment is contested (not an attendance outcome) |
| `student_no_show` | Primary student did not attend |
| `coach_no_show` | Coach did not attend |

`payout_status`, `messaging_locked`, `cancelled_*`, `attendance_finalized` are **orthogonal columns** updated in the same `update()` as `status` where the product requires it (see callers).

**`payments.escrow_status`:** `pending` = authorized/uncaptured (not a hold). `held` = captured funds only. See [`payment-system.md`](./payment-system.md).

**`payout_status`:** `none` → `pending` (complete / auto-complete / late-cancel retained revenue) → `processing` (`payoutWorker` initiated a Connect transfer) → `paid` (`transfer.*` webhook or zero-amount payout). Post-lesson `pending` does **not** mean payable yet: `payoutWorker` still waits until **lesson end + 24h** with no open dispute. After that window the booking is normally financially final; exceptional corrections may need manual Stripe work.

**`forfeited` is reserved** (natural future use: coach no-show / coach gets $0). Live runtime does **not** assign it — student no-show stays `none` until the worker pays after the 24h review window (`none` → `processing` → `paid`); coach no-show / voids / full refunds stay `none`. Attendance still locks on `processing`, `paid`, and `forfeited` if the last is ever written.

## Transition diagram (text)

```
                    ┌──────────────────────────────────────────┐
                    ▼                                          │
pending ──accept──► confirmed ──lesson end──► awaiting_verification
   │                    │                              │         │
   │ decline/          │ complete / auto-complete     │         │
   │ coach timeout/    │ student_no_show (coach)     │         │
   │ pre-lesson cancel │                              │         │
   ▼                    ▼                              ▼         │
cancelled          completed ◄────────────────────────┘         │
   │                    ▲                                        │
   │                    └────── (same post-lesson paths)        │
   │                                                              │
   └──────────────► disputed ◄── Stripe chargeback (non-terminal)│
                            │                                     │
                            └── dispute resolve / behavior release
```

## `BookingTransitionVia` (channels)

Examples (non-exhaustive; see code for full graph):

| `via` | Typical caller |
|-------|----------------|
| `payment_capture_webhook` | `paymentService.handlePaymentCapture` (pending → confirmed) |
| `coach_accept_capture` | `paymentService.capturePaymentOnCoachAccept` when Stripe capture already returned `succeeded` |
| `coach_accept_without_payment` | Coach accept with no payment row |
| `coach_accept_without_payment` | `bookingController.acceptBooking` (no payment row) |
| `coach_decline` | `cancelPaymentOnCoachDecline`, coach decline without payment |
| `system_expire_pending` | Coach acceptance timeout worker (authorized pending, no accept/decline in time) |
| `pre_lesson_cancel` | `cancelBooking` transaction |
| `worker_lesson_end_to_awaiting_verification` | `autoConfirmWorker` bulk update |
| `mark_completed` | coach complete, auto-complete worker (attendance only; payout still waits 24h after lesson end) |
| `coach_mark_student_no_show` / `admin_mark_*` | No-show routes |
| `stripe_dispute_open` | `stripeDisputeSyncService` (non-terminal chargeback) |
| `stripe_dispute_terminal` | `stripeDisputeSyncService` (terminal chargeback — release `disputed` → `completed`) |
| `dispute_resolve_attendance` | `PUT /api/disputes/:id/resolve` (attendance types) |
| `dispute_resolve_behavior_on_disputed_booking` | Resolve behavior dispute when booking was `disputed` → `completed` |
| `dispute_resolve_catchall_on_disputed_booking` | Resolve `other` dispute when booking was `disputed` → `completed` |

## Invariants

1. **Invalid arcs** throw from `applyBookingStatusTransition` (`statusCode` **400**, `code` such as `booking_transition_not_allowed` or `invalid_attendance_status_transition`).
2. **Attendance** transitions reuse `validateAttendanceOutcomeTransition` for coach/admin no-show and dispute-resolve attendance paths.
3. **Stripe `disputed`** is allowed from any status except we still exclude impossible combinations in code where not needed; `cancelled → disputed` is allowed for edge-case chargebacks.

## Removed / centralized implicit paths

Previously, `bookings.status` was updated in many places with ad-hoc `if (status === …)` guards. The following now go through the state machine (or stay intentionally narrow, see below):

| Location | Change |
|----------|--------|
| `bookingController` | complete, no-shows, accept (no payment), decline (no payment), cancel txn, admin coach no-show txn |
| `disputeController` | resolve → booking status |
| `paymentService` | capture webhook pending→confirmed, coach decline cancel, pending expiry cancel, assertStripe auto-heal |
| `autoConfirmWorker` | confirmed→awaiting bulk; per-row awaiting→completed |
| `stripeDisputeSyncService` | → `disputed` (try/catch + log on rejection) |

**Intentionally not centralized** (legacy payment path parity):

- `paymentService.handlePaymentCapture` **non–capture-on-accept** branch still uses a raw `booking.update({ status: 'confirmed', messaging_locked: false })` when the booking is not `pending`, to avoid changing long-standing webhook behavior in this pass.

`ACTIVE_DISPUTE_STATUSES` (`open`, `under_review`) is exported from `disputeStateMachine.js` and reused in booking controllers/workers for “active dispute” queries.

## Known edge cases

- Concurrent booking row changes are still guarded with `SELECT … FOR UPDATE` in cancel/coach-no-show flows; the state machine does not replace those locks.
- `attendance_finalized` is set on **every** dispute resolution (including behavior-only); see `dispute-finalization.md`.
