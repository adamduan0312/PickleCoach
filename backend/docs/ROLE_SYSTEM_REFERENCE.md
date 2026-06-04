# Role system reference (PickleCoach backend)

This document is the **product-level** companion to **`ROLE_AUTHORIZATION.md`** (engineering rule: effective roles only for access).

---

## 1. Registration (`POST /api/auth/register`)

- Body includes a **single** required field **`role`**: **`student`** or **`coach`** only (Joi `registerSchema`).
- **`admin`** cannot be self-assigned at registration.
- The server creates **one** `users` row and **one** `user_roles` row.
- Response `user.roles` are **effective** (via `serializeAuthSessionUser`); for a new user without governance, that matches the single assignment.

---

## 2. Self-service role addition (`PUT /api/auth/me/role`)

- **One** role per request: body `{ "role": "student" | "coach" }` (`addUserRoleSchema`).
- **Additive only**: uses `UserRole.findOrCreate` — **never** removes existing roles.
- A user may call the endpoint twice (e.g. student then coach) and end up with **both**, when policy allows.
- **Admins** get **403** (must use admin user APIs).
- **Governance**: if `role_governance_locked` and `admin_allowed_roles` would forbid the result, **`canSelfServiceAddRole`** returns false → **403** *This role has been restricted by an administrator*.
- **JWT**: a **new token** is returned when a role row was actually added; if the role was already present, the message explains no change.
- **Audit action** (since consistency pass): **`user_self_service_role_added`** (payload includes before/after role lists from DB assignments).

---

## 3. Admin role management & governance (`PUT /api/users/:id`)

- **Authoritative** for changing persisted roles and for **locking** self-service.
- Optional **`roles`**: **full replace** of all `user_roles` for that user (destroy + bulk create inside a transaction). Joi accepts any **1–3** unique combination of `student`, `coach`, and `admin` (independent capabilities, including `admin`+`student` and all three).
- When **`roles`** is sent, the server sets **`role_governance_locked: true`** and **`admin_allowed_roles`** to that same array (allow-list).
- **`role_governance_locked: false`** alone (without **`roles`** in the same request) clears the lock and allow-list (Joi prevents combining with `roles`).
- **Safeguards**: cannot remove own admin; cannot remove last system admin (see `userRoleChangeGuards`).
- **Response**: **`data.roles`** = persisted assignments after update; **`data.role_state`** includes **`effective_roles`** (what `authorize()` would use). See **`API_ENDPOINTS.md`** for the explicit note.

---

## 4. Effective roles vs persisted assignments

| Concept | Source |
|--------|--------|
| **Persisted assignments** | `user_roles` rows |
| **Governance** | `users.role_governance_locked`, `users.admin_allowed_roles` |
| **Effective (runtime permissions)** | `effectiveRolesFromGovernance(assignments, user)` |

- After **`authenticate`**, **`req.user.roles`** === **`req.user.effectiveRoles`** (effective only).
- **`req.user.dbRoleAssignments`** = raw assignment strings (debug / rare).
- For **another** user instance in controllers/workers: **`getEffectiveRolesForUserRecord(user)`** (requires governance columns + `userRoles` loaded).

### Philosophy A (independent capabilities)

`student`, `coach`, and `admin` may coexist in effective roles. **Possessing `admin` does not remove student or coach behavior** on participant routes (bookings, coach search, reliability for the coach/student dimension). **Exception** kept on purpose: **`PUT /api/auth/me/role`** is blocked when the session includes **`admin`** (see §2–3 and auth controller). **`DELETE /api/auth/me`** uses only the **≥1 live admin** invariant when the account has an **`admin`** assignment, not a blanket ban. See **`docs/PHILOSOPHY_A_ADMIN_INTERACTION_SCAN.md`** for the full interaction matrix and any remaining intentional admin-only branches. For **transaction semantics** (who cancelled, who opened a dispute, reschedule `requested_by`), see **`ROLE_AUTHORIZATION.md`** — *Role ≠ identity in a transaction* (domain relationship before role fallback).

---

## 5. Capabilities vs routing vs UI (no “active role” in the API)

### Server invariant (Philosophy A)

- **`student`**, **`coach`**, and **`admin`** are **additive capabilities**, not mutually exclusive modes.
- **Route-level** access uses **`authorize(...)`** against **effective** roles (middleware).
- **Data visibility** for marketplace objects (bookings, payments where not admin-omniscient, messages, reschedule history for non-admins, etc.) is primarily **participation-based** (user is coach or student on the row) or **explicit admin** (`/api/admin/*`, `authorize('admin')`).
- **`admin`** is a **supervisor** capability: it **adds** tools (admin routes, resolve disputes, optional read bypass where implemented). It must **not** remove student/coach behavior unless **explicitly** documented (e.g. self-service `PUT /api/auth/me/role` is blocked when the session includes **`admin`**). **Self-delete** (`DELETE /api/auth/me`) uses the **≥1 live admin** invariant only, not a blanket admin ban.

### Frontend / web app

- The API **does not** store a “current role” or “switch role” flag — **there is no server-side active role**.
- **`GET /api/auth/profile`** (and login payloads) return **all effective** roles at once.
- Clients should **surface every capability the user has**: e.g. show **both** student and coach (and admin) experiences **simultaneously** (tabs, sections, or combined home). A local **`activeRole`** or tab selection is **purely UX** for layout; it must not be the only way to reach a capability the user still has in **`roles`**.

---

## 6. Coach profile, Stripe, and history persistence

- **Removing** `coach` from **`roles`** via **`PUT /api/users/:id`** does **not** delete `coach_profiles`, Stripe Connect ids, bookings, payments, payouts, reliability rows, etc. Access is revoked by effective roles / governance; **historical and financial data remain** (see controller comments and `API_ENDPOINTS.md` “Coach vs `user_roles`”).
- **Soft delete user** (`DELETE /api/users/:id` or self **`DELETE /api/auth/me`**) may soft-delete the **coach profile** for GDPR/lifecycle reasons — that is **not** “role change”; it is account deletion.

---

## 7. DTO field meanings (`roles` + `role_state`)

| Serializer | `roles` field | `role_state` |
|------------|----------------|--------------|
| **`serializeAuthSessionUser`**, **`serializeAuthProfileUser`** | **Effective** permissions (same as `authorize()` for that user). | Present; `effective_roles` matches `roles`. |
| **`serializeAdminUserList`**, **`serializeAdminUserDetail`** | Persisted **`user_roles`** (audit / admin). | `effective_roles` = permission view; may differ when governance hides a “ghost” assignment. |
| **`PUT /api/users/:id` response** (inline in `userController`) | Persisted assignments. | Same as admin serializers. |

Reliability summaries on **admin user detail** attach when **effective** includes `coach` / `student`, so hidden ghost assignments do not surface coach reliability as “active.”

---

## 8. Related files

- **`backend/middleware/auth.js`** — sets `req.user.roles` / `effectiveRoles` from governance.
- **`backend/utils/roleGovernance.js`** — formulas + `getEffectiveRolesForUserRecord`.
- **`backend/utils/userDto.js`** — all user-shaped JSON for auth + admin.
- **`backend/config/validation.js`** — `registerSchema`, `addUserRoleSchema`, `updateUserSchema`.
- **`backend/tests/role-governance.test.mjs`** — governance + ghost-assignment regression.
