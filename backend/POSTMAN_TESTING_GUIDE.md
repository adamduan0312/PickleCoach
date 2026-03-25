# Postman Testing Guide — PickleCoach API

**Mindset:** Don’t just “test endpoints.” **Test user flows.** If every flow works from start to finish, your system works. This guide gives you a flow-based order, a checklist, and what to verify for each request (including Stripe, Twilio, SendGrid).

**Why two guides?** This file (backend) is only for Postman/testing. For full API reference use **backend/API_ENDPOINTS.md**; for setup→production use **backend/ACTION_ITEMS.md**. The root **PICKLECOACH_API_AND_SETUP_GUIDE.md** combines Postman + API reference + action items in one long doc—use that for a single file, or use this plus API_ENDPOINTS and ACTION_ITEMS for focused docs.

---

## 1. When to test endpoints vs. when to set up Stripe, Twilio, SendGrid

**Short answer:** Test most endpoints first **without** Stripe/Twilio/SendGrid. Then set up the three services. Then test the endpoints that depend on them (and confirm emails/SMS/webhooks).

### Phase 1 — Test without third‑party services (do this first)

You can test almost everything with just the server and database running. No Stripe, SendGrid, or Twilio keys needed yet.

| What to test | Why no third‑party yet |
|--------------|-------------------------|
| **Health** | Server/DB only. |
| **Auth** (Register, Login, Profile, Refresh, Forgot/Reset Password, Email Verification, Change Password, Switch Role, Logout, Delete) | All work with DB + JWT. Forgot/Reset and verification will **fail to send email** without SendGrid, but the API should still return **200** and not 500. You can verify “email would be sent” later. |
| **Coaches** (profile, availability, courts, list coaches, get coach) | Pure DB. |
| **Courts** (CRUD) | Pure DB. |
| **Lessons** (CRUD) | Pure DB. |
| **Bookings** (get, cancel, reschedule) | Pure DB. **Create Booking** is *not* in Phase 1 — see below. |
| **Reviews, Messages, Disputes, Notifications** (create/list/update) | Pure DB. |
| **Admin** (users, dashboard, audit, alerts, refunds, disputes, etc.) | Pure DB. |

**What will be limited in Phase 1:**

- **Create Booking** — **Requires Stripe.** Your API creates a Stripe PaymentIntent in the same transaction as the booking. For paid lessons, Create Booking will fail (500 or Stripe error) without Stripe configured. So you cannot test “student creates a booking” end-to-end until Phase 2. In Phase 1 you can still test **Get My Bookings**, **Get Booking By ID**, **Cancel Booking**, **Request Reschedule** if you have existing bookings (e.g. seed data or a booking you created after setting up Stripe once).
- **Create Payment** (standalone) — Same as above; needs Stripe. Leave for Phase 2.
- **Stripe Connect (coach onboarding)** — Needs Stripe keys. Skip or expect error until Phase 2.
- **Real emails** — Forgot password, email verification, booking reminders: API can return 200 but no email is sent until SendGrid is set up. Optionally stub or check logs.
- **Real SMS** — Any SMS (reminders, 2FA): same idea; set up Twilio in Phase 2.

### Set up Stripe, Twilio, and SendGrid (between Phase 1 and Phase 2)

After Phase 1 is passing:

1. Add to `.env.development`: **Stripe** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Connect URLs), **SendGrid** (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`), **Twilio** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`).
2. Stripe: run `stripe listen --forward-to localhost:4000/api/webhooks/stripe` and set `STRIPE_WEBHOOK_SECRET` from the CLI output.
3. SendGrid: verify sender email/domain.
4. Twilio: get a trial number and add it to env.

### Phase 2 — Test endpoints that use Stripe, SendGrid, Twilio

| Service | Endpoints / flows to test | What to check |
|---------|---------------------------|----------------|
| **Stripe** | **Create Booking** (creates payment + PaymentIntent in same transaction; response includes `payment_intent_client_secret`), **Initiate Stripe Connect Onboarding**, **Get Stripe Connect Status**, **Stripe Webhook** | Create Booking returns 201 with `payment_intent_client_secret` (student pays on frontend with that); Connect completes in Stripe test UI; webhook receives event and returns 200. **Create Payment** (`POST /api/payments`) is not needed for the normal flow — booking already creates the payment. |
| **SendGrid** | No dedicated endpoint — your API sends email when you call **Forgot Password**, **Request Email Verification**, **Confirm Email Change**, and (if implemented) booking created/reminder/cancel. | Call those endpoints; confirm no 500; check SendGrid Activity for the corresponding emails. |
| **Twilio** | No dedicated endpoint — your API sends SMS when you trigger flows that use SMS (e.g. booking reminder, 2FA). | Trigger those flows; confirm no 500; check Twilio Console → Logs for the outbound SMS. |

So: **Phase 1** = test everything that doesn’t touch Stripe (auth, coaches, courts, lessons, admin, and booking *read/cancel/reschedule* if you have data). **Then** set up Stripe (and optionally SendGrid/Twilio). **Phase 2** = test **Create Booking**, Stripe Connect, webhook, and email/SMS flows (and Admin → Create Payment (Admin) for reconciliation if needed). In practice, the full “student books a lesson” flow needs Stripe from the start.

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
| `booking_id`  | *(set after creating booking)* | For cancel, reschedule, payments |

The collection already uses `{{base_url}}` and `{{api_url}}`. Register and Login requests can save `auth_token` and `user_id` in the **Tests** tab so you don’t have to copy-paste.

### Two collection files (project root)

| File | Use for |
|------|--------|
| **PickleCoach_API_ByType.postman_collection.json** | Endpoints grouped by resource (Health Check, Authentication, Coaches, Courts, Bookings, etc.). Use for finding a specific endpoint, debugging, sharing with frontend. |
| **PickleCoach_API_ByFlow.postman_collection.json** | Endpoints grouped by user flow (Admin, Coach, Student). Use for running full journeys in order. |

Import one or both into Postman. Select your environment so `base_url` and `api_url` are set. Run **Health Check** first to confirm server and DB are up.

**Workflow:** Edit **ByType** when you add or change endpoints. Then run `node backend/scripts/reorganize-postman-flows.js` to regenerate **ByFlow** from ByType. To rebuild ByType from ByFlow (e.g. if you only have the flow file), run `node backend/scripts/create-by-type-collection.js`.

---

## 3. By Flow collection: three flow folders

The **PickleCoach API (By Flow)** collection has **only three top-level folders**. Every endpoint lives inside one of them, in the correct user-flow order. There are no separate “Authentication”, “Coaches”, “Bookings”, etc. folders — everything is in **1 – Flow: Admin**, **2 – Flow: Coach**, or **3 – Flow: Student**.

**Rule:** Each folder contains only endpoints that role is **allowed** to use (no 403). Admin cannot use Switch Role or Delete My Account; Coach cannot use List Coaches (Search) or Create Booking; Student cannot use Update Booking Status (coach/admin only). Those endpoints appear only in the flows where the role has access.

- **1 – Flow: Admin** — 43 requests. Health → Login (admin) → Profile → Dashboard → Users → Payments → Disputes → Notifications → Coach support (incl. Get Coach By ID) → Auth extras (no Switch Role / Delete My Account) → Courts/Lessons/Disputes → Update Booking Status → Payments → Webhook.
- **2 – Flow: Coach** — 59 requests. Health → Register/Login → Profile → Coach profile → Get Coach By ID → Courts → Availability → Stripe Connect → Lessons → Bookings (Accept, Decline, Update Status, Cancel, Reschedule) → Payments → Reviews → Messages → Disputes → Notifications → Auth extras.
- **3 – Flow: Student** — 45 requests. Health → Register/Login → Profile → Search coaches → Get Coach By ID → Get Coach Courts → Get Coach Availability → Courts → Lessons → Create Booking → Bookings (no Update Booking Status) → Payments → Reviews → Messages → Disputes → Notifications → Auth extras.

Run the requests in each folder in order (1, 2, 3, …). After editing the **ByType** collection, regenerate ByFlow with: `node backend/scripts/reorganize-postman-flows.js`.

**Full order — 1 – Flow: Admin (43 steps):**  
Health Check → Login → Get Profile → Refresh Token → Get Dashboard Stats → Get Audit Logs → Get Alerts → Resolve Alert → Create Admin User → Get All Users (Admin) → Get User By ID (Admin) → Update User (Admin) → Update Coach Profile (Admin) → **Get Coach By ID** → Adjust User Reliability → Create Payment (Admin) → Process Refund (Admin) → Update Payment Status (Admin) → Resolve Dispute (Admin) → Create Notification (Admin) → Get Coach Courts (Admin) → Delete Coach Court (Admin) → Delete Coach Availability (Admin) → Delete User (Admin) → Register → Forgot Password → Reset Password → Update Profile → Change Password → Request Email Verification → Confirm Email Verification → Request Email Change → Confirm Email Change → Logout → Get All Courts → Get Court By ID → Get All Lessons → Get Lesson By ID → Get All Disputes → Get Dispute By ID → Update Booking Status → Get My Payments → Get Payment By ID → Stripe Webhook.

**Full order — 2 – Flow: Coach (59 steps):**  
Health Check → Register → Login → Get Profile → Update Profile → Request Email Verification → Confirm Email Verification → Change Password → Request Email Change → Confirm Email Change → Switch Role → Create Coach Profile → Update Coach Profile → **Get Coach By ID** → Get Coach Availability → Create Availability → Delete Availability → Get All Courts → Get Court By ID → Create Court → Delete Court → Add Court to Coach → List My Courts → Remove Court from Coach → Initiate Stripe Connect Onboarding → Get Stripe Connect Status → Get All Lessons → Get Lesson By ID → Create Lesson → Update Lesson → Delete Lesson → Get My Bookings → Get Booking By ID → **Accept Booking** → **Decline Booking** → Update Booking Status → Cancel Booking → Request Reschedule → Get Reschedule History → Get My Payments → Get Payment By ID → Get All Reviews → Create Review → Update Review → Delete Review → Get Conversations → Create Conversation → Get Conversation By ID → Send Message → Mark Message As Read → Get All Disputes → Get Dispute By ID → Create Dispute → Get My Notifications → Mark Notification As Read → Forgot Password → Reset Password → Logout → Delete My Account.

**Full order — 3 – Flow: Student (45 steps):**  
Health Check → Register → Login → Get Profile → Update Profile → Request Email Verification → Confirm Email Verification → Change Password → Request Email Change → Confirm Email Change → Switch Role → List Coaches (Search) → Get Coach By ID → **Get Coach Courts** → **Get Coach Availability** → Get All Courts → Get Court By ID → Get All Lessons → Get Lesson By ID → **Create Booking** (requires Stripe) → Get My Bookings → Get Booking By ID → Cancel Booking → Request Reschedule → Get Reschedule History → Get My Payments → Get Payment By ID → Get All Reviews → Create Review → Update Review → Delete Review → Get Conversations → Create Conversation → Get Conversation By ID → Send Message → Mark Message As Read → Get All Disputes → Get Dispute By ID → Create Dispute → Get My Notifications → Mark Notification As Read → Forgot Password → Reset Password → Logout → Delete My Account.

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
- [ ] Switch Role (student ↔ coach) — 200; 403 for admin
- [ ] Logout — 200; then same token → 401
- [ ] Delete My Account — 200 (soft delete); 403 for admin

### COACH

- [ ] Create Coach Profile — 201; 403 if not coach role (coach-only; admins cannot use)
- [ ] Update Coach Profile — 200
- [ ] Get Coach Courts (by coach id, no auth) — 200; lists courts where coach teaches (student flow: **3 – Flow: Student** → Get Coach Courts)
- [ ] Get Coach Availability — 200
- [ ] Create Availability — 201
- [ ] Delete Availability — 200
- [ ] Add Court to Coach — 201
- [ ] List My Courts — 200
- [ ] Remove Court from Coach — 200
- [ ] Initiate Stripe Connect Onboarding — 200, redirect URL
- [ ] Get Stripe Connect Status — 200

### COURTS

- [ ] Get All Courts — 200
- [ ] Get Court By ID — 200
- [ ] Create Court — 201 (admin or per your design)
- [ ] Delete Court — 200

### LESSONS

- [ ] Get All Lessons — 200
- [ ] Get Lesson By ID — 200
- [ ] Create Lesson — 201
- [ ] Update Lesson — 200
- [ ] Delete Lesson — 200

### BOOKINGS

- [ ] Create Booking — 201 (verified email); **requires Stripe** (PaymentIntent created in same transaction); 403 if email not verified
- [ ] Double booking blocked — same slot → 409 or 400
- [ ] Get My Bookings — 200
- [ ] Get Booking By ID — 200
- [ ] **Accept Booking** (Coach/Admin only) — 200; confirms pending booking, captures payment; use this (not PUT status) to confirm
- [ ] **Decline Booking** (Coach/Admin only) — 200; body: message_to_student (required), decline_reason_code (optional); cancels PaymentIntent
- [ ] Update Booking Status (Coach/Admin only) — 200; allowed transitions: confirmed→completed|cancelled|no_show, awaiting_verification→completed|cancelled. Completed is only allowed after lesson end time has passed. Both confirmed→completed and awaiting_verification→completed mean “lesson is done” (booking may be in either state depending on whether the worker has run).
- [ ] Cancel Booking — 200 (Student, Coach, Admin)
- [ ] Past booking blocked — start time in past → 400
- [ ] Request Reschedule — 201 (Student, Coach, Admin)

### PAYMENTS

- [ ] Get My Payments — 200
- [ ] Get Payment By ID — 200
- [ ] *(Optional)* POST /api/payments — admin reconciliation only (create payment record for a booking that has none, e.g. legacy/manual data; optionally link payment_intent_id/charge_id). In the collection: **Admin → Create Payment (Admin)**. Not needed for the normal “student books and pays” flow.

### RESCHEDULES

- [ ] Get Reschedule History — 200

### REVIEWS

- [ ] Get All Reviews — 200
- [ ] Create Review — 201 (e.g. after lesson); 403 if not verified
- [ ] Update Review — 200
- [ ] Delete Review — 200

### MESSAGES

- [ ] Get Conversations — 200
- [ ] Create Conversation — 201
- [ ] Get Conversation By ID — 200
- [ ] Send Message — 200/201
- [ ] Mark Message As Read — 200

### DISPUTES

- [ ] Create Dispute — 201; 403 if not verified
- [ ] Get All Disputes — 200
- [ ] Get Dispute By ID — 200

### NOTIFICATIONS

- [ ] Get My Notifications — 200
- [ ] Mark Notification As Read — 200

### ADMIN

- [ ] Get Dashboard Stats — 200; 403 non-admin
- [ ] Get Audit Logs — 200; 403 non-admin
- [ ] Get Alerts — 200; 403 non-admin
- [ ] Resolve Alert — 200; 403 non-admin
- [ ] Get All Users — 200; 403 non-admin
- [ ] Get User By ID — 200; 403 non-admin
- [ ] Update User — 200; 403 non-admin
- [ ] Delete User — 200; 403 non-admin
- [ ] Create Payment (Admin) — 201; for reconciliation (booking with no payment); 403 non-admin
- [ ] Process Refund — 200; 403 non-admin
- [ ] Update Payment Status — 200; 403 non-admin
- [ ] Resolve Dispute — 200; 403 non-admin
- [ ] Create Notification — 200/201; 403 non-admin
- [ ] Get Coach Courts (Admin) / Delete Coach Court (Admin) / Delete Coach Availability (Admin) — 200; 403 non-admin

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
- **POST /api/bookings**  
  Happy: student, verified email, valid body → 201. Unverified email → 403. Missing `lesson_id` → 400. No token → 401.
- **GET /api/users** (admin)  
  Happy: admin token → 200. Student token → 403. No token → 401.

You don’t need to write formal test code for all of this; running the requests in Postman and checking status + body is enough. You can add Postman **Tests** (e.g. `pm.response.to.have.status(201)`) for the happy path and then run the failure cases manually.

---

## 6. Third-party: Stripe, Twilio, SendGrid

These fit into testing as follows: **set them up after Phase 1** (see §1). Then in **Phase 2** you test the endpoints and flows that depend on them.

### Stripe

- **Setup:** `.env.development`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Connect return/refresh URLs. Use Stripe **test** keys.
- **In Postman:**
  - **Initiate Stripe Connect Onboarding** — expect 200 and a URL; open it in the browser and complete test onboarding.
  - **Get Stripe Connect Status** — expect 200 and status (e.g. `charges_enabled: true` when onboarding is done).
  - **Create Payment** — use a booking that exists; expect 200/201 and a Stripe payment intent or client secret (depending on your API design).
- **Webhook:** Run Stripe CLI: `stripe listen --forward-to localhost:4000/api/webhooks/stripe`. In Postman, you can’t “call” the webhook directly; trigger events from Stripe Dashboard or CLI (e.g. `stripe trigger payment_intent.succeeded`) and confirm your server returns 200 and processes the event (e.g. payment status updated).
- **What to check:** Connect onboarding completes, payment creation doesn’t error, webhook receives events and responds 200.

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
- **Create Coach Profile:** `{ "headline?", "bio?", "hourly_rate?", "experience_years?", "skill_level?", "certifications?", "location?" }`
- **Create Court:** name, address, etc. (see API_ENDPOINTS).
- **Create Availability:** `weekday` (0–6 or "monday"), optional `start_time`/`end_time` (e.g. "09:00", "17:00") or `start_datetime`/`end_datetime`.
- **Create Lesson:** title, duration_minutes, price, coach_id, etc.
- **Create Booking:** lesson_id, coach_id, start datetime (and any other required fields).
- **Create Payment:** booking_id, amount (and any Stripe-specific fields your API expects).
- **Create Review:** booking_id or lesson_id, rating, comment (per your API).

For “missing required” and “invalid data” tests, remove or corrupt one field at a time and confirm 400 with a validation message.

---

## 8. Summary

1. **Phase 1:** Test most endpoints without Stripe/Twilio/SendGrid (§1). Then set up the three services. **Phase 2:** Test payment, Connect, webhook, and email/SMS flows.
2. **Think in flows** (Admin, Coach, Student). Use the **flow folders** at the top of the collection (§3) and run each flow start-to-finish.
3. **Use the checklist** in §4 and tick off as you go.
4. **For each endpoint**, run the 5 cases: happy path, missing required, invalid data, no token, wrong role (§5).
5. **Stripe:** test Create Booking (payment + PaymentIntent created there), Connect, and webhook. **SendGrid/Twilio:** trigger the flows that send email/SMS and confirm in their dashboards (§6).

If every flow works and the checklist is covered, your API is in good shape for further QA or production readiness.
