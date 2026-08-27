# Role authorization (PickleCoach)

See **`ROLE_SYSTEM_REFERENCE.md`** for end-to-end product behavior (registration, self-service add, admin governance, DTO field meanings, persistence). See **`PHILOSOPHY_A_ADMIN_INTERACTION_SCAN.md`** for how `admin` coexists with `student`/`coach` in HTTP handlers after the Philosophy A pass.

## Invariant: capabilities vs data scoping

- **Capabilities** = effective role set (`student`, `coach`, `admin` in any combination).
- **Authorization** = middleware `authorize(...)` and explicit controller checks for a **required capability** (e.g. must be coach to hit `authorize('coach')` routes).
- **Data scoping** = “is this row about me?” (booking coach/student, payment coach/student, conversation booking, etc.). Do not treat `admin` as replacing participant identity: if the user is on the booking, **participant** semantics (e.g. `requested_by`, `opened_by`, `cancelledBy`) take precedence over “has admin in JWT.”
- **No single active role**: never assume only one of `student` / `coach` / `admin` applies for listing or mutations when the user has multiple (e.g. **`GET /api/payments`** must include rows where the user is coach **or** student when they have both roles).

### Role ≠ identity in a transaction (domain-first)

**Capability roles** (`student`, `coach`, `admin`) answer “what is this user allowed to do in general?” **They must not override factual involvement** on a concrete row when that row defines the relationship.

**Priority when a domain object exists (booking, payment, dispute, …):**

1. **Domain relationship** — Is `req.user.id` the coach, student, reviewer, party on this booking/payment/dispute?
2. **Capability** — Does effective role include the capability needed for this *type* of action (e.g. must be able to act as coach for coach-only routes)?
3. **Admin-only fallback** — Uninvolved admin (not on the booking, not a party on the payment) using supervisor tools or `/api/admin/*`.

**Already aligned in handlers (audit baseline):** `cancelBooking` (`cancelledBy` from booking coach/student), `createDispute` / opener role, `requestReschedule` (`requested_by` participant-first), `GET /api/payments` non-admin list (`Op.or` when coach+student). **Intentional role-first** cases: no booking yet (e.g. coach search, registration), `authorize('admin')` routes, or “admin OR participant” guards where `admin` **adds** access without removing participant semantics.

**Optional hardening (not blocking):** grep for `roles.includes('admin')` **before** reading the domain row in a handler; refactor for readability so “load entity → compute involvement → then role fallback” is obvious. List endpoints where admins skip participant filters are **product choice** (superset visibility), not the same bug class as `requested_by: admin` for a student on the booking.

## Hard rule

**Only _effective_ roles may decide access.**  
Treat persisted `user_roles` as **assignments / audit / admin UI**, not as the permission source by itself.

**Roles control what a user can do *now*. They do not invalidate historical records.** Removing `coach` or `student` (self-service or admin) must **not** delete coach profiles, lessons, court links, bookings, payments, reviews, disputes, messages, or Stripe Connect data. Existing bookings authorize by **participation** (`coach_id` / `primary_student_id`), not by whether the user currently holds that role. Marketplace discovery (`GET /api/coaches`, bookable coach side-doors) requires a **current** effective `coach` role.

**Self-booking invariant:** `primary_student_id !== coach_id` — enforced on booking intent creation and confirmation (and the Booking model validate).

| Layer | Meaning |
|--------|---------|
| **`user_roles` (DB)** | What was assigned (history, admin lists, joins). |
| **`users.role_governance_locked` + `users.admin_allowed_roles`** | Admin policy (allow-list when locked). |
| **Effective roles** | `effectiveRolesFromGovernance(dbAssignments, user)` — **this** is what gates behavior. |

## HTTP request (`authenticate`)

- **`req.user.dbRoleAssignments`** — raw strings from `user_roles` (debug / rare use).
- **`req.user.roles`** and **`req.user.effectiveRoles`** — **same array**; use for **`authorize()`** and any `req.user` permission check.
- Do **not** use `req.user.userRoles.map(r => r.role)` for access on the authenticated user.

## Other users (workers, booking coach, etc.)

Load `User` with `include: [userRoles]` (default user attributes include governance columns). Then:

```js
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';

const perms = getEffectiveRolesForUserRecord(otherUser);
if (!perms.includes('coach')) { /* deny or skip */ }
```

## Admin `PUT /api/users/:id` with `roles`

Updates **both** `user_roles` **and** governance (`locked` + allow-list) in one step so normal operation does not leave “assignment without policy” drift. A future split to a dedicated `role_policy` table would separate concerns without changing the **effective-only** rule above.

## Regression test

See **`tests/role-governance.test.mjs`**: effective roles must hide disallowed assignments when governance is locked (simulated ghost assignment).
