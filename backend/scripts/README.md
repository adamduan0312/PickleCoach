# Backend scripts catalog

**First place to look** when you need a seed, reset, or helper.

| Layer | Responsibility |
| ----- | -------------- |
| [`package.json`](../package.json) `scripts` | **How** to run it (`npm run …`) |
| **This file** | **What** it does and **when** to use it |
| Script / seeder file header | **How** it behaves (flags, invariants, credentials) |
| [`POSTMAN_TESTING_GUIDE.md`](../POSTMAN_TESTING_GUIDE.md) | **Which** scripts/order for a Postman workflow |

Run all commands from `backend/` unless noted. Most seed scripts refuse non-`development` `NODE_ENV`.

---

## Which script should I run?

### Fresh local database (wipe + migrate + demo + common fixtures)
```bash
npm run db:reset:test
```
Stop the API first so `DROP DATABASE` can succeed. Faster reseed without drop: `RESET_MODE=reseed npm run db:reset:test`.

### Postman Admin / Coach / Student flows (login users)
```bash
npm run seed:test-flows
```
Users: `admin|coach|student.testflow@picklecoach.example.org` / `Test1234!Ab`

### Coach accept / decline / cancel (authorize-first)
```bash
npm run seed:test-flows
npm run seed:booking-action-tests
# after accept:
npm run dev:simulate-capture -- --booking-id=<id>
```

### Cancel policy without Stripe charges
```bash
npm run seed:test-flows
npm run seed:cancel-test-bookings
# or broader no-Payment status matrix:
npm run seed:bookings-no-charge
```

### List coaches by radius / geo
```bash
npm run seed:geosearch
# GET /coaches?lat=37.78&lng=-122.41&radius=10
```

### Frontend inbox / notifications / resolved disputes
```bash
npm run seed:all:dev
# or: seed:test-flows → seed:booking-action-tests → seed:cancel-test-bookings → seed:dev-frontend → seed:geosearch
```

### Dispute list with more open disputes
```bash
npm run seed:more-disputes
# if duplicates got messy:
npm run seed:dedupe-disputes          # dry run
npm run seed:dedupe-disputes -- --apply
```

---

## Catalog

### Database & bulk seed

| Script / seeder | Command | Purpose | Safe? |
| --------------- | ------- | ------- | ----- |
| `reset-and-seed-for-tests.mjs` | `npm run db:reset:test` | Drop DB (full mode), migrate, demo seed, then `seed:all:dev` | ⚠️ Resets DB |
| `seeders/20240101000000-demo-data.cjs` | `npm run db:seed` | Demo marketplace: coaches, courts, lessons, bookings (`@example.com`) | ⚠️ Wipes many tables / demo users |
| (undo last seed) | `npm run db:seed:undo` | Undo last Sequelize seed | ⚠️ |
| (all migrations) | `npm run db:migrate` | Apply pending migrations | ✅ schema |
| | `npm run db:migrate:undo` | Undo last migration | ⚠️ |
| `seed:all:dev` chain | `npm run seed:all:dev` | test-flows + booking-action + cancel + frontend + geosearch | ✅ additive* |

\*Each step may wipe **its own** prior fixtures; see individual headers.

### Users & Postman base fixtures

| Script | Command | Purpose | Safe? |
| ------ | ------- | ------- | ----- |
| `seed-test-flows.js` | `npm run seed:test-flows` | Admin/coach/student testflow users, coach stack, bookings/disputes for cancel & no-show paths | ✅* |
| `seed-dev-frontend-fixtures.js` | `npm run seed:dev-frontend` | Notification examples + resolved disputes + payment states for UI | ✅ |
| `seed-testflow-lesson-history.js` | `npm run seed:testflow-lesson-history` | Extra lessons + soft-deleted lesson still nested on bookings | ✅ |
| `create-first-admin.js` | `npm run seed:first-admin -- <email> <password> [name]` | Create/update an admin user | ⚠️ mutates user |
| `fix-invalid-user-emails.js` | `npm run fix:invalid-emails` | Rewrite legacy `@picklecoach.test` → `.example.org` | ✅ |
| `reset-user-password.js` | `npm run user:reset-password -- <email> <pw>` | Set password | ⚠️ |
| `set-user-role.js` | `npm run user:set-role -- <email> [coach\|student]` | Print or set coach/student role | ⚠️ |
| `test-login.js` | `npm run dev:test-login -- <email> <pw>` | Verify credentials without HTTP | ✅ read |

\*Wipes prior **testflow** rows for its emails; does not delete demo `@example.com` coach profiles by design.

### Bookings & payments (dev)

| Script | Command | Purpose | Safe? |
| ------ | ------- | ------- | ----- |
| `seed-booking-action-test-bookings.js` | `npm run seed:booking-action-tests` | `pending_for_accept` / decline / cancel with stub PIs | ✅ |
| `simulate-coach-accept-capture.js` | `npm run dev:simulate-capture -- --booking-id=N` | Finish authorize→confirm after coach accept | ✅ |
| `seed-cancel-test-bookings.js` | `npm run seed:cancel-test-bookings` | Confirmed bookings timed for cancel-policy math (no charge_id) | ✅ |
| `seed-bookings-no-charge.js` | `npm run seed:bookings-no-charge` | One booking per major status, **no Payment rows** / no Stripe | ✅ |
| `seed-bookings-various-statuses.js` | `npm run seed:bookings-statuses` | Status matrix (may include payment/dispute rows — see header) | ✅ |
| `seed-diverse-bookings.js` | `npm run seed:diverse-bookings` | Additive: lessons + bookings across demo coaches/students (keeps existing bookings) | ✅ |
| `seed-confirmed-ended-booking.js` | `npm run seed:confirmed-ended-booking` | Confirmed, lesson just ended (no-show testing) | ✅ |
| | `npm run seed:confirmed-ended-bookings` | Same with `--count=5` | ✅ |
| `seed-test-booking.js` | `npm run seed:test-booking` | Single booking for older dispute tests; prefer test-flows | ✅ |

### Disputes

| Script | Command | Purpose | Safe? |
| ------ | ------- | ------- | ----- |
| `seed-more-disputes.js` | `npm run seed:more-disputes` | Open more disputes on eligible bookings (1 per booking) | ✅ |
| `dedupe-seeded-disputes.js` | `npm run seed:dedupe-disputes` | Dry-run cleanup of multi-dispute bookings | ✅ |
| | `npm run seed:dedupe-disputes -- --apply` | Apply dedupe + reconcile booking status / reliability | ⚠️ |

### Geo / coaches search

| Script / seeder | Command | Purpose | Safe? |
| --------------- | ------- | ------- | ----- |
| `seeders/20260509200000-coach-geosearch-fixtures.cjs` | `npm run seed:geosearch` | SF Bay ladder (+ NYC/LA / negative controls) for `GET /coaches?lat&lng&radius` | ✅ additive |

Re-run after `db:seed` / demo wipe (demo clears `coach_court_locations`).

### Postman collection maintenance

| Script | Command | Purpose | Safe? |
| ------ | ------- | ------- | ----- |
| `reorganize-postman-flows.js` | `npm run postman:reorganize-flows` | Regenerate **ByFlow** from **ByType** | ✅ files only |
| `create-by-type-collection.js` | `npm run postman:collection-by-type` | Build ByType from ByFlow (prefer ByType as source) | ✅ files only |
| `add-dispute-resolve-example.mjs` | `node scripts/add-dispute-resolve-example.mjs` | Inject Resolve Dispute example into ByType | ✅ files only |

### Reliability & schema hygiene

| Script | Command | Purpose | Safe? |
| ------ | ------- | ------- | ----- |
| `recompute-reliability-all.js` | `npm run reliability:recompute:all` | Recompute all student/coach reliability rows | ⚠️ writes scores |
| `schema-drift-check.js` | `npm run schema:drift` | DB columns vs Sequelize models | ✅ read |
| `model-field-usage-check.js` | `npm run model:usage` | Static field-usage scan | ✅ read |
| `schema-map.js` | _(library)_ | Shared map for drift + usage checks | — |
| | `npm run ci:schema-check` | drift + model:usage | ✅ |

### Unit / integration tests (not seeds)

| Command | Purpose |
| ------- | ------- |
| `npm test` | Backend unit/contract suite (`node --test`) |
| `npm run test:payment:integration` | Stripe integration tests (`RUN_PAYMENT_INTEGRATION=1`) |

---

## Documentation layers (keep them separated)

1. **`package.json`** — runnable aliases only; no long descriptions.
2. **This README** — catalog + “which script for my goal?”
3. **File headers** — flags, emails, invariants, Stripe notes.
4. **`POSTMAN_TESTING_GUIDE.md`** — step order for a named flow (accept, cancel, geo, etc.).

When you add a script: wire an `npm run` name if people will use it often, add a row here, and keep a clear header on the file.
