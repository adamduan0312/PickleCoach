# Philosophy A — admin vs student/coach interaction scan

**Philosophy A:** `student`, `coach`, and `admin` are **independent** effective capabilities; all may coexist. Possessing **`admin`** must **not** disable student or coach behavior unless the behavior is an **intentional security or product rule**.

This document lists backend patterns after the **2026-06** alignment pass, and classifies remaining `roles.includes('admin')` (and similar) uses.

---

## Audit (capabilities vs “view” / routing) — remaining behavior

### Core invariant (enforced in code + docs)

1. **Roles are additive:** `student`, `coach`, `admin` may coexist; no endpoint may assume a **single** active role for combined users (e.g. payment list uses **OR** for coach+student).
2. **Authorization** = `authorize(...)` and explicit **capability** checks (must have `student` to create a booking, etc.).
3. **Data scoping** = participation on marketplace rows where applicable; **`admin`** adds supervisor paths (`/api/admin/*`, dispute resolve, …) and must **not** strip participant semantics when the user **is** the coach/student on the row (`requested_by`, `opened_by`, `cancelledBy`, etc.).
4. **Pure admin** (effective roles include `admin` but **not** `student` or `coach`) still uses **`/api/admin/bookings`** for list/detail/cancel on non-admin routes — **intentional** routing, not “admin replaces student” (they are not a student).

### Remaining `roles.includes('admin')` patterns (classified)

| Class | Examples | Notes |
|-------|-----------|--------|
| **Intentional security / product** | `authController.addUserRole` (**403** if session has `admin`); `authorize('admin')`; dispute resolve; `requireVerifiedEmailUnlessAdmin` | Keep. |
| **Supervisor OR participant (additive)** | `paymentController.getPaymentById`, `reviewController`, `lessonController`/`courtController` ownership, `messageController` “admin OR on booking” | `admin` **adds** access; does not remove student/coach. |
| **Omniscient read when admin** | `getConversations`, `getRescheduleHistory`, `getDisputes`, `getPayments` (admin branch) | Callers with **`admin`** skip narrow participant filters — **broader** than student-only; dual-role users keep **both** student/coach APIs and admin breadth. Optional future hardening: scope **`/api/*`** lists to participant-only when product wants data minimization on “student app” URLs (not required for Philosophy A). |
| **Pure-admin booking redirect** | `getBookingById` / `cancelBooking` on `/api/bookings/:id` (and related mutation routes) | **Intentional** — admin-without-capability uses admin APIs for detail/cancel where documented. |

### Violations fixed in this pass

- **`GET /api/payments`**: coach+student could not see student-side payments → **fixed** (`Op.or`).
- **`POST /api/bookings/:id/reschedule`**: admin+student recorded as `requested_by: admin` → **fixed** (participant-first).

### No “switch role” in the API

- Documented in **`ROLE_SYSTEM_REFERENCE.md`** §5 and **`ROLE_AUTHORIZATION.md`**: clients should render **all** applicable capabilities; any tab switch is **local UX only**.

---

## Implemented in this pass

| Area | Change |
|------|--------|
| `bookingController.createBooking` | Requires **`student`** only; removed blanket denial when `admin` also present. |
| `bookingController.getAdminBookings` / role dashboards | Admin lists via **`GET /api/admin/bookings`**. Participant dashboards use **`GET /api/coaches/me/bookings`** and **`GET /api/students/me/bookings`** (no combined `/api/bookings` list). |
| `bookingController.getBookingById` | **Participants** always allowed on non-admin routes; uninvolved admin still uses admin route. |
| `bookingController.cancelBooking` | **Participants** cancel as coach/student (including admin+dual role); uninvolved admin on public route still told to use admin cancel. `cancelledBy` prefers coach/student when applicable. |
| `bookingController` reliability after cancel / coach no-show | Removed skip when target had `admin` in effective roles. |
| `coachController.getCoaches` | Allows **`student`** or **`admin`** capability; **coach-only** accounts still cannot use coach search (use other flows). |
| `disputeController.createDispute` | **`opened_by` / opener role**: **coach** if user is booking coach, **student** if primary student, else **admin** for uninvolved support. |
| `reliabilityService.updateUserReliability` | Removed blanket `return null` when user has `admin`; still no-ops if user lacks the requested **`coach`** / **`student`** dimension. |
| `reliabilityWorker` | Removed skips that excluded all users with `admin` from periodic / monthly recompute. |
| `paymentService` / `rescheduleController` (reliability on target) | Removed “do not update reliability if target is admin” guard. |
| `paymentController.getPayments` | **Non-admin** with **both** `coach` and **`student`**: **`Op.or`** on `coach_id` / `student_id` (was `else if`, which hid student payments). Neither role → empty list. |
| `rescheduleController.requestReschedule` | **`requested_by`** participant-first (coach / student on booking before `admin`); fixes admin+student reliability skip. |

---

## Intentional policy (keep — not Philosophy A violations)

| Location | Behavior | Rationale |
|----------|----------|-----------|
| `authController.deleteMyAccount` | **409** `last_admin_required` if user has **`admin`** in `user_roles` and **`countOtherLiveAdmins`** is 0 | Same invariant as **`DELETE /api/users/:id`**; admins may self-delete when another live admin exists. |
| `authController.addUserRole` | **403** if session has `admin` | Single path for role edits: **`PUT /api/users/:id`**. |
| `adminRoutes` + `userRoutes` + `authorize('admin')` | Admin-only APIs | Correct privilege boundary. |
| `disputeController.resolveDispute` | `authorize('admin')` | Only admins resolve disputes. |
| `notificationController.createNotification` | Admin-only | Broadcast / support tooling. |
| `middleware/auth.js` `requireVerifiedEmailUnlessAdmin` | Admins skip email verification gate | Operational support. |
| `adminController.adjustUserReliability` | **400** if **target** has `admin` in effective roles | Manual score edits on admin accounts remain disallowed (product/support choice). |
| `bookingController.markBookingNoShow` | Coach on booking **or** admin **on admin route** | Route separation for attendance marks. |
| `messageController` / `rescheduleController.getRescheduleHistory` / `paymentController.getPayments` / `disputeController.getDisputes` | If caller has **`admin`**, broader visibility than participants | **Superset** admin capability — does not strip student/coach; dual-role users get admin-wide reads when they have admin (acceptable). |

---

## Broader access for admin (not “blocking” student/coach)

These **add** capability for admins rather than remove student/coach paths:

- **`paymentController.getPaymentById`**: `admin` **or** coach **or** student on payment.
- **`reviewController`**, **`lessonController`**, **`courtController`**: `admin` OR coach/student where documented.

**Classification:** **Intentional** — consistent with Philosophy A.

---

## Coach-only endpoints (still require `coach`)

Examples: `lessonController.getMyLessons`, `coachController.createAvailability`, `coachRoutes` entries with `authorize('coach')` (e.g. **`/me/availability`** CRUD).

**Classification:** **Intentional** — admin without **coach** cannot manage another user’s availability from coach routes (admins use admin-specific endpoints where present). **`GET /api/coaches/:id/availability`** is student/admin only; coaches browse others’ slots only when their session includes **`student`**.

---

## Scripts (not HTTP API)

`seed-*.js` skips users with `admin` when picking random coach/student for fixtures.

**Classification:** **Intentional** test data — not user-facing Philosophy A.

---

## Summary

- **Removed** incorrect denials: booking create, coach search for dual-role, participant booking list/detail/cancel for admin+participant, dispute `opened_by` priority, reliability blanket admin skip in service/worker/payment/reschedule/booking no-show paths, payment list **coach-vs-student** exclusivity, reschedule **`requested_by`** admin-first override.
- **Kept** deliberate walls: **≥1 live admin** invariant on **`DELETE /api/auth/me`** and **`DELETE /api/users/:id`** (and role strip via **`PUT /api/users/:id`**), self-service **`PUT /api/auth/me/role`** blocked when session has **`admin`**, admin-only routes, manual reliability adjust on admin **targets**, email verification bypass for admins, mark student no-show route split.

If product later wants **pure-admin** accounts to use **student** booking without assigning `student` in the DB, that would be a different model (e.g. impersonation); not part of Philosophy A.
