# Database tables (current schema)

**Source of truth:** MySQL `INFORMATION_SCHEMA` after migrations are applied.  
**Verified against:** `picklecoach_development` + Sequelize models in `models/`.  
**Do not use** `SCHEMA_VERIFICATION-BEGINNING-0F-JAN-2026.md` as a live table list (historical / pre–reschedule-removal).

## Application tables

| Table | Notes |
|-------|--------|
| `audit_logs` | |
| `booking_players` | MVP typically unused (one student via `bookings.primary_student_id`) |
| `bookings` | |
| `cancellation_history` | |
| `coach_availabilities` | |
| `coach_court_locations` | |
| `coach_profiles` | |
| `conversation_reads` | Chat read cursors (`last_read_at`) |
| `conversations` | |
| `court_locations` | |
| `dispute_resolution_actions` | **Lookup** — reseed if truncated |
| `dispute_types` | **Lookup** — reseed if truncated |
| `disputes` | |
| `lessons` | |
| `message_templates` | |
| `messages` | |
| `notifications` | |
| `payment_actions` | Async **post-capture refund** queue (see below) |
| `payments` | Payment/escrow state (`authorized`, `captured`, …) |
| `payouts` | Coach Connect payout records |
| `promo_codes` | |
| `reviews` | |
| `student_feedback` | |
| `system_jobs` | |
| `user_reliability` | |
| `user_roles` | |
| `users` | |
| `webhook_logs` | |

Plus migration tracker: **`SequelizeMeta`** — **never truncate**.

### Removed / not present

- **`reschedule_history`** — dropped by migration `20260616120000-remove-reschedule-system.cjs`. There is no reschedule API (cancel + rebook).

## Payment tables (important distinction)

| Table | Role |
|-------|------|
| **`payments`** | Underlying payment state: authorize, capture, refunded amounts, escrow flags |
| **`payment_actions`** | Asynchronous **post-capture refund** work queue processed by `paymentActionWorker` (~2 min) |
| **`payouts`** | Coach payout / Connect transfer records |

**Pre-capture** cancel or coach decline: void/cancel the Stripe PaymentIntent authorization.  
→ **No** Stripe refund and **no** `payment_actions` row.

**Post-capture** money-back (late student cancel, coach cancel after capture, dispute refund, coach no-show refund, admin refund):  
→ enqueue `payment_actions` → refund worker → `stripe.refunds.create`.

**Money math:** PickleCoach “net retained” = gross charge − refunds (coach/platform split base). That is **not** Stripe Dashboard “Net amount” (which also subtracts processing fees). See [`payment-system.md`](./payment-system.md#terminology-picklecoach-net-retained-vs-stripe-net-amount).

## Safe truncate (development only)

Stops the API first. Prefer `npm run db:reset:test` (drop + migrate + seed) over manual truncate when possible.

```sql
SET FOREIGN_KEY_CHECKS = 0;

-- Transactional / child tables first
TRUNCATE TABLE payment_actions;
TRUNCATE TABLE booking_players;
TRUNCATE TABLE messages;
TRUNCATE TABLE conversation_reads;
TRUNCATE TABLE cancellation_history;
TRUNCATE TABLE reviews;
TRUNCATE TABLE student_feedback;
TRUNCATE TABLE payouts;
TRUNCATE TABLE payments;
TRUNCATE TABLE notifications;
TRUNCATE TABLE disputes;
TRUNCATE TABLE conversations;
TRUNCATE TABLE system_jobs;
TRUNCATE TABLE bookings;
TRUNCATE TABLE lessons;
TRUNCATE TABLE coach_court_locations;
TRUNCATE TABLE coach_availabilities;
TRUNCATE TABLE court_locations;
TRUNCATE TABLE coach_profiles;
TRUNCATE TABLE user_reliability;
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE webhook_logs;
TRUNCATE TABLE promo_codes;
TRUNCATE TABLE message_templates;

-- Lookup tables (will need reseed of dispute catalogs)
TRUNCATE TABLE dispute_resolution_actions;
TRUNCATE TABLE dispute_types;

TRUNCATE TABLE user_roles;
TRUNCATE TABLE users;

SET FOREIGN_KEY_CHECKS = 1;

-- DO NOT: TRUNCATE TABLE SequelizeMeta;
```

After truncating lookup tables, re-run seeds that populate `dispute_types` / `dispute_resolution_actions` (e.g. `npx sequelize-cli db:seed:all` or your usual `seed:all:dev` path), or use full `db:reset:test`.
