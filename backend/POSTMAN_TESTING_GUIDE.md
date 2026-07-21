# Postman Testing Guide — PickleCoach API

**Mindset:** Don’t just “test endpoints.” **Test user flows.** If every flow works from start to finish, your system works. This guide gives you a flow-based order, a checklist, and what to verify for each request (including Stripe, Twilio, SendGrid).

**Scripts / seeds:** For *what each seed or helper does* and *which one to run*, see **[`scripts/README.md`](./scripts/README.md)** (catalog). This guide answers *testing workflow order* (e.g. accept → simulate-capture → assert confirmed). `package.json` only lists *how to invoke* (`npm run …`).

**Why two guides?** This file (backend) is only for Postman/testing. For full API reference use **backend/API_ENDPOINTS.md**; for setup→production use **backend/ACTION_ITEMS.md**. The root **PICKLECOACH_API_AND_SETUP_GUIDE.md** combines Postman + API reference + action items in one long doc—use that for a single file, or use this plus API_ENDPOINTS and ACTION_ITEMS for focused docs.

---

## 1. When to test endpoints vs. when to set up Stripe, Twilio, SendGrid

**Short answer:** Test most endpoints first **without** Stripe/Twilio/SendGrid. Then set up the three services. Then test the endpoints that depend on them (and confirm emails/SMS/webhooks).

### Phase 1 — Test without third‑party services (do this first)

You can test almost everything with just the server and database running. No Stripe, SendGrid, or Twilio keys needed yet.

| What to test | Why no third‑party yet |
|--------------|-------------------------|
| **Health** | Server/DB only. |
| **Auth** (Register, Login, Profile, Refresh, Forgot/Reset Password, Email Verification, Change Password, Add Role (self-service), Logout, Delete) | All work with DB + JWT. Forgot/Reset and verification will **fail to send email** without SendGrid, but the API should still return **200** and not 500. You can verify “email would be sent” later. |
| **Coaches** (profile, availability, courts, list coaches, get coach) | Pure DB. |
| **Courts** (CRUD) | Pure DB. |
| **Lessons** (CRUD) | Pure DB. |
| **Bookings** (get, cancel) | Pure DB. **Create Booking** is *not* in Phase 1 — see below. |
| **Reviews, Messages, Disputes, Notifications** (create/list/update) | Pure DB. |
| **Admin** (users, dashboard, audit, disputes, etc.) | Pure DB. |

**What will be limited in Phase 1:**

- **Create Booking** (`POST /api/bookings`) — **Requires Stripe.** For paid lessons, Create Booking will fail without Stripe. In Phase 1 you can still test **List My Student Bookings**, **List My Coach Bookings**, **Get My Booking by ID**, **Cancel Booking** if you have existing bookings.
- **Stripe Connect** — Needs Stripe keys until Phase 2.
- **Stripe Webhook** — Needs webhook secret + test events.
- **Real email/SMS** — API returns 200 but delivery requires SendGrid/Twilio in Phase 2. **Booking accepted/declined/cancelled** and **lesson reminders** now enqueue in-app + email notifications when SendGrid is configured.

**Phase 2 integration note:** After configuring Stripe, SendGrid, and Twilio, test these limited endpoints/flows in Postman and verify delivery in each provider dashboard.
There are currently **no dedicated SendGrid/Twilio-only API endpoints**; those providers are exercised through the auth/booking notification flows listed above.

### Set up Stripe, Twilio, and SendGrid (between Phase 1 and Phase 2)

After Phase 1 is passing:

1. Add to `.env.development`: **Stripe** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Connect URLs), **SendGrid** (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`), **Twilio** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`).
2. Stripe: run `stripe listen --forward-to localhost:4000/api/webhooks/stripe` and set `STRIPE_WEBHOOK_SECRET` from the CLI output.
3. SendGrid: verify sender email/domain.
4. Twilio: get a trial number and add it to env.

### Phase 2 — Test endpoints that use Stripe, SendGrid, Twilio

| Service | Endpoints / flows to test | What to check |
|---------|---------------------------|----------------|
| **Stripe** | **Create Booking**, **Accept/Decline**, **Cancel**, Connect, **Webhook** | Create Booking returns 201 with `payment_intent_client_secret`; accept captures; cancel refunds/voids as documented. |
| **SendGrid** | Auth email flows + **booking accepted/declined/cancelled** + **lesson reminders** | Call endpoints; check SendGrid Activity. |
| **Twilio** | No dedicated endpoint — your API sends SMS when you trigger flows that use SMS (e.g. booking reminder, 2FA). | Trigger those flows; confirm no 500; check Twilio Console → Logs for the outbound SMS. |

So: **Phase 1** = test everything that doesn’t touch Stripe (auth, coaches, courts, lessons, admin, and booking *read/cancel* if you have data). **Then** set up Stripe (and optionally SendGrid/Twilio). **Phase 2** = test **Create Booking**, Stripe Connect, webhook, and email/SMS flows. In practice, the full “student books a lesson” flow needs Stripe from the start.

### Stripe — endpoints that need Stripe to test (reference)

Use this when deciding **Phase 1** (no keys / DB-only) vs **Phase 2** (`STRIPE_SECRET_KEY`, test mode, often **`STRIPE_WEBHOOK_SECRET`** + Stripe CLI for webhooks, and **workers** running if money must actually move).

**Legend**

- **Sync Stripe** — This HTTP handler calls the Stripe API during the request (will fail or misbehave without `STRIPE_SECRET_KEY` and valid test objects when the code path runs).
- **Queued refund / PI** — Handler mainly updates DB and/or enqueues `payment_actions`; **Stripe executes later** via `processPendingRefundPaymentActions` (included in your worker schedule). You still need **`STRIPE_SECRET_KEY`** for the queued step to succeed, and a real **`charge_id` / PaymentIntent** from test mode for money to move.
- **Webhook** — Needs **`STRIPE_WEBHOOK_SECRET`** matching how events are delivered (e.g. Stripe CLI `stripe listen`).

| Method | Path | Why Stripe is required for a real test | Typical phase |
|--------|------|----------------------------------------|---------------|
| `POST` | `/api/bookings` | Creates **PaymentIntent** (paid bookings). | **Phase 2** |
| `PUT` | `/api/bookings/:id/accept` | **Captures** the PaymentIntent when the booking is pending and a payment row exists. | **Phase 2** (needs booking created with Stripe in MVP) |
| `PUT` | `/api/bookings/:id/decline` | **Cancels** the PaymentIntent for pending bookings with a payment. | **Phase 2** |
| `POST` | `/api/bookings/:id/cancel` | **Authorized/captured** flows may **cancel PI, refund charge, or read charge** — uses Stripe when there is a real `payment_intent_id` / `charge_id`. **Admin:** `POST /api/admin/bookings/:id/cancel` is the same handler. | **Phase 2** for paid-path cancel; **Phase 1** ok if you only have seed bookings **without** real Stripe IDs (e.g. `npm run seed:bookings-no-charge`). |
| `POST` | `/api/coaches/me/stripe-connect/onboard` | **Stripe Connect** AccountLink. | **Phase 2** |
| `GET` | `/api/coaches/me/stripe-connect/status` | Reads **Connect account** from Stripe. | **Phase 2** |
| `POST` | `/api/admin/bookings/:id/refund` | If `refund_amount` is **omitted**, calls **`charges.retrieve`** to size the refund; always creates a **`payment_actions`** row; Stripe refund runs in the **worker**. Needs payment with **`charge_id`**. | **Phase 2** |
| `POST` | `/api/admin/bookings/:id/coach-no-show` | May enqueue **`booking_coach_no_show_refund`** on `payment_actions` when a captured charge is refundable (otherwise skips). **Worker** performs Stripe refund. | **Phase 2** for auto-refund happy path |
| `PUT` | `/api/disputes/:id/resolve` | **`financial_action`** is **`no_change`** (or otherwise **not** `refund_student` / `refund_student_partial`). Updates dispute (+ booking status when applicable); **does not** enqueue `payment_actions` or call Stripe. | **Phase 1** |
| `PUT` | `/api/disputes/:id/resolve` | **`financial_action`** is **`refund_student`** or **`refund_student_partial`** (partial requires **`refund_amount`**). Enqueues **`payment_actions`**; **worker** runs Stripe refund (handler still does not call Stripe synchronously). Needs capturable/refundable payment row as elsewhere. | **Phase 2** |
| `POST` | `/api/webhooks/stripe` | Verifies **`Stripe-Signature`** with **`STRIPE_WEBHOOK_SECRET`**; processes events. | **Phase 2** |
| `GET` | `/api/payment-methods` | Lists methods from **Stripe Customer** when `stripe_customer_id` is set. | **Phase 2** for live Stripe data (empty/minimal without customer setup) |
| `POST` | `/api/payment-methods` | **Attaches** payment method to customer in Stripe. | **Phase 2** |
| `PUT` | `/api/payment-methods/:id/default` | Updates **default** PM on Stripe Customer. | **Phase 2** |
| `DELETE` | `/api/payment-methods/:id` | **Detaches** payment method in Stripe. | **Phase 2** |

**Not Stripe endpoints (for this guide’s meaning): read-only payment rows**

| Method | Path | Note |
|--------|------|------|
| `GET` | `/api/payments` | Reads DB only. |
| `GET` | `/api/payments/:id` | Reads DB only. |

**Register and Stripe**

| Method | Path | Note |
|--------|------|------|
| `POST` | `/api/auth/register` | **Best-effort** Stripe Customer create; **registration still returns 201** if Stripe is unset or fails. Not treated as a Phase 2 gate for “can I register?” |

**Workers (not HTTP, but required for refunds / queued actions)**

Refund-related `payment_actions` (admin refund, dispute refund, some cancels, coach-no-show auto-refund) are processed by **`processPendingRefundPaymentActions`** — ensure your **worker / cron** that runs `paymentActionWorker` (or equivalent) is enabled when testing that money actually moves in Stripe Dashboard.

---

## 2. Postman setup

### Environment variables

Create a Postman **Environment** (e.g. “PickleCoach Dev”) with:

| Variable      | Example value           | Notes |
|---------------|-------------------------|--------|
| `base_url`    | `http://localhost:4000` | Server root (used for `/health`) |
| `api_url`     | `http://localhost:4000/api` | Or `{{base_url}}/api` |
| `auth_token`  | *(set by Login/Register)* | Many requests save this automatically |
| `user_id`     | *(set by Login/Register)* | For requests that need `:id` |
| `coach_id`    | *(set after creating coach profile)* | Coach resource ID |
| `court_id`    | *(set after creating court)* | For coach courts / bookings |
| `lesson_id`   | *(set after creating lesson)* | For bookings |
| `booking_id`  | *(set after creating booking)* | For cancel, disputes, reviews |
| `payment_id`  | *(set by Get My Payments)* | For Get Payment By ID (`{{payment_id}}`) |

The collection already uses `{{base_url}}` and `{{api_url}}`. Register, Login, **Change Password**, and **Confirm Email Change** save `auth_token` and `user_id` in the **Tests** tab (new JWT from those responses replaces the variable) so you don’t have to copy-paste. Token persistence runs **before** assertions and updates **collection, environment, and globals** so `{{auth_token}}` is not stuck on an old value from another scope.

### Dev login credentials (collection variables)

**Postman defaults** use **test-flow** users (`npm run seed:test-flows` in `backend/`). All three share password **`Test1234!Ab`**:

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin.testflow@picklecoach.example.org` | `Test1234!Ab` |
| Coach | `coach.testflow@picklecoach.example.org` | `Test1234!Ab` |
| Student | `student.testflow@picklecoach.example.org` | `Test1234!Ab` |

**Demo seed** (`npm run db:seed`) alternate accounts: `coach1@example.com` / `student1@example.com` / `password123`; `admin@picklecoach.com` / `admin123`.

**Coach radius / geo search fixtures** (`npm run seed:geosearch`): additive coaches + courts around SF (and NYC/LA controls). Login as any student (e.g. test-flow student or `browse.geosearch@picklecoach.example.org` / `password123`), then `GET /coaches?lat=37.78&lng=-122.41&radius=10`. Vary `radius` (5 / 10 / 15 / 25 / 50) to see the Bay Area ladder; NYC/LA / no-court / soft-deleted-court coaches must not appear. Re-run after `db:seed` wipe (demo seed clears coach_court_locations).

If test-flow login returns **401 Invalid credentials**, run `npm run fix:invalid-emails` or `node scripts/reset-user-password.js <email> 'Test1234!Ab'`.

**Extra lessons + deleted-lesson booking history:** `npm run seed:testflow-lesson-history` (additive; requires test-flow users). Creates active lessons, bookings, and one soft-deleted lesson (`Advanced Strategy Session`) whose `deleted_at` still appears nested on booking GETs. Sample booking id is printed in the script output (`sample_deleted_lesson_booking_id`).

**If Confirm Email Change → Get Profile still 401s:** (1) Confirm must return **200** — copy the one-time token from the email into the **`email_change_token`** collection variable (or the request body) and send again; **400** means the token was invalid, expired, or already used. (2) Open **Postman Console** (bottom left) and confirm the Tests ran after Confirm. (3) After a successful Confirm, **View** → **Show Postman Console** and check the response body includes `data.token`.

### Two collection files (project root)

| File | Use for |
|------|--------|
| **PickleCoach_API_ByType.postman_collection.json** | Endpoints grouped by resource (Health Check, Authentication, Coaches, Courts, Bookings, etc.). Use for finding a specific endpoint, debugging, sharing with frontend. |
| **PickleCoach_API_ByFlow.postman_collection.json** | Endpoints grouped by user flow (Admin, Coach, Student). Use for running full journeys in order. |

Import one or both into Postman. Select your environment so `base_url` and `api_url` are set. Run **Health Check** first to confirm server and DB are up.

**Workflow:** Edit **ByType** when you add or change endpoints. Then run `npm run postman:reorganize-flows` (or `node backend/scripts/reorganize-postman-flows.js`) to regenerate **ByFlow** from ByType. The script **exits with code 1** if any `ADMIN_ORDER` / `COACH_ORDER` / `STUDENT_ORDER` tuple does not match a **folder name + request name** in By Type exactly — fix the name or the tuple; do not rely on silent skips. To rebuild ByType from ByFlow (e.g. if you only have the flow file), run `node backend/scripts/create-by-type-collection.js`.

**Rule:** One canonical Postman request per HTTP endpoint in **By Type**; multiple flows reuse the same `[Folder, Request name]` in the script (optional display name + `applyDescriptionOverride` in `reorganize-postman-flows.js` for copy only). **Do not hand-edit By Flow** — it is generated output only.

---

## 3. By Flow collection: three flow folders

The **PickleCoach API (By Flow)** collection has **only three top-level folders**. Every endpoint lives inside one of them, in the correct user-flow order. There are no separate “Authentication”, “Coaches”, “Bookings”, etc. folders — everything is in **1 – Flow: Admin**, **2 – Flow: Coach**, or **3 – Flow: Student**.

**Rule:** Each folder contains only endpoints that role is **allowed** to use (no 403). Admin cannot use Add Role (self-service) or Delete My Account; Coach cannot use List Coaches (Search) or Create Booking. There is no generic Update Booking Status endpoint.

- **1 – Flow: Admin** — 45 requests. Health → Login (admin) → Profile → Dashboard → Users → … → Notifications → Coach support (**includes `GET /coaches/:id/availability` via the same canonical Coaches request as Student, with an admin sidebar label**) → Auth extras (no Add Role (self-service) / Delete My Account) → Courts/Lessons/Disputes → Admin booking reads/overrides → Payments → Webhook.
- **2 – Flow: Coach** — 62 requests. Health → Register/Login → Profile → Coach profile → **Owner availability** (`GET/POST/PUT/DELETE …/me/availability` only) → Stripe Connect → Lessons → Bookings → …
- **3 – Flow: Student** — Health → … → **Create Booking Intent** (`POST /booking-intents`) → authorize with Stripe → **Confirm Booking** (`POST /bookings/confirm`) → …

Run the requests in each folder in order (1, 2, 3, …). After editing the **ByType** collection, regenerate ByFlow with: `node backend/scripts/reorganize-postman-flows.js`.

**Full order — 1 – Flow: Admin (45 steps):**  
Health Check → Login → Get Profile → Refresh Token → Get Dashboard Stats → Get Audit Logs → Get Alerts → Resolve Alert → Create Admin User → Get All Users (Admin) → Get User By ID (Admin) → Update User (Admin) → Update Coach Profile (Admin) → Get User Reliability (Admin) → Adjust User Reliability → Create Notification (Admin) → Get My Notifications → Get Coach Courts (Admin) → **Get Coach Availability (Admin)** (same By Type definition as Student) → Delete Coach Court (Admin) → Delete Coach Availability (Admin) → Delete User (Admin) → Register → …

**Full order — 2 – Flow: Coach (62 steps):**  
Health Check → Register → Login → Get Profile → … → Add Role (self-service) → Create Coach Profile → Update My Coach Profile → **Create Availability** → **Get My Coach Availability** → **Update My Availability** → **Delete Availability** → List/Search Courts → … (no `GET /coaches/:id/availability` — coach-only JWT gets **403** on that route.)

**Full order — 3 – Flow: Student (47 steps):**  
Health Check → Register → Login → Get Profile → … → List Coaches (Search) → Get Coach By ID → **Get Coach Courts** → **Get Coach Availability** → List/Search Courts → …

**Tip:** **Create Booking** (Student step 20) needs Stripe. For Phase 1, run Student steps 1–19 and 21+ if you have existing bookings; after setting up Stripe, run the full flow including Create Booking.

---

## 4. Testing checklist

Use this as a living checklist. Check off each line as you verify it (happy path + the 5 cases where relevant).

### Health

- [ ] Health Check — 200, `database: "connected"`

### AUTH

- [ ] Register (student) — 201, token and user returned
- [ ] Register (coach) — 201, token and user returned
- [ ] Login — 200, token and user returned
- [ ] Invalid login (wrong password) — 401
- [ ] Invalid login (unknown email) — 401
- [ ] Get Profile (with token) — 200
- [ ] Get Profile (no token) — 401
- [ ] Get Profile (expired token) — 401
- [ ] Update Profile — 200
- [ ] Refresh Token — 200, new token
- [ ] Forgot Password — 200 (same message whether email exists or not)
- [ ] Reset Password — 200 with valid token; 400 invalid/expired token
- [ ] Request Email Verification — 200
- [ ] Confirm Email Verification — 200 with valid token; 400 invalid/expired
- [ ] Change Password — 200; 400 wrong current password
- [ ] Request Email Change → Confirm Email Change — 200
- [ ] Add Role (self-service) — one of `student` | `coach` per request; additive; 200; 403 for admin
- [ ] Logout — 200; then same token → 401
- [ ] Delete My Account — 200 (soft delete); 403 for admin

### COACH

- [ ] Create Coach Profile — 201; 403 if not coach role (coach-only; admins cannot use)
- [ ] Update My Coach Profile — 200; `PUT /api/coaches/me/profile` (coach only; no `:id` in URL)
- [ ] Get Coach Courts (by coach id, no auth) — 200; lists courts where coach teaches (student flow: **3 – Flow: Student** → Get Coach Courts)
- [ ] Get Coach Availability — 200
- [ ] Create Availability — 201
- [ ] Delete Availability — 200
- [ ] Add Court to Coach — **201** (new link); **200** if already linked and body includes **`coach_notes`**; **409** if duplicate link without **`coach_notes`**
- [ ] List My Courts — 200
- [ ] Remove Court from Coach — **200**; **`DELETE /api/coaches/me/courts/{{court_id}}`** (unlink only; `court_id` from List My Courts or Create Court)
- [ ] Initiate Stripe Connect Onboarding — 200, redirect URL
- [ ] Get Stripe Connect Status — 200

### COURTS

- [ ] List/Search Courts — 200
- [ ] Get Court By ID — 200
- [ ] Create Court — 201; coach response includes `court` + `coachCourt` (auto-linked; no `coach_notes` on `coachCourt`). Optional: **`POST /api/coaches/me/courts`** same `court_id` + `coach_notes` → **200** (link notes only)

### LESSONS

- [ ] Get All Lessons — 200
  - Tip: filter by coach with `GET /api/lessons?coach_id={{coach_id}}`
- [ ] Get Lesson By ID — **200** for active (public); **404** if inactive unless owner/admin token; **404** if deleted (everyone)
- [ ] Create Lesson — 201
- [ ] Update Lesson — 200
- [ ] Delete Lesson — 200

### BOOKINGS

**MVP:** `POST /booking-intents` → Stripe authorization → `POST /bookings/confirm` (student) → `PUT /bookings/:id/accept` | `PUT /bookings/:id/decline` (**coach on that booking only**; admins get 403). Legacy `POST /bookings` returns **410**.

- [ ] **Authorize-first** — Intent creates PaymentIntent only; booking row appears after confirm when PI is `requires_capture`
- [ ] **Coach accept + messaging** — `npm run seed:booking-action-tests` → accept `pending_for_accept` → `npm run dev:simulate-capture -- --booking-id=<id>` → booking `confirmed`, messaging unlocked
- [ ] **Coach decline** — use `pending_for_decline` from `seed:booking-action-tests`
- [ ] **Pending cancel (with PI void)** — use `pending_for_cancel` from `seed:booking-action-tests`
- [ ] **Coach acceptance timeout** — With workers running, authorized pending bookings older than `COACH_ACCEPTANCE_TIMEOUT_HOURS` (default 24) are cancelled by the system, PaymentIntent voided, slot freed
- [ ] **Coach notify on create** — After Create Booking, check logs for `new_booking_request_for_coach` and coach notifications/email if SendGrid is set
- [ ] Create Booking — 201 (verified email); **requires Stripe** (PaymentIntent created in same transaction); 403 if email not verified
- [ ] Double booking blocked — same slot → 409 or 400
- [ ] List My Student Bookings (Student Dashboard) — 200 (`GET /api/students/me/bookings`; student role)
- [ ] List My Coach Bookings (Coach Dashboard) — 200 (`GET /api/coaches/me/bookings`; coach role)
- [ ] Get My Booking by ID — 200
- [ ] **Accept Booking** (coach only) — 200; confirms pending booking, captures payment; notifies student (in-app + email when SendGrid configured); use this (not PUT status) to confirm
- [ ] **Decline Booking** (coach only) — 200; body: message_to_student (required), decline_reason_code (optional enum: availability_conflict, sickness, weather, outside_service_area, lesson_not_fit, other); cancels PaymentIntent; notifies student
- [ ] Complete Booking (Coach only) — 200; use `POST /api/bookings/:id/complete`; only when lesson has ended; allowed from confirmed/awaiting_verification
- [ ] Mark Student No-Show (Coach only) — 200; use `POST /api/bookings/:id/student-no-show` ; only when lesson has ended; coach route allowed from confirmed/awaiting_verification. Records **student** did not attend and sets booking status `student_no_show`. If booking is disputed (or has open/under_review dispute), this route returns 409 and you must use `PUT /api/disputes/:id/resolve`.
- [ ] Mark Student No-Show (Admin) — 200; `POST /api/admin/bookings/:id/student-no-show` after lesson end; statuses `confirmed` or `awaiting_verification` when **no active dispute**. Optional body: `{ "notes": "optional internal note" }` for internal context only.
- [ ] Mark Coach No-Show (Admin) — 200; `POST /api/admin/bookings/:id/coach-no-show` after lesson end; statuses `confirmed`, `awaiting_verification`, or `student_no_show` when **no active dispute**. If disputed/open case exists, route returns 409 and resolution should happen via `PUT /api/disputes/:id/resolve` (final authority). Attempts automatic student refund; if response `auto_refund.status` is `skipped`, use `POST /api/admin/bookings/:id/refund` as fallback.
- [ ] Cancel Booking — 200 (Student, Coach, Admin); **only `pending` or `confirmed`** (pre-lesson). Reasons: excused (`weather`, `emergency`, `sickness`) vs unexcused (`travel_delay`, `schedule_conflict`, `forgot`, `other`). **Schedule change:** cancel then `POST /api/bookings` again (no reschedule API). Notifies other party with reason context. Use seed `npm run seed:bookings-no-charge` to test cancel without real charges.
- [ ] **Late student cancel — captured vs uncaptured** (Phase 2 + Stripe): **Confirmed** booking with captured charge → `cancellation.penalty_amount` > 0, optional `refund` block queued, coach payout after partial refund settles. **`Pending`** booking with authorize-only PI (no `charge_id`) → PI voided, `cancellation.refund_amount` / `penalty_amount` are **`0.00`**, notification `voided_authorization`, **no** coach payout.
- [ ] Past booking blocked — start time in past → 400

### PAYMENTS

- [ ] Get My Payments — 200 (saves `payment_id` from first row when present)
- [ ] **Admin flow:** Get Payment By ID (Admin) — 200 for any payment id
- [ ] **Coach / Student flow:** Get My Payment By ID — 200 only when you are `coach_id` or `student_id` on that payment; **403** otherwise

### REVIEWS

**Coach flow (`2 – Flow: Coach`)** — read-only:

- [ ] Get All Reviews — 200 (e.g. `?target_user_id={{coach_id}}` for reviews about you)

**Student flow (`3 – Flow: Student`)** — primary student on a **completed** booking:

- [ ] Get All Reviews — 200
- [ ] Create Review — 201; caller must be `primary_student_id`; coach inferred from booking (`target_user_id` not accepted); 403 if not the booking student; 403 if email not verified
- [ ] Update Review — 200 (reviewer only)
- [ ] Delete Review — 200 (reviewer only)

### MESSAGES

- [ ] Get Conversations — 200 (participant or admin)
- [ ] Create Conversation — 201 on **confirmed** booking with `messaging_locked: false`; **409** when locked (`pending`, `cancelled`, `completed`, etc.)
- [ ] Get Conversation By ID — 200; history readable when locked; `booking.messaging_locked` (not root-level)
- [ ] Send Message — 201 with `message_text` on unlocked booking; **409** when locked; **403** for non-participant
- [ ] Non-participant access — **403** on conversation read/send
- [ ] Admin — can **view** conversations; cannot send (403)

### DISPUTES

- [ ] Create Dispute — 201; students/coaches get 403 if not verified, admins are exempt on dispute-create routes; optional `notes` persisted; active `dispute_type_id`: **1** `coach_no_show_claim` (student opens), **8** `student_no_show_claim` (coach opens), **3** `misconduct`, **4** `lesson_not_completed`, **7** `other` (refunds go in notes + resolve `financial_action`, not a dispute type)
- [ ] Get All Disputes — 200
- [ ] Get Dispute By ID — 200
- [ ] Resolve Dispute — attendance claim — 200 (admin); body must include `decision` + `outcome` + `financial_action` (no `resolution_action_id`) for types **1** / **8**; e.g. `{"decision":"upheld","outcome":"coach_no_show","financial_action":"refund_student","resolution_notes":"…"}`; optional `data.resolution` in response

### NOTIFICATIONS

- [ ] Get My Notifications — 200
- [ ] Mark Notification As Read — 200
- [ ] **After Accept Booking** — student sees `booking_confirmed` notification (and email when SendGrid configured)
- [ ] **After Decline Booking** — student sees `booking_declined` notification with `decline_reason_code`, `message_to_student`, `reason_line`, and `summary`
- [ ] **After Cancel Booking** — other party sees `booking_cancelled` notification
- [ ] **Lesson reminders** — worker sends **24h** (in-app + email) and **1h** (in-app only); verify via `GET /api/notifications` or SendGrid Activity after worker runs

### ADMIN

- [ ] Get Dashboard Stats — 200; 403 non-admin
- [ ] Get Audit Logs — 200; 403 non-admin
- [ ] Get Alerts — 200; 403 non-admin
- [ ] Resolve Alert — 200; 403 non-admin
- [ ] Get All Users — 200; 403 non-admin
- [ ] Get User By ID — 200; 403 non-admin
- [ ] Update User — 200; 403 non-admin
- [ ] Update Coach Profile (Admin) — 200; `PUT /api/coaches/profile/:id` where `:id` is the coach’s **user id**; admin token only; 403 if coach/student calls this route
- [ ] Delete User — 200; 403 non-admin
- [ ] Resolve Dispute — 200; 403 non-admin; body always requires `decision` + `financial_action` (`refund_amount` required for `refund_student_partial`). For **attendance** claims: `outcome` required; **`financial_action` must match `outcome`** (coach_no_show → refund path; student_no_show → no_change), including when `decision` is `rejected` (with contradicting `outcome` per claim type). `outcome` forbidden on behavior disputes.
- [ ] Create Notification — 200/201; 403 non-admin
- [ ] Get Coach Courts (Admin) / Delete Court Globally (Admin) / Delete Coach Court (Admin) / Delete Coach Availability (Admin) — 200; 403 non-admin (`DELETE /api/courts/:id` is global soft delete; coaches unlink with `DELETE /api/coaches/me/courts/:courtId` only)
- [ ] Adjust User Reliability — `PUT /api/admin/users/:id/reliability`; body requires `new_score`; optional `role` defaults to **`coach`**. Send **`"role": "student"`** to adjust student reliability (required for student-only users). Dual-role users: call twice to set coach and student scores. Target user must have the role you select.
- [ ] No-show notes usage — Optional `notes` on both admin no-show endpoints are not required for state transition. Use for quick internal context; for contested or financially sensitive cases, open/resolve a dispute and treat `disputes.notes` + `resolution_notes` as canonical.

### WEBHOOKS

- [ ] Stripe Webhook — receive event (e.g. payment intent); verify signature and 200

---

## 5. For each endpoint: test these 5 things

For every endpoint that changes state or returns sensitive data, run:

| # | What to test | How | Expected |
|---|----------------|-----|----------|
| 1 | **Happy path** | Valid body, valid token (and role) | 200/201, correct response shape |
| 2 | **Missing required fields** | Omit one required field | 400, validation error |
| 3 | **Invalid data** | Wrong type/format (e.g. invalid email, negative price) | 400, validation error |
| 4 | **Unauthorized** | No `Authorization` header or invalid token | 401 |
| 5 | **Wrong role** | e.g. student calls admin endpoint, coach calls “list coaches” | 403 |

**Examples:**

- **POST /api/auth/register**  
  Happy: valid body → 201. Missing: no `email` → 400. Invalid: `email: "not-an-email"` → 400. Unauthorized: N/A (no auth). Wrong role: N/A.
- **GET /api/auth/profile**  
  Happy: valid token → 200. Unauthorized: no token or expired → 401. Wrong role: N/A.
- **POST /api/coaches/profile**  
  Happy: coach role + valid body → 201. Wrong role: student or admin → 403. Unauthorized: no token → 401. Coach-only; no `user_id` in body.
- **PUT /api/coaches/me/profile**  
  Happy: coach token + optional body fields → 200 (no user id in URL). No token → 401. Student without coach role → 403. Admins updating another coach’s profile use **`PUT /api/coaches/profile/:id`** with admin token.
- **POST /api/bookings**  
  Happy: student, verified email, valid body → 201. Unverified email → 403. Missing `lesson_id` → 400. No token → 401.
- **GET /api/users** (admin)  
  Happy: admin token → 200. Student token → 403. No token → 401.

You don’t need to write formal test code for all of this; running the requests in Postman and checking status + body is enough. You can add Postman **Tests** (e.g. `pm.response.to.have.status(201)`) for the happy path and then run the failure cases manually.

---

## 6. Third-party: Stripe, Twilio, SendGrid

These fit into testing as follows: **set them up after Phase 1** (see §1). Then in **Phase 2** you test the endpoints and flows that depend on them.

### Stripe

- **Full endpoint list (which routes need keys / workers):** see **§1 — *Stripe — endpoints that need Stripe to test (reference)***.
- **Setup:** `.env.development`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Connect return/refresh URLs. Use Stripe **test** keys.
- **In Postman:**
  - **Initiate Stripe Connect Onboarding** — expect 200 and a URL; open it in the browser and complete test onboarding.
  - **Get Stripe Connect Status** — expect 200 and status (e.g. `charges_enabled: true` when onboarding is done).
  - **Create Booking** — payment row + PaymentIntent are created here (no separate create-payment endpoint in MVP).
- **Webhook:** Run Stripe CLI: `stripe listen --forward-to localhost:4000/api/webhooks/stripe`. In Postman, you can’t “call” the webhook directly; trigger events from Stripe Dashboard or CLI (e.g. `stripe trigger payment_intent.succeeded`) and confirm your server returns 200 and processes the event (e.g. payment status updated).
- **What to check:** Connect onboarding completes, booking + payment flow doesn’t error, webhook receives events and responds 200.

### SendGrid (email)

- **Setup:** `.env.development`: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (verified in SendGrid).
- **No direct “SendGrid” endpoint in Postman.** Emails are sent by your API when you:
  - **Forgot Password** — check SendGrid Activity for the reset email.
  - **Request Email Verification** — check for verification email.
  - **Confirm Email Change** — check for confirmation to new address and notification to old.
  - **Booking created / reminder / cancel** — if you have reminder or notification jobs, trigger a booking and check SendGrid for the corresponding emails.
- **What to check:** No 500 from your API on these flows; emails appear in SendGrid Activity (and inbox if using a real address).

### Twilio (SMS)

- **Setup:** `.env.development`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
- **No direct “Twilio” endpoint in Postman.** SMS is sent by your backend when you trigger flows that send SMS (e.g. booking reminder, 2FA, or notifications with SMS channel).
- **What to do:** Trigger those flows (e.g. create booking, schedule reminder job, or hit an endpoint that sends an SMS). Check Twilio Console → Logs for the outbound message.
- **What to check:** No 500 from your API; SMS appears in Twilio logs (and on the test phone if configured).

### Quick integration checklist

- [ ] Stripe: Connect onboarding works; Create Booking returns 201 with `payment_intent_client_secret`; webhook receives test event and returns 200.
- [ ] SendGrid: Forgot password, email verification, and (if applicable) booking/reminder emails show in SendGrid Activity.
- [ ] Twilio: Any flow that should send SMS shows the message in Twilio Console.

---

## 7. Request bodies (quick reference)

Use `API_ENDPOINTS.md` for full request/response specs. Minimal examples for flow testing:

- **Register:** `{ "full_name", "email", "password", "role": "student" | "coach", "phone?", "timezone?" }`
- **Login:** `{ "email", "password" }`
- **Create Coach Profile:** `{ "headline?", "bio?", "experience_years?", "skill_rating?" (2.0–6.0, 0.5 steps), "rating_system?" (**`self`** | **`DUPR`** | **`UTR-P`**; default `"self"`), "certifications?", "location?" }` — pricing is per **lesson** (`price` + `duration_minutes`), not on the profile.
- **Create Court:** `{ "name" (required), "address?", "latitude?", "longitude?", "is_private?" }` — no `coach_notes` / `notes` on this route (**400** if sent). Coaches are auto-linked (`data.coachCourt`, no `coach_notes`). Link notes: **`POST /api/coaches/me/courts`** with same `court_id` + **`coach_notes`** (**200**). See `API_ENDPOINTS.md` `POST /api/courts`.
- **Create Availability:** `weekday` (0–6 or `"monday"`), required `start_time` / `end_time` (e.g. `"09:00"`, `"17:00"`), optional `start_date` / `end_date` as **`YYYY-MM-DD`** only.
- **Create Lesson:** title, duration_minutes, price, coach_id, etc.
- **Create Booking:** lesson_id, coach_id, start datetime (and any other required fields).
- **Create Review:** booking_id or lesson_id, rating, comment (per your API).

For “missing required” and “invalid data” tests, remove or corrupt one field at a time and confirm 400 with a validation message.

---

## 8. Summary

1. **Phase 1:** Test most endpoints without Stripe/Twilio/SendGrid (§1). Then set up the three services. **Phase 2:** Test payment, Connect, webhook, and email/SMS flows. Use **§1’s Stripe endpoint table** to see exactly which routes require Stripe for a real test.
2. **Think in flows** (Admin, Coach, Student). Use the **flow folders** at the top of the collection (§3) and run each flow start-to-finish.
3. **Use the checklist** in §4 and tick off as you go.
4. **For each endpoint**, run the 5 cases: happy path, missing required, invalid data, no token, wrong role (§5).
5. **Stripe:** test Create Booking (payment + PaymentIntent created there), Connect, and webhook. **SendGrid/Twilio:** trigger the flows that send email/SMS and confirm in their dashboards (§6).

If every flow works and the checklist is covered, your API is in good shape for further QA or production readiness.
