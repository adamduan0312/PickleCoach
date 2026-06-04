# Role system consistency audit — report

**Date:** 2026-06-01  
**Scope:** Backend + repo docs + Postman collections aligned to the intended architecture (effective roles for access, persisted `user_roles` as assignments, additive self-service `PUT /api/auth/me/role`, admin governance on `PUT /api/users/:id`).

---

## Summary

Most runtime behavior already matched the intended model (governance, `authenticate`, `authorize`, booking/reliability/payment paths using **`getEffectiveRolesForUserRecord`** or **`req.user.roles`**). Remaining inconsistencies were mainly **naming and documentation** (Postman “Switch Role”, audit `user_switched_role`, admin DTO attaching coach reliability using raw roles). Those have been corrected in-repo as part of this audit pass.

---

## 1. Route names & descriptions

| Location | Issue | Resolution |
|----------|--------|--------------|
| `PickleCoach_API_ByFlow.postman_collection.json` | Request named “Switch Role (Student ↔ Coach)” and description implied switching | Renamed to **“11. Add Role (Self-Service)”**; description states additive, one role per body, governance, new JWT. |
| `PickleCoach_API_ByType.postman_collection.json` | Same | Renamed to **“Add Role (Self-Service)”**; collection description updated. |
| `backend/POSTMAN_TESTING_GUIDE.md` | Multiple “Switch Role” references | Replaced with **“Add Role (self-service)”**; checklist clarified (one of student \| coach per request, additive). |
| `backend/scripts/reorganize-postman-flows.js` | Ordered by old request name | Source key = **ByType** request name **`Add Role (Self-Service)`**; comments updated. |
| `backend/scripts/create-by-type-collection.js` | Auth blurb said “Switch Role” | Updated to **Add Role (self-service)**. |
| `backend/routes/authRoutes.js` | Already: “Self-service: add …” | No change required. |
| `backend/controllers/authController.js` | JSDoc already describes additive behavior | Audit log action renamed (see §2). |
| `backend/API_ENDPOINTS.md` | Already describes additive `PUT /auth/me/role` | Added explicit **`data.roles` vs `data.role_state`** note for **`PUT /api/users/:id`** response. |
| `PICKLECOACH_API_AND_SETUP_GUIDE.md` | `GET /api/users` / `GET /api/users/:id` examples used singular **`role`** | Updated samples to **`roles`** + **`role_state`** (abbreviated shapes). |

---

## 2. Event & audit names

| Event | Issue | Resolution |
|-------|--------|--------------|
| `user_switched_role` | Implied exclusive switch | Renamed to **`user_self_service_role_added`** in `authController.addUserRole`. |

**Migration note:** Any dashboard or SQL that filtered `audit_logs.action = 'user_switched_role'` must include **`user_self_service_role_added`** (or backfill/rename historical rows if strict continuity is required).

---

## 3. Error messages

- **`PUT /api/auth/me/role`**: Governance denial uses **“This role has been restricted by an administrator”** — accurate (not “switch”).
- **Success**: “Role added successfully…” / “Capability unchanged…” — consistent with additive behavior.
- No remaining user-facing strings in backend controllers were found that say “switch role” for this endpoint (grep after Postman doc sweep).

---

## 4. Authorization

- **`req.user`** paths: **`authenticate`** sets **`req.user.roles`** = effective; **`authorize()`** uses **`req.user.roles`** — correct.
- **Other users**: Prior work standardized on **`getEffectiveRolesForUserRecord`** in booking, admin coach tools, reliability service/worker/controller, payment reschedule path, etc.
- **Intentional raw `user_roles` reads** (not access checks):
  - **`authController.addUserRole`**: `currentRoles` from DB for **`canSelfServiceAddRole`** (must reflect persisted set before add).
  - **`userController.updateUser`**: admin full replace + response `roles` = persisted list.
  - **Admin DTO `roles`**: `mapUserRoles` for assignment display.
  - **Dev scripts** `test-login.js`, `set-user-role.js`: convenience only.

---

## 5. Role persistence & data deletion

- **`userController.updateUser`**: On `roles` change, only **`UserRole.destroy` + bulkCreate`** and governance columns update — **no** `CoachProfile.destroy`, no Stripe field wipe, no reliability/booking/payment deletion.
- **`deleteUser` / `deleteMyAccount`**: Soft-delete user; may soft-delete coach profile — **documented account lifecycle**, not “role strip.”

---

## 6. DTO consistency

- **Issue:** `serializeAdminUserDetail` gated **`reliability`** / **`reliability_student`** on **raw** `roles.includes('coach'|'student')`, so a governance-hidden “ghost” coach could still show coach reliability on admin detail.
- **Fix:** Gate those blocks on **`effective`** includes coach/student (same idea as auth profile serializer).

- **Module docstring** in `userDto.js` now states explicitly: auth serializers → **`roles`** = effective; admin serializers → **`roles`** = persisted assignments + **`role_state`**.

---

## 7. Postman collections

- Addressed under §1; both **ByFlow** and **ByType** updated.

---

## 8. New canonical doc

- **`backend/docs/ROLE_SYSTEM_REFERENCE.md`** — single reference for registration, self-service add, admin governance, effective vs persisted, UI `activeRole`, persistence guarantees, DTO table.
- **`ROLE_AUTHORIZATION.md`** — link added to that reference.

---

## Residual risks / follow-ups

1. **Audit log history** still contains old **`user_switched_role`** rows in production DBs until naturally aged out; plan queries accordingly.
2. **External clients** (mobile/web) that still show “Switch role” copy should align wording with “Add role” / “Add coach capability.”

---

## Verification

- `npm test` (backend) after changes.
