# Migration: Authorize First, Then Create Booking

## Summary

PickleCoach no longer creates a `bookings` row before Stripe payment authorization succeeds. Students use a two-step API flow; legacy `POST /api/bookings` is deprecated.

## New flow

| Step | Endpoint | What happens |
|------|----------|----------------|
| 1 | `POST /api/booking-intents` | Validate lesson + availability (no slot reservation). Create manual-capture Stripe PaymentIntent. Return `client_secret` + `payment_intent_id`. |
| 2 | *(client)* | Student confirms card with Stripe.js / mobile SDK. |
| 3 | `POST /api/bookings/confirm` | Verify PI is `requires_capture`. Re-check availability in a DB transaction. Create `bookings` + `payments` (`payment_status: authorized`). Notify coach. |

If the slot is taken at confirm time: PaymentIntent is cancelled, response **409** `slot_no_longer_available`, no booking row.

## Deprecated / removed

| Concept | Status |
|---------|--------|
| `POST /api/bookings` (create) | **410 Gone** — code `booking_create_deprecated_use_intent_flow` |
| Pending booking expiry worker | **Reframed** — coach acceptance timeout for **authorized** pending bookings (`COACH_ACCEPTANCE_TIMEOUT_HOURS`, default 24) |
| `PENDING_BOOKING_EXPIRY_HOURS` auto-cancel | Still runs (alias of coach acceptance timeout) |
| System cancel on **authorization** timeout (pre-auth bookings) | **Removed** — no booking row until authorization succeeds |
| Pre-authorization slot reservation | **Never existed**; availability checked at intent + confirm only |
| Webhook auto-cancel on auth failure for intent-only PI | **No-op** when no `payments` row exists |
| `payment_status: pending` / `authorization_required` on new bookings | **Not created** in new flow — bookings start as `authorized` |

## Booking status meaning (updated)

`pending` = waiting for **coach acceptance**, not waiting for payment authorization.

All bookings created via the new flow already have an authorized PaymentIntent when the row exists.

## Payment lifecycle (unchanged after booking exists)

- Manual capture on coach accept
- Late cancel / coach cancel / admin cancel financial rules unchanged
- Reliability applies only to real bookings (simpler — no unauthorized booking edge cases)

## Client migration checklist

1. Replace `POST /api/bookings` with `POST /api/booking-intents` → authorize with Stripe → `POST /api/bookings/confirm`.
2. Store `payment_intent_id` from intent response; send it to confirm.
3. Handle **409** `slot_no_longer_available` — show “slot taken”, do not retry confirm with same PI.
4. Handle **400** `payment_intent_not_authorized` — complete card authorization first.
5. Remove UI/logic for “booking pending payment authorization”.
6. Do not rely on payment-authorization timeouts — bookings are created only after authorization. **Do** expect coach acceptance timeout: unaccepted pending bookings auto-cancel after `COACH_ACCEPTANCE_TIMEOUT_HOURS` (default 24).

## Dev testing without live Stripe

```bash
npm run seed:test-flows
npm run seed:booking-action-tests
```

Creates three **pending** bookings with authorize-first payment rows and dev-only `pi_seed_dev_*` stubs (development only). **No `STRIPE_SECRET_KEY` required** for accept/decline/cancel on these bookings — the API server hydrates stub state from the `payments` row on first use (works after server restart).

| Seed label | Endpoint to test |
|------------|------------------|
| `pending_for_accept` | `PUT /api/bookings/:id/accept` then `npm run dev:simulate-capture -- --booking-id=<id>` |
| `pending_for_decline` | `PUT /api/bookings/:id/decline` |
| `pending_for_cancel` | `POST /api/bookings/:id/cancel` |

Legacy `seed:test-flows` `pending_future` has no PaymentIntent — suitable for offline cancel only, **not** accept/decline capture testing.

## API response shapes

**`POST /api/booking-intents`** (201):

```json
{
  "client_secret": "pi_..._secret_...",
  "payment_intent_id": "pi_...",
  "lesson_id": 1,
  "scheduled_at": "2026-07-01T15:00:00.000Z",
  "duration_minutes": 60,
  "amount": 54
}
```

**`POST /api/bookings/confirm`** (201 / 200 idempotent):

```json
{
  "booking": { "id": 1, "status": "pending", "...": "..." },
  "payment": { "payment_status": "authorized", "...": "..." }
}
```

## Legacy data

Existing bookings created before this migration may still have `payment_status: pending` until migrated or completed through old flows. Coach list filters may still treat legacy pending-without-payment as visible for backward compatibility.

## Files touched

- `services/bookingIntentService.js`, `utils/bookingIntentContract.js`
- `controllers/bookingIntentController.js`, `controllers/bookingController.js` (`confirmBooking`, deprecated `createBooking`)
- `routes/bookingIntentRoutes.js`, `routes/bookingRoutes.js`, `routes/index.js`
- `services/paymentAuthorizationService.js` (intent-only no-op)
- `workers/index.js` (expiry worker removed)
- Tests: `tests/booking-intent-flow.test.mjs`
- Docs: `API_ENDPOINTS.md`, Postman collections, this file
