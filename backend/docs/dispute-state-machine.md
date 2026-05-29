# Dispute state machine (`disputes.status`)

## Single module

`backend/services/disputeStateMachine.js`

APIs:

- `canTransitionDisputeStatus(from, to, via)`
- `applyDisputeStatusTransition(dispute, { toStatus, via, patch, options })`
- `assertInitialInAppDisputeStatus('open')` — create guard
- **`ACTIVE_DISPUTE_STATUSES`** — `['open', 'under_review']` for queries (booking guards, payout worker, etc.)

## States (DB enum)

| Status | Meaning |
|--------|---------|
| `open` | New in-app dispute or Stripe-mapped non-terminal |
| `under_review` | Stripe-mapped “needs response / under review” bucket |
| `resolved` | Admin resolved **or** Stripe terminal outcome (`won` / `lost` / `charge_refunded`) |
| `rejected` | Reserved in schema; **no application path** currently sets this (resolve always uses `resolved` + `decision`) |

## Transitions

### In-app lifecycle

```
(open | under_review) ── PUT /api/disputes/:id/resolve ──► resolved   [ADMIN_RESOLVE]
```

`POST /api/disputes` always creates **`open`** (`IN_APP_CREATE` assertion).

### Stripe chargeback mirror

`syncStripeDisputeToDatabase` uses `mapStripeDisputeStatusToLocal` then:

- **New row**: `Dispute.create({ status: localStatus, … })` (no prior `from` state).
- **Existing row**: `applyDisputeStatusTransition(..., { via: STRIPE_SYNC, patch: { stripe_dispute_status } })`.

**`STRIPE_SYNC` is intentionally permissive** (any → any valid enum) so Stripe webhook replays and status churn do not fight a rigid matrix.

### Admin resolve vs identity transition

If `from === to`:

- **`STRIPE_SYNC`**: allowed noop (patch-only updates, e.g. refresh `stripe_dispute_status`).
- **`ADMIN_RESOLVE`**: only allowed noop when **`to === 'resolved'`** (idempotent re-resolve is rare but safe).  
  **`ADMIN_RESOLVE` with `open → open` is rejected** — resolve must target `resolved`.

## Overlapping concepts (clarified)

| Field | Role |
|-------|------|
| `disputes.status` | Workflow state (`open` / `under_review` / `resolved` / `rejected`) |
| `disputes.decision` | Adjudication: `upheld` / `rejected` / `partial` |
| `disputes.outcome` | Attendance fact: `coach_no_show` / `student_no_show` (attendance types only) |
| `disputes.escalated` / `escalated_to` | **Schema only today** — no writer in services/controllers |

`decision === 'rejected'` is **not** the same as `status === 'rejected'`; the product resolves disputes to **`resolved`** with a rejected **decision**.

## Invariants

1. Admin HTTP resolve always transitions to **`resolved`** with `DisputeTransitionVia.ADMIN_RESOLVE`.
2. Stripe sync updates dispute rows without going through admin alignment (`disputeResolutionAlignment.js` is for HTTP resolve payloads).

## Booking coupling

When a Stripe dispute is **non-terminal**, the related booking may move to **`disputed`** (`BookingTransitionVia.STRIPE_DISPUTE_OPEN`).  
When an admin resolves an in-app dispute, booking updates go through `bookingStateMachine.js` (`DISPUTE_RESOLVE_*` vias).

See `booking-state-machine.md` and `dispute-finalization.md`.
