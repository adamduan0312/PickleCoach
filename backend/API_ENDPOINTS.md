# API Endpoints Reference

Complete list of all API endpoints with detailed field specifications.

**Base URL**: All endpoints are prefixed with `/api`

**Authentication**: Most endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

**Response convention**: For create/update endpoints, the response body echoes all **safe** request-body fields (same keys, with `null` when optional and unset) so clients see a consistent shape and can easily compare request vs response in Postman. Sensitive fields (e.g. password) are never returned.

**Delete behavior**: **Soft delete** (set `deleted_at` / `is_active: false`, row kept): users (self-delete `DELETE /api/auth/me`, admin `DELETE /api/users/:id`). Through the current application, the only operation that soft-deletes a coach profile is soft-deleting the entire user account. Also soft-deleted: **courts** (`DELETE /api/courts/:id` — **admin only**; removes the global `court_locations` row and all `coach_court_locations` for that court), lessons (`DELETE /api/lessons/:id`). **Hard delete** (row removed): coach availability (`DELETE /api/coaches/me/availability/:id` coach-only, or `DELETE /api/admin/coaches/:coachId/availability/:id` admin), coach–court **unlink** (`DELETE /api/coaches/me/courts/:courtId` — coach only; **only** your link, not the global court), admin unlink another coach (`DELETE /api/admin/coaches/:coachId/courts/:courtId`), reviews (`DELETE /api/reviews/:id`). Bookings are cancelled via `POST /api/bookings/:id/cancel`, not deleted (**`reviews.booking_id` is `ON DELETE RESTRICT`** so a hard booking delete cannot silently wipe reviews).

---

## Health Check

### `GET /health`
- **Auth**: None required
- **Description**: Health check endpoint to verify server and database connectivity
- **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-01-26T12:00:00.000Z",
    "database": "connected",
    "uptime": 123.45
  }
  ```

---

## Authentication (`/api/auth`)

### `POST /api/auth/register`
- **Auth**: None required
- **Description**: Register a new user account
- **Request Body**:
  ```json
  {
    "full_name": "string (required, 2-100 chars)",
    "email": "string (required, valid email, max 150 chars)",
    "password": "string (required, min 10 chars, at least one lowercase, one uppercase, one number; symbols optional)",
    "role": "string (required, 'student' | 'coach')",
    "phone": "string (optional, max 30 chars)",
    "timezone": "string (optional, defaults to 'UTC')",
    "avatar_url": "string (optional, valid URL, max 255 chars)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "user": {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "roles": ["student"],
        "phone": null,
        "phone_verified": false,
        "timezone": "UTC",
        "avatar_url": null,
        "email_verified_at": null,
        "is_active": true
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Note**: All safe request fields (full_name, email, role, phone, timezone, avatar_url) are echoed in the response; optional ones are `null` when not sent. `email_verified_at` is included so the client can show verification status. Avatar can also be set or changed later via `PUT /api/auth/profile`. **Stripe Customer** is not created at registration; it is created when the user completes a verified financial flow (e.g. paid booking).
- **Error responses**: `400` (validation failed – invalid body), `409` (email already registered), `500` (server error).

### `POST /api/auth/login`
- **Auth**: None required
- **Description**: Login and receive JWT token
- **Request Body**:
  ```json
  {
    "email": "string (required, valid email)",
    "password": "string (required)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "user": {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "roles": ["student"],
        "phone": null,
        "phone_verified": false,
        "timezone": "America/New_York",
        "avatar_url": null,
        "email_verified_at": "2026-01-15T10:00:00.000Z",
        "is_active": true
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Note**: The `user` object includes `email_verified_at` (ISO date or `null`) so the client can show verification status and avoid unnecessary verify-email calls.
- **Error responses**: `400` (validation), `401` with distinct messages:
  - Invalid email/password → `Invalid credentials`
  - Soft-deleted account → `This account has been deleted. Please contact support.`
  - Suspended account (`is_active: false`, not deleted) → `This account has been suspended. Please contact support.`
  - `500` (server error).

### `POST /api/auth/refresh`
- **Auth**: None (body carries the JWT)
- **Description**: Refresh a JWT. The token must have a **valid signature** (including expired tokens: expiry is ignored only after signature verification). The submitted token’s `tokenVersion` must match the user’s current `token_version` (same rule as `authenticate`); otherwise the request is rejected — e.g. after logout, password reset, or email change.
- **Request Body**:
  ```json
  {
    "token": "string (required, JWT token)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Token refreshed successfully",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "roles": ["student"],
        "phone": null,
        "phone_verified": false,
        "timezone": "America/New_York",
        "avatar_url": null,
        "email_verified_at": null,
        "is_active": true
      }
    }
  }
  ```
- **Error responses**: `400` (missing body token), `401` (**Authentication failed** — invalid signature, malformed token, **token revoked** / version mismatch, unknown user id, or account unusable). For unusable accounts the `error` string is more specific: **deleted** (`This account has been deleted. Please contact support.`) vs **suspended** (`This account has been suspended. Please contact support.`) vs **unknown user** (`Invalid or inactive user`). Use login to obtain a new token.

### `POST /api/auth/forgot-password`
- **Auth**: None required
- **Description**: Request a password reset link via email
- **Request Body**:
  ```json
  {
    "email": "string (required, valid email)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "If an account exists with this email, a password reset link has been sent",
    "data": null
  }
  ```
- **Error responses**: `400` (validation failed – invalid email), `500` (server error). Success message is the same whether email exists or not (security).
- **Note**: For security, the response is the same whether the email exists or not.

### `POST /api/auth/reset-password`
- **Auth**: None required
- **Description**: Reset password using the token from the forgot-password email
- **Request Body**:
  ```json
  {
    "token": "string (required, password reset token from email)",
    "password": "string (required, min 10 chars + upper, lower, number per password policy)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Password reset successfully",
    "data": null
  }
  ```
- **Error responses**:
  - **400** — Invalid or expired token (wrong token, already used, or expired after 1 hour):
    ```json
    {
      "success": false,
      "message": "Invalid or expired reset token"
    }
    ```
  - **400** — Validation failed (missing/invalid body, e.g. short password):
    ```json
    {
      "success": false,
      "error": "Validation failed",
      "details": [ { "field": "password", "message": "Password must be at least 10 characters and include lowercase, uppercase, and a number." } ],
      "requestId": "..."
    }
    ```
  - **500** — Server error (e.g. database failure):
    ```json
    {
      "success": false,
      "message": "Failed to reset password"
    }
    ```
- **Error responses**: See full error response block above (400 invalid/expired token, 400 validation failed, 500 server error).
- **Note**: Token expires after 1 hour.

### `PUT /api/auth/change-password`
- **Auth**: Required
- **Description**: Change the current authenticated user's password using their existing password. **Other sessions** (other devices/tabs) are invalidated via `token_version`; this response includes a **fresh JWT** so the **current** session can continue without re-login.
- **Request Body**:
  ```json
  {
    "current_password": "string (required, existing password)",
    "new_password": "string (required, min 10 chars + upper, lower, number per password policy)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Password changed successfully",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "roles": ["student"],
        "phone": null,
        "timezone": "UTC",
        "avatar_url": null,
        "email_verified_at": null
      }
    }
  }
  ```
- **Error responses**: `400` (missing fields, new_password fails policy, or current_password incorrect), `401` (missing or invalid token), `500` (server error).

### `POST /api/auth/change-email/request`
- **Auth**: Required
- **Description**: Start a **2-step email change flow** for the authenticated user. Verifies the user's current password, checks that the new email is not already in use, and sends a confirmation email to the **new** email address with a tokenized link.
- **Request Body**:
  ```json
  {
    "new_email": "string (required, valid email, max 150 chars, must be different from current email)",
    "password": "string (required, current account password)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Email change confirmation sent to new address",
    "data": null
  }
  ```
- **Behavior**:
  - Stores a one-time `email_change_token`, `email_change_expires` (24h), and `email_change_new_email` on the user record.
  - Sends a `email_change_confirm` notification via email to the new address with a link like:
    `https://frontend/change-email/confirm?token=...`.
- **Error responses**: `400` (validation failed, password incorrect, new_email equals current, or new_email already in use), `401` (missing or invalid token), `500` (server error).

### `POST /api/auth/change-email/confirm`
- **Auth**: None required (token-based)
- **Description**: Confirm the email change using the token sent to the **new** email address.
- **Request Body**:
  ```json
  {
    "token": "string (required, email change token from email)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Email updated successfully",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 1,
        "full_name": "John Doe",
        "email": "new@example.com",
        "roles": ["student"],
        "phone": null,
        "timezone": "UTC",
        "avatar_url": null,
        "email_verified_at": "2026-03-30T12:00:00.000Z"
      }
    }
  }
  ```
- **Behavior**:
  - Validates the token (`email_change_token`) and ensures `email_change_expires` is in the future.
  - Updates `user.email` to the pending `email_change_new_email`.
  - Clears `email_change_token`, `email_change_expires`, and `email_change_new_email`.
  - Sets `email_verified_at` to now (the new email is considered verified).
  - Increments `token_version` for the user, revoking **other** sessions; **this response** includes a fresh JWT so the client completing the confirm flow can stay signed in.
  - Sends a security notification (`email_changed_notification`) to the **old email** informing them that the email was changed.
- **Error responses**: `400` (invalid or expired token), `500` (server error).

### `POST /api/auth/verify-email/request`
- **Auth**: Required
- **Description**: Request a verification email for the current authenticated user's email address. Used by the frontend to implement a **hybrid verification UX**: users can browse without verifying, but must verify before bookings/payments/disputes/reviews/messaging.
- **Request Body**: _Empty object_ (`{}`).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Verification email sent",
    "data": null
  }
  ```
- **Behavior**:
  - If `email_verified_at` is already set, returns success with message `"Email is already verified"` and does not send a new email.
  - Otherwise generates an `email_verification_token` and `email_verification_expires` (24h), records `email_verification_last_sent_at`, and sends an `email_verification` email with a link like:
    `https://frontend/verify-email?token=...`.
  - **Resend cooldown**: at most one send per **60 seconds** per user; otherwise `429` with `retryAfterSec` in the JSON body.
- **Error responses**: `401` (missing or invalid token), `429` (resend cooldown), `500` (server error).

### `POST /api/auth/verify-email/confirm`
- **Auth**: None required (token-based)
- **Description**: Confirm email verification using the token from the verification email.
- **Request Body**:
  ```json
  {
    "token": "string (required, email verification token from email)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Email verified successfully",
    "data": null
  }
  ```
- **Behavior**:
  - Finds a user with the matching `email_verification_token` and a non-expired `email_verification_expires`.
  - Sets `email_verified_at` if not already set, and clears the verification token/expiry and last-sent timestamp.
- **Error responses**: `400` (invalid or expired verification token), `500` (server error).

### `GET /api/auth/profile`
- **Auth**: Required
- **Description**: Get current authenticated user's profile. Response is a **DTO** (explicit whitelist): no `token_version`, password-reset, email-verification/change tokens, or other auth internals.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Profile retrieved successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "avatar_url": "https://example.com/avatar.jpg",
      "phone": "+1234567890",
      "phone_verified": false,
      "timezone": "America/New_York",
      "is_active": true,
      "email_verified_at": "2026-01-15T10:00:00.000Z",
      "created_at": "2026-01-01T00:00:00.000Z",
      "last_login": "2026-01-20T12:00:00.000Z",
      "roles": ["coach"],
      "role_state": {
        "locked": false,
        "allowed_roles": null,
        "effective_roles": ["coach"],
        "source": "open"
      },
      "coachProfile": { },
      "reliability": {
        "reliability_score": 95.5,
        "total_bookings": 12,
        "late_cancels": 0,
        "no_shows": 0,
        "misconduct_penalties": 0,
      }
    }
  }
  ```
- **Reliability** (optional): When a matching `user_reliability` row exists, **`reliability`** (coach role) and/or **`reliability_student`** (student role) include only a **lightweight summary** for session/profile state (`reliability_score`, `total_bookings`, `late_cancels`, `no_shows`, `misconduct_penalties`). **Coach-facing detail** (more counters, `score_source`, no engine internals): **`GET /api/coaches/me/reliability`**. **Student self** (curated detail, same style as coach `/me`): **`GET /api/students/me/reliability`**. **Admin audit** (decay breakdowns, diagnostics, legacy aliases): **`GET /api/admin/users/:id/reliability`**.
- **Notes**: `email_verified_at` supports verification UX. `coachProfile` is whitelisted public coach fields (or `null`). **`roles`** are **effective** (after admin governance filter when locked). **`role_state`** documents lock source and allow-list.
- **Error responses**: `401` (missing or invalid token), `500` (server error).

### `PUT /api/auth/profile`
- **Auth**: Required
- **Description**: Update current authenticated user's profile. **Response `data` uses the same DTO as `GET /api/auth/profile`** (`serializeAuthProfileUser`) so clients can replace local profile state without a second schema.
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "full_name": "string (optional)",
    "phone": "string (optional, max 30 chars)",
    "timezone": "string (optional)",
    "avatar_url": "string (optional, max 255 chars)"
  }
  ```
- **Response** (Status: 200): Same shape as **`GET /api/auth/profile`** — see that section (`data` includes `id`, `full_name`, `email`, `avatar_url`, `phone`, `phone_verified`, `timezone`, `is_active`, `email_verified_at`, `created_at`, `last_login`, **`roles`** (effective for authorization when admin governance is locked), **`role_state`**, `coachProfile`, optional `reliability` / `reliability_student`).
- **Error responses**: `400` (validation failed – invalid body), `401` (missing or invalid token), `500` (server error).

### `PUT /api/auth/me/role`
- **Auth**: Required
- **Description**: **Add** the **student** or **coach** role to your account (self-service). This endpoint **does not remove** roles or “switch” you to a single role — you can hold **both** student and coach **when permitted**. Admins cannot use this (use admin user management). To **remove** coach or admin access, an admin must use **`PUT /api/users/:id`** with an explicit **`roles`** array; coach profile and Stripe Connect data **persist** for billing/history. After adding **coach**, create a coach profile with `POST /api/coaches/profile` if you do not have one yet.
- **Role governance**: After an admin has sent **`roles`** on **`PUT /api/users/:id`** for your account, **`role_governance_locked`** is **true** and **`admin_allowed_roles`** is the allow-list. **`PUT /api/auth/me/role`** then returns **403** with message *This role has been restricted by an administrator* if you try to add a role not in that list (e.g. admin left you `["student"]` and you request **`coach`**). **`GET /api/auth/profile`** and session **`user`** include **`role_state`**: `{ locked, allowed_roles, effective_roles, source }` so the UI can disable self-service adds when locked. **Design reference:** [`docs/ROLE_AUTHORIZATION.md`](docs/ROLE_AUTHORIZATION.md) (effective roles are the only permission source for access control).
- **Active mode (recommended UX)**: The API does **not** store which dashboard the user is “in”. Use client **`activeRole`** for navigation; **`data.user.roles`** reflects **effective** permissions (same as `authorize()` after governance).
- **Request Body**:
  ```json
  {
    "role": "string (required, 'student' | 'coach')"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Role added successfully. Use the new token for subsequent requests.",
    "data": {
      "user": {
        "id": 1,
        "full_name": "Jane Doe",
        "email": "jane@example.com",
        "roles": ["coach", "student"],
        "role_state": {
          "locked": false,
          "allowed_roles": null,
          "effective_roles": ["coach", "student"],
          "source": "open"
        },
        "phone": "+1234567890",
        "timezone": "America/New_York",
        "avatar_url": null
      },
      "token": "eyJhbGciOiJIUzI1NiIs..."
    }
  }
  ```
- **Error responses**: `400` (invalid role), `403` (admin cannot use this endpoint; **or** requested role **restricted by administrator** when governance is locked), `401` (missing or invalid token), `500` (server error).

### `DELETE /api/auth/me`
- **Auth**: Required
- **Description**: Delete the current user's account (**soft delete**). Sets `deleted_at` and `is_active: false` on the user; if the user has a coach profile, it is also soft-deleted. The user can no longer log in. **Admin rows:** if the account has an **`admin`** assignment in **`user_roles`**, deletion is allowed only when **at least one other live admin** remains (same rule as **`DELETE /api/users/:id`** — `deleted_at` / inactive users do not count). Non-admin accounts may always self-delete.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Account deleted successfully",
    "data": null
  }
  ```
- **Error responses**: `409` (last live admin — same `message` / `code: "last_admin_required"` as admin user delete when no other active admin exists), `401` (missing or invalid token), `500` (server error).

### `POST /api/auth/logout`
- **Auth**: Required
- **Description**: Log out the current session. The backend increments the user's **token_version**, so the current token and all other existing tokens for this user are invalidated. The client should discard the token after calling; subsequent requests with the old token will receive `401` (e.g. "Token has been revoked. Please log in again.").
- **Request Body**: None.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Logged out successfully",
    "data": null
  }
  ```
- **Error responses**: `401` (missing or invalid token), `500` (server error).

### Email verification & "serious actions"

- **Token versioning**: All JWTs include a `tokenVersion` claim. The backend stores `token_version` per user and rejects tokens where the claim does not match, allowing **global session revocation** when passwords/emails are changed.
- **Email verification**:
  - Many endpoints only require a valid JWT.
  - **High-impact endpoints** additionally require `email_verified_at` to be set (see notes below).
  - Unverified users receive `403` with a message instructing them to verify their email.
- **Endpoints requiring verified email**:
  - `POST /api/booking-intents`, `POST /api/bookings/confirm`
  - `POST /api/disputes` (create dispute — non-admin; admins exempt where noted)
  - `POST /api/reviews` (create review)
  - `POST /api/messages/conversations` and `POST /api/messages/send` (booking-scoped messaging)
  - `GET /api/payments`, `GET /api/payments/:id` (payment history)
  - `GET|POST|PUT|DELETE /api/payment-methods/...` (saved payment methods)
  - `POST /api/coaches/me/stripe-connect/onboard`, `GET /api/coaches/me/stripe-connect/status` (Stripe Connect — admins exempt)
  - `GET /api/coaches/me/marketplace-status` (listing checklist — separate from dashboard readiness)
  - The frontend should:
    - Show a non-blocking banner after signup/first login prompting verification.
    - Automatically call `POST /api/auth/verify-email/request` when the user asks to resend.

---

## Users (`/api/users`)


**User lifecycle (best practice):**

| State | `is_active` | `deleted_at` | Meaning |
|---|---|---|---|
| **Active** | `true` | `null` | Can log in; appears in public coach discovery when applicable |
| **Suspended** | `false` | `null` | Cannot log in; row and coach profile remain; reversible without data loss |
| **Deleted** | `false` | set | Soft-deleted; coach profile soft-deleted; restorable by admin |

- **`deleted_at`**: Soft-delete timestamp. When set, the account is Deleted (data kept for audit). Login and default list endpoints exclude deleted users unless `include_deleted=true`.
- **`is_active`**: Access flag. **Suspension** sets `is_active: false` without setting `deleted_at` and **does not** touch `coach_profiles`, lessons, availability, or reviews. Soft-delete always sets both `deleted_at` and `is_active: false`.
- **Invalid state**: `is_active: true` with `deleted_at` set is rejected.
- **List behavior**: `GET /api/users` default returns non–soft-deleted users (**Active + Suspended**). Use `include_deleted=true` to include Deleted. Each row includes `is_active` / `deleted_at` for client filtering.
- **Cascade on delete/restore**: Through the current application, the only operation that soft-deletes a coach profile is soft-deleting the entire user account (sets **`coach_profiles.deleted_at`**). Lessons, availability, reviews, bookings, and courts are **not** soft-deleted with the user (lessons remain for booking history). Restore clears **`users.deleted_at`**, sets **`is_active: true`**, and clears **`coach_profiles.deleted_at`** in the same transaction.


### `GET /api/users`
- **Auth**: Required (Admin only)
- **Description**: Get all users (admin only). By default returns only non–soft-deleted users. If `limit` is omitted, returns all matching users in `data`. If `limit` is provided (with optional `page`), response includes `pagination`.
- **Query Parameters**:
  - `page`: number (optional; used when `limit` is provided, default 1)
  - `limit`: number (optional; provide to paginate. Omit to return all matching users)
  - `role`: string (optional, filter by role: 'student' | 'coach' | 'admin')
  - `include_deleted`: string `'true'` | `'false'` (optional). If `'true'`, includes soft-deleted users; default is non-deleted only (**Active + Suspended**).
  - `search`: string (optional). Filters users by **full name** or **email** (case-insensitive, partial match). Use for admin "find user" without scrolling the full list.
- **Note**: Response items are a **whitelist** of admin fields (`id`, `full_name`, `email`, `avatar_url`, `phone`, `phone_verified`, `timezone`, `roles`, `is_active`, `deleted_at`, `email_verified_at`, `created_at`, `last_login`). **Omitted** from the list contract: `password_hash`, `token_version`, password-reset / email-verification / email-change tokens, `stripe_customer_id`, and other persistence-only columns.
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Users retrieved successfully",
    "data": [
      {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "avatar_url": null,
        "phone": "+1234567890",
        "phone_verified": false,
        "timezone": "America/New_York",
        "roles": ["student"],
        "is_active": true,
        "deleted_at": null,
        "email_verified_at": null,
        "created_at": "2026-01-01T00:00:00.000Z",
        "last_login": null
      }
    ]
  }
  ```
  Each user includes a `roles` array (from the `user_roles` table); a user may have multiple roles (e.g. `["coach", "admin"]`). Note: Pagination info is included in the response structure (see pagination section).

### `GET /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Get user by ID (admin only). Non-admins should use `GET /api/auth/profile` for their own profile.
- **Response shape**: Whitelisted user fields plus `stripe_customer_id` (Stripe Customer id for payment/support lookup), `coachProfile` (when present), and **`reliability` / `reliability_student`** as **five-field summaries** only (`reliability_score`, `total_bookings`, `late_cancels`, `no_shows`, `misconduct_penalties`). **Not** included: auth/recovery tokens, `token_version`, `score_source`, timestamps on reliability blobs, decay/smoothing internals. Coaches who need more than that summary should use **`GET /api/coaches/me/reliability`** (curated coach detail). For persisted-row audit, decay/reconstruct diagnostics, and engine parameters use **`GET /api/admin/users/:id/reliability`**.
- **Reliability**: Users with the **coach** role may include **`reliability`**. Users with the **student** role may include **`reliability_student`**. Dual-role users can have both.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "User retrieved successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "avatar_url": null,
      "phone": "+1234567890",
      "phone_verified": false,
      "timezone": "America/New_York",
      "is_active": true,
      "deleted_at": null,
      "email_verified_at": null,
      "created_at": "2026-01-01T00:00:00.000Z",
      "last_login": null,
      "stripe_customer_id": "cus_xxx",
      "roles": ["coach"],
      "coachProfile": {
        "id": 1,
        "user_id": 1,
        "headline": null,
        "bio": "Experienced coach",
        "experience_years": 0,
        "skill_rating": 4.5,
        "rating_system": "self",
        "certifications": null,
        "location": null,
        "rating_average": 0,
        "rating_count": 0,
        "coach_commission_percent": 92,
        "stripe_account_id": null,
        "deleted_at": null,
        "created_at": "2026-01-01T00:00:00.000Z"
      },
      "reliability": {
        "reliability_score": 95.5,
        "total_bookings": 12,
        "late_cancels": 0,
        "no_shows": 0,
        "misconduct_penalties": 0,
      }
    }
  }
  ```

### `PUT /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Update user (admin only - can update **roles** (full set), **`is_active`** (suspend/reactivate), **`deleted_at: null`** (restore), email, avatar_url, etc.). If **`email`** is changed to a new value, **`token_version`** is incremented so **all** of that user’s sessions (every device) are invalidated — the user must log in again.
- **Lifecycle actions** (same endpoint):
  - **Suspend**: `{ "is_active": false }` — blocks login; does **not** set `deleted_at`; does **not** touch coach profile / lessons / availability / reviews.
  - **Reactivate**: `{ "is_active": true }` — only when `deleted_at` is already null (Suspended → Active). **400** if the user is still Deleted.
  - **Restore**: `{ "deleted_at": null, "is_active": true }` — clears soft-delete, sets active, and restores soft-deleted **coach profile** in one transaction.
- **Roles**: Send **`roles`** as the **complete** set to assign (e.g. `["student","coach"]` or `["admin","student","coach"]`). Omit **`roles`** to leave existing roles unchanged. Sending **`roles`** **replaces** all `user_roles` rows for that user (avoids accidentally dropping a role when editing other fields). Duplicates in the array are rejected by validation; use each of `student`, `coach`, `admin` at most once (1–3 roles). **Independent capabilities:** any non-empty subset is allowed — including **`admin`** with **`student`**, and all three together. The legacy field **`role`** is **not** accepted (returns **400** with a validation hint — use **`roles`**).
- **Admin safeguards**: You **cannot** remove your **own** `admin` role via this endpoint (**400**, *You cannot remove your own admin role.*) — including when you still keep another role (e.g. you have `["admin","coach"]` and send `"roles": ["coach"]` on **your own** `PUT /api/users/:id`). Another admin must change your roles, or you must include **`admin`** in the array you submit for yourself. You **cannot** remove `admin` from the **last** admin user in the system when editing **someone else** (**409**, *At least one admin must remain in the system.*).
- **Coach vs `user_roles`**: Stripping **`coach`** from **`roles`** revokes **coach API access** only; **`coach_profiles`**, **`stripe_account_id`**, bookings, payments, and payouts **are not deleted**. Clients should explain that to users (e.g. coach access removed by admin while marketplace/financial history remains).
- **Role governance (admin authority)**: Whenever an admin sends **`roles`** in the body, the server sets **`role_governance_locked: true`** and **`admin_allowed_roles`** to that exact array. Self-service **`PUT /api/auth/me/role`** may only add **`student`** / **`coach`** that keep the user’s roles within **`admin_allowed_roles`**; **`authorize()`** and **`req.user.roles`** use **effective roles** (assignments filtered by the allow-list when locked — see [`docs/ROLE_AUTHORIZATION.md`](docs/ROLE_AUTHORIZATION.md)). To **re-open** self-service without changing role rows, send **`"role_governance_locked": false`** in a **separate** request **without** **`roles`** (**400** if combined with **`roles`**). Users who have **never** had an admin **`roles`** update remain **open** (legacy behavior).
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "full_name": "string (optional)",
    "email": "string (optional, must be unique; 400 if already in use)",
    "phone": "string (optional, max 30 chars)",
    "timezone": "string (optional)",
    "avatar_url": "string (optional, URI or empty string to clear)",
    "is_active": "boolean (optional): true = reactivate, false = suspend",
    "deleted_at": "null only (optional): restore soft-deleted user + coach profile",
    "roles": ["optional: 1–3 unique entries: student | coach | admin"],
    "role_governance_locked": "boolean (optional): false alone clears lock + allow-list (must not be sent together with roles)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "User updated successfully",
    "data": {
      "id": 1,
      "full_name": "Updated Name",
      "email": "john@example.com",
      "roles": ["coach", "student"],
      "role_state": {
        "locked": true,
        "allowed_roles": ["coach", "student"],
        "effective_roles": ["coach", "student"],
        "source": "admin"
      },
      "is_active": true,
      "deleted_at": null,
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": null
    }
  }
  ```
- **`data.roles` vs `data.role_state`**: **`roles`** is the **persisted `user_roles`** set after the update (assignment / audit). **`role_state.effective_roles`** is the **permission view** (same formula as `authorize()` / `GET /api/auth/profile` for a user with governance). They match when unlocked or when assignments ⊆ allow-list. See **`docs/ROLE_SYSTEM_REFERENCE.md`**.
- **Error responses**: `400` (validation, email in use, cannot activate deleted user without restore, **cannot remove your own admin role**), `404` (user not found), `409` (**last live admin** — cannot strip `admin` when no other **active, non-deleted** admin exists), `500` (server error).

### `DELETE /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: **Soft delete** user (admin only). Sets `deleted_at` and `is_active: false` on the user; if the user has a coach profile, it is also soft-deleted (same transaction). Lessons / availability / reviews are **not** removed. Deleted users are excluded from default lists and cannot log in. To reverse, use **Restore** on `PUT /api/users/:id` (`deleted_at: null`, `is_active: true`) — restores user **and** coach profile.
- **Admin safeguard**: Cannot delete a user who still has the **`admin`** role in `user_roles` unless at least one **other live** admin remains (`users.deleted_at` is null, `is_active` is true, and that user has an `admin` row). Soft-deleted admins do **not** count — otherwise the guard could see “ghost” admin rows and allow wiping the last real admin. **409** response: `success: false`, `message` explains the rule, and **`code`: `"last_admin_required"`** for programmatic handling. (If you see **`401`** with `{ "error": "…" }` and no `success` field, that is **`authenticate`** — e.g. token for a **deleted** user — not this safeguard.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "User deleted successfully",
    "data": null
  }
  ```
- **Error responses**: `400` (user already deleted), `404` (user not found), `409` (last live admin cannot be deleted — see `message` and `code: "last_admin_required"`), `500` (server error).

---

## Coaches (`/api/coaches`)

### `GET /api/coaches` (List / search coaches)
- **Auth**: Required (student, coach, or admin). Same public marketplace cards for all; booking still requires the **student** role.
- **Description**: List/search **marketplace-eligible** coaches with optional filters. Use **lat**, **lng**, and **radius** to find coaches who have courts within that distance (e.g. "coaches near me"). Use **`court_location_id`** to list coaches linked to a specific shared court (browse-courts → "who teaches here?"). If `page`/`limit` are omitted, returns all matching coaches in `data` (server-capped). If `page` or `limit` is provided, response includes `pagination`.
- **Marketplace eligibility (always enforced, DB-only — no Stripe API per coach)**: A coach appears only when **all** are true:
  1. Active user + coach role + non-deleted **coach profile**
  2. **`coach_profiles.stripe_ready = true`** (local cache; synced via Connect status / `account.updated` webhook)
  3. **≥1 active lesson** (`is_active`, not soft-deleted)
  4. **≥1 non-deleted court** linked via CoachCourt (**any** `is_private` value — discovery flag only; coaches who teach only at courts hidden from the public directory remain listable)
  5. **≥1 availability** row
  Geo search further restricts courts to those near `(lat, lng)`. **`court_location_id`** further requires a link to that `court_locations.id` (soft-deleted court → **`404`**). Filters combine (AND). This matches booking reality (intent needs lesson + court + schedule; payment needs Stripe).
- **DTO contract (flattened list card)**: Marketplace-friendly shape — **no** nested `coachProfile` / `coachCourts` / join-table IDs. Fields: `id`, `full_name`, `avatar_url`, `timezone`, profile summary (`headline`, `bio`, `experience_years`, `skill_rating`, `rating_system`, `certifications`, `location`, `rating_average`, `rating_count`), `reliability_score`, `reliability_last_updated`, and **`courts`** (name/`area`/structured address fields/`is_private`; **private courts redact** `address_line1`/`city`/`state`/`postal_code`/`country`/coordinates and expose only `area` — see Court address visibility). When **`court_location_id`** is set, included `courts[]` are scoped to that court (plus any other courts still matching geo filters if both are set). When **lat+lng** are set, also **`distance_miles`** (nearest included court, 1 decimal) and per-court `distance_miles` (computed server-side even when GPS is redacted). Never exposes credentials or Stripe/commission fields. Soft-deleted courts are omitted.
- **Query Parameters**:
  - `lat` (optional) – latitude in degrees (center point for distance filter)
  - `lng` (optional) – longitude in degrees (center point for distance filter)
  - `radius` (optional) – miles from (lat, lng); default 10, max 500
  - `court_location_id` (optional) – `court_locations.id`; return only coaches linked to that court. Missing/soft-deleted court → **`404`**. Works for public and private courts (private addresses still redacted on the card).
  - `min_skill_rating` (optional) – numeric **self-reported** playing level **≥** this value (**2.0–6.0**, **0.5** steps). Excludes coaches with **`skill_rating`** unset (`null`).
  - `max_skill_rating` (optional) – **≤** this value; same rules. Cannot be less than `min_skill_rating` when both are sent.
  - `min_rating` (optional) – minimum **review** `rating_average` (0–5), distinct from skill
  - `page` (optional) – page number (used when paginating)
  - `limit` (optional) – items per page; provide to paginate (omit for all results)
- **Pagination contract**: Paged mode includes `pagination`: `{ "totalItems", "totalPages", "currentPage", "pageSize" }`. All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coaches retrieved successfully",
    "data": [
      {
        "id": 37,
        "full_name": "GeoSearch Coach SF Mission",
        "avatar_url": null,
        "timezone": "America/Los_Angeles",
        "headline": "~1.5mi — inside radius 5 from downtown SF",
        "bio": "Fixture coach for GET /coaches radius / geo search tests.",
        "experience_years": 7,
        "skill_rating": 4.0,
        "rating_system": "self",
        "certifications": null,
        "location": "San Francisco Mission",
        "rating_average": 4.9,
        "rating_count": 10,
        "reliability_score": 100,
        "reliability_last_updated": null,
        "distance_miles": 1.6,
        "courts": [
          {
            "name": "GeoSearch Fixture SF Mission Courts",
            "address_line1": "Dolores St & 19th St",
            "city": "San Francisco",
            "state": "CA",
            "postal_code": "94114",
            "country": "US",
            "area": "San Francisco, CA 94114",
            "latitude": 37.7599,
            "longitude": -122.425,
            "is_private": false,
            "distance_miles": 1.6
          }
        ]
      }
    ]
  }
  ```
  **Detail** (`GET /api/coaches/:id`) still uses the nested `coachProfile` + `reliability` shell (plus lessons/reviews/availability). Use **`GET /api/coaches/:id/courts`** when court IDs are needed for booking.

### `GET /api/coaches/:id`
- **Auth**: Required. **Roles**: Student, Coach, or Admin (marketplace browse — coaches may view other coaches; booking still requires **student**).
- **Description**: Get coach details by ID. Includes **`reliability`**: `{ "reliability_score", "last_updated" }` (defaults **100** / **`null`** when no row). Nested **`lessons`** are active + non-deleted only when the coach is **marketplace-eligible**; otherwise **`lessons: []`**. Each lesson uses the **public marketplace DTO** (no nested coach, no lifecycle fields). Nested **`reviewsReceived`** are recent reviews for that coach (trimmed cards — rating/comment/student, no booking blob). Prefer **`GET /api/coaches/:id/lessons`** for dedicated lesson discovery.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach retrieved successfully",
    "data": {
      "id": 2,
      "full_name": "Jane Coach",
      "coachProfile": { },
      "availabilities": [],
      "lessons": [],
      "reviewsReceived": [],
      "reliability": {
        "reliability_score": 85.5,
        "last_updated": "2026-03-16T18:42:26.000Z"
      }
    }
  }
  ```

### `GET /api/coaches/:id/reliability`
- **Auth**: Required. **Roles**: Student, Coach, or Admin.
- **Description**: Get a coach's reliability score only (no breakdown fields).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach reliability retrieved successfully",
    "data": {
      "reliability": {
        "user_id": 2,
        "reliability_score": 85.5,
        "last_updated": "2026-03-16T18:42:26.000Z"
      }
    }
  }
  ```

### `GET /api/coaches/me/reliability`
- **Auth**: Required (coach role only)
- **Description**: **Coach-facing detailed reliability view** for the authenticated coach. Returns a **curated DTO** (meaningful counters + `score_source` + `last_updated`) suitable for a coach dashboard — **not** a raw `user_reliability` row and **not** the same shape as **`GET /api/auth/profile`** (which embeds only a **six-field reliability summary** on the user object).

**How this differs from other reliability reads**

| Endpoint | Audience | Purpose |
|----------|----------|---------|
| **`GET /api/auth/profile`** | Authenticated user | Session/profile; optional **`reliability`** / **`reliability_student`** = **summary only** (`reliability_score`, `total_bookings`, `late_cancels`, `no_shows`, `misconduct_penalties`). |
| **`GET /api/coaches/me/reliability`** | Coach | **Detail view**: adds `score_source`, lesson-not-completed count, coach/student non-late cancel counts, etc. **Omits** persistence/engine internals (decayed totals, baselines, smoothing, badges, …). |
| **`GET /api/admin/users/:id/reliability`** | Admin | **Full audit**: decay triplets, reconstructed score, `legacy_aliases`, scoring parameters. |

- **Counters** (recent-window, scoring impact): **late_cancels**, **no_shows**, behavior dispute penalties, **`coach_cancels`**, **`student_cancels_non_late`**, **`total_bookings`**. **`score_source`**: `computed` vs `admin_override`.
- **`policy_notes.late_student_cancel`**: Coach-facing help text for student late-cancel compensation (50% refund; retained amount split coach + platform commission). Display in cancellation/payments help UI.
- **Related**: Coach booking inbox is **`GET /api/coaches/me/bookings`** (see Bookings section).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach reliability retrieved successfully",
    "data": {
      "reliability": {
        "reliability_score": 85.5,
        "score_source": "computed",
        "total_bookings": 10,
        "late_cancels": 0,
        "no_shows": 0,
        "misconduct_penalties": 1,
        "lesson_not_completed_penalties": 0,
        "coach_cancels": 1,
        "student_cancels_non_late": 0,
        "last_updated": "2026-03-16T18:42:26.000Z"
      },
      "policy_notes": {
        "late_student_cancel": "Student cancellations made within 24 hours of the lesson start time receive a 50% refund when payment was captured. The remaining amount is split between coach payout and the platform commission (same ratio as a completed lesson). If payment was only authorized and not yet captured (e.g. pending booking before coach accept), the authorization is released in full and no coach payout applies."
      }
    }
  }
  ```
- **`last_updated`**: ISO 8601 string from the row’s `last_updated` timestamp, or **`null`** if no row has been written yet (defaults are still returned for numeric fields).
- **Error responses**: `400` (user is not a coach), `401`, `404`, `500`.

### `POST /api/coaches/profile`
- **Auth**: Required (coach role only)
- **Description**: Create your own coach profile. Coach-only: only the authenticated coach can create a profile; profile is always for the logged-in user. Admins cannot use this endpoint.
- **Skill rating**: Self-reported pickleball level on a **2.0–6.0** scale, **half-point** steps only (e.g. 3.0, 3.5, 4.0). Optional; leave unset until the coach enters it.
- **`rating_system`**: Optional; omit to default to **`"self"`**. When sent, must be exactly one of: **`"self"`**, **`"DUPR"`**, **`"UTR-P"`** (MVP allow-list; values are not verified against external APIs yet).
- **Pricing**: Coach profiles do **not** store an hourly rate. Listings and checkout use each **lesson’s** `price` and `duration_minutes`; see **`effective_hourly_rate`** on lesson JSON (derived: `price / (duration_minutes / 60)`).
- **Request Body**:
  ```json
  {
    "headline": "string (optional)",
    "bio": "string (optional)",
    "experience_years": "number (optional, defaults to 0)",
    "skill_rating": "number | null (optional, 2.0–6.0 in 0.5 steps)",
    "rating_system": "\"self\" | \"DUPR\" | \"UTR-P\" (optional; default self when omitted)",
    "certifications": "string (optional)",
    "location": "string (optional)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Coach profile created successfully",
    "data": {
      "id": 1,
      "user_id": 1,
      "headline": "Former tournament player",
      "bio": "Experienced pickleball coach with 10 years of teaching",
      "experience_years": 10,
      "skill_rating": 4.5,
      "rating_system": "self",
      "certifications": "USAPA Certified",
      "location": "New York, NY",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/coaches/me/profile`
- **Auth**: Required (**coach** role only)
- **Description**: Update **your own** coach profile. No path parameter — the server always uses the authenticated user’s id (same pattern as `GET /api/coaches/me/reliability`, `POST /api/coaches/me/courts`, etc.).
- **`rating_system`**: When sent, must be one of **`"self"`**, **`"DUPR"`**, **`"UTR-P"`** (same allow-list as profile create).
- **Request Body** (all fields optional — omit fields you do not want to change):
  ```json
  {
    "headline": "string (optional)",
    "bio": "string (optional)",
    "experience_years": "number (optional)",
    "skill_rating": "number | null (optional, clear with null)",
    "rating_system": "\"self\" | \"DUPR\" | \"UTR-P\" (optional)",
    "certifications": "string (optional)",
    "location": "string (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach profile updated successfully",
    "data": {
      "id": 1,
      "headline": "Updated Headline",
      "bio": "Updated bio with more experience",
      "experience_years": 12,
      "skill_rating": 4.5,
      "rating_system": "self"
    }
  }
  ```
- **Error responses**: `403` (not a coach), `404` (no coach profile for this user yet), `401`, `500`.

### `PUT /api/coaches/profile/:id` (admin only)
- **Auth**: Required (**admin** role only)
- **Description**: Update **another** user’s coach profile (support / corrections). Path `:id` is that coach’s **user id** (same id used in `GET /api/coaches/:id`). Coaches **cannot** use this route — use **`PUT /api/coaches/me/profile`**.
- **`rating_system`**: Same allow-list as create (**`"self"`** | **`"DUPR"`** | **`"UTR-P"`**) when sent.
- **Request Body** (same as `PUT /api/coaches/me/profile`).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach profile updated successfully",
    "data": {
      "id": 1,
      "headline": "Updated Headline",
      "bio": "Updated bio with more experience",
      "experience_years": 12,
      "skill_rating": 4.5,
      "rating_system": "self"
    }
  }
  ```

### Availability vs lessons
- **Lessons** = *what* the coach offers (e.g. "1hr private", "90min clinic"). Created via `POST /api/lessons`.
- **Availability** = *when* the coach is free (e.g. "Mondays 9am–5pm"). Coaches create/update/delete/list **only their own** rows via **`/api/coaches/me/availability`** (see below). The server sets **`coach_id` from the authenticated user**; clients must **not** send `coach_id` in the URL or body.
- **Browsing another coach’s weekly windows** (student booking): **`GET /api/coaches/:id/availability`** requires a JWT whose effective roles include **`student`** or **`admin`**. **Coach-only** sessions (no `student` in effective roles) get **403**. Users with both `student` and `coach` use the student-capable session to view other coaches’ availability. **Anonymous** callers get **401** (auth required).
- Both are required for booking: the student picks a lesson and a time; the time must fall within the coach's availability and the lesson's constraints.

### `GET /api/coaches/me/availability`
- **Auth**: Required (**Coach** only)
- **Description**: List the authenticated coach’s availability slots. Optional query `page`, `limit` (same pagination contract as `GET /api/coaches/:id/availability`). Owner-scoped only.

### `POST /api/coaches/me/availability`
- **Auth**: Required (**Coach** only)
- **Description**: Create coach availability slot for **the authenticated coach only**. Defines *when* the coach can be booked using a **recurring weekly** row: `weekday` plus time-of-day and optional calendar bounds.
- **Request Body**:
  - **Model**: `weekday` + required **`start_time`** / **`end_time`** (time-of-day only, e.g. `"09:00"`, `"17:00"`). Optional **`start_date`** / **`end_date`** as plain **`YYYY-MM-DD`** strings (no timestamps). Times are interpreted in the **coach's timezone** when validating bookings.
  - `start_date` / `end_date`: Optional **inclusive date range** when this weekly slot applies; omit both for “every week indefinitely”.
  - `weekday`: 0–6 (Sunday–Saturday) or name (e.g. `"monday"`). Evaluated in the **coach's timezone** when checking bookings.
  ```json
  {
    "weekday": "number 0-6 or string (e.g. 'monday')",
    "start_time": "string (required, e.g. '09:00' or '09:00:00')",
    "end_time": "string (required, e.g. '17:00' or '17:00:00')",
    "start_date": "string (optional, YYYY-MM-DD)",
    "end_date": "string (optional, YYYY-MM-DD)"
  }
  ```
- **Example – Mondays 9am–5pm from Feb 1 to Dec 1**: `{ "weekday": "monday", "start_date": "2026-02-01", "end_date": "2026-12-01", "start_time": "09:00", "end_time": "17:00" }`
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Availability created successfully",
    "data": {
      "id": 1,
      "coach_id": 1,
      "weekday": 1,
      "start_time": "09:00:00",
      "end_time": "17:00:00",
      "start_date": "2026-02-01",
      "end_date": "2026-12-01",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/coaches/me/availability/:id`
- **Auth**: Required (**Coach** only)
- **Description**: Update one availability row **you own**. `:id` is the availability **record** id. Body uses the **same fields as POST** (full replacement of that slot’s window fields). Overlap rules match create (cannot overlap another slot for the same weekday and date range).
- **Error responses**: `403` (not coach, or not own row), `404`, `400` (validation / overlap), `500`.

### `GET /api/coaches/:id/availability`
- **Auth**: Required — effective roles must include **`student`** or **`admin`**. Coach-only accounts: **403**. Missing/invalid token: **401**.
- **Description**: Get another coach’s availability for the **student booking** flow (or admin support). Each item includes `weekday`, **`start_time`** / **`end_time`**, and optional **`start_date`** / **`end_date`** as **`YYYY-MM-DD`** (same strings as stored; no datetime columns). Omit `page`/`limit` to return all matching rows (server-capped). Provide `page` or `limit` for paged mode.
- **Query Parameters**: Optional `page`, optional `limit`.
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Availability retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 1,
        "weekday": 1,
        "start_time": "09:00:00",
        "end_time": "17:00:00",
        "start_date": "2026-02-01",
        "end_date": "2026-12-01",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `DELETE /api/coaches/me/availability/:id`
- **Auth**: Required (Coach only)
- **Description**: Delete a coach availability slot (**hard delete**). Coaches can only delete their own availability. `:id` is the availability record id (from `GET /api/coaches/me/availability` or POST create response).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Availability deleted successfully",
    "data": null
  }
  ```
- **Error responses**: `403` (not coach or not own availability), `404` (availability not found), `500` (server error).

**Coach courts workflow**
- **Create courts** (public or private): Use **`POST /api/courts`** only. Body: `name`, `address_line1`, `city`, `state`, `postal_code` (required); optional `country` (default `US`), `latitude`, `longitude`, `is_private` (default false). Free-text **`address` is rejected**. **Shared courts:** identity is `(name, address_line1, city, state, postal_code, country)`. Exact match → **reuse** (restore if soft-deleted) and **link** the coach. Same name / different address → **`409`** `COURT_NAME_CONFLICT`. For **coach-specific link notes**, use **`POST /api/coaches/me/courts`** with `court_id` and **`coach_notes`**. **Distance rule:** If the coach already has other courts, the new/linked court must be within **100 miles** of one of them.
- **Add an existing court to your list**: Use **`POST /api/coaches/me/courts`** when the court already exists. Body: `court_id` (required), optional **`coach_notes`**. If you are **already linked** (for example after **`POST /api/courts`** auto-link), send **`coach_notes`** in the body to **update** link text (**`200`**); without **`coach_notes`**, duplicate link returns **`409`**. **Distance rule:** If the coach already has other courts, the new court must be within **100 miles** of one of them.
- **Remove a court from your profile** (e.g. when moving): Use **`DELETE /api/coaches/me/courts/:courtId`** where **`courtId`** is **`court_locations.id`** (same as **`court_id`** / nested **`court.id`** on **`GET /api/coaches/me/courts`**). This **only** removes your coach–court link; it does **not** delete the shared court or affect other coaches. To remove the court from the marketplace entirely, an **admin** uses **`DELETE /api/courts/:id`**. After unlinking, add courts in the new city and update profile **location**.
- **List your courts**: **`GET /api/coaches/me/courts`** returns all courts linked to the authenticated coach (use **`court_id`** for unlink).
- **List a coach's courts (for students)**: **`GET /api/coaches/:id/courts`** returns courts where a coach teaches. Public; no auth required. Use when a student views a coach's profile to show locations. In the By Flow Postman collection this is **3 – Flow: Student** → **Get Coach Courts**.

### `GET /api/coaches/:id/courts`
- **Auth**: None required
- **Description**: List courts where the given coach teaches. For students viewing a coach's profile before booking. Omit `page`/`limit` to return all matching rows (server-capped). Provide `page` or `limit` for paged mode. **Private courts** (`is_private: true`): structured address fields and `lat`/`lng` are **always redacted** here (`null`), **even if** the caller has a confirmed booking with this coach — use **`GET /api/bookings/:id`** for that booking’s court exact location. `area` (`City, ST ZIP`) is included when available. Students still receive `court_id` for booking selection. Available in Postman under **3 – Flow: Student** (Get Coach Courts).
- **Query Parameters**: Optional `page`, optional `limit`.
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Courts retrieved successfully",
    "data": [
      {
        "court_id": 4,
        "name": "Central Park Pickleball",
        "address_line1": "123 Park Ave",
        "city": "Miami",
        "state": "FL",
        "postal_code": "33101",
        "country": "US",
        "area": "Miami, FL 33101",
        "lat": 25.78,
        "lng": -80.19,
        "is_private": false
      },
      {
        "court_id": 9,
        "name": "Private Club Court",
        "address_line1": null,
        "city": null,
        "state": null,
        "postal_code": null,
        "country": null,
        "area": "Coral Springs, FL 33065",
        "lat": null,
        "lng": null,
        "is_private": true
      }
    ]
  }
  ```
- **Error responses**: `400` (invalid coach id), `404` (coach not found).

### `GET /api/coaches/me/courts`
- **Auth**: Required (coach only)
- **Description**: List courts associated with the authenticated coach. Omit `page`/`limit` to return all matching rows (server-capped). Provide `page` or `limit` for paged mode.
- **Query Parameters**: Optional `page`, optional `limit`.
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Courts retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 2,
        "court_id": 1,
        "coach_notes": "My home base",
        "created_at": "...",
        "updated_at": "...",
        "court": {
          "id": 1,
          "name": "Central Park Pickleball Court",
          "address_line1": "123 Main St",
          "city": "New York",
          "state": "NY",
          "postal_code": "10001",
          "country": "US",
          "latitude": 40.7,
          "longitude": -74.0,
          "is_private": false
        }
      }
    ]
  }
  ```

### `GET /api/coaches/me/lessons`
- **Auth**: Required (coach only)
- **Description**: **Coach dashboard inventory** — lessons owned by the authenticated coach (includes **inactive**; excludes soft-deleted). Not marketplace discovery.
- **DTO contract**: Owner inventory shape — `id`, `coach_id`, `title`, `description`, `duration_minutes`, `price`, `effective_hourly_rate`, `max_students`, `is_active`, `created_at`. **No** nested `coach` (caller is the owner). **No** `deleted_at` / `updated_at`.
- **Query Parameters**: Optional `page`, optional `limit`.
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "My lessons retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 2,
        "title": "Beginner Pickleball Lesson",
        "description": "Learn the basics of pickleball",
        "duration_minutes": 60,
        "price": "50.00",
        "effective_hourly_rate": 50,
        "max_students": 4,
        "is_active": true,
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `POST /api/coaches/me/courts`
- **Auth**: Required (coach only; admins cannot add courts to their profile)
- **Description**: Link an **existing** court to the coach's available courts. Does not create a new court; use `POST /api/courts` to create courts (coaches are auto-linked when they create). If the coach is **already linked** to that `court_id`, the request **`409`**s unless the body includes a **`coach_notes`** property — then the server **updates** `coach_court_locations.coach_notes` only and returns **`200`** (same `data` shape as create). **`coach_notes`** is optional free text the coach stores on the coach–court relationship (not shown on public `GET /api/coaches/:id/courts`).
- **Request Body**:
  ```json
  {
    "court_id": "number (required)",
    "coach_notes": "string (optional)"
  }
  ```
- **Response** (Status: **201** — new link):
  ```json
  {
    "success": true,
    "message": "Court added successfully",
    "data": {
      "coachCourt": {
        "id": 1,
        "coach_id": 2,
        "court_id": 1,
        "coach_notes": "My home base",
        "created_at": "...",
        "updated_at": "..."
      },
      "court": {
        "id": 1,
        "name": "Central Park Pickleball Court",
        "address_line1": "123 Main St",
        "city": "New York",
        "state": "NY",
        "postal_code": "10001",
        "country": "US",
        "latitude": 40.7128,
        "longitude": -74.006,
        "is_private": false
      }
    }
  }
  ```
- **Response** (Status: **200** — already linked; body included **`coach_notes`**): same `data` shape as above; `message`: `Coach court link updated`.
- **Error responses**: `400` (court_id missing or invalid; or court more than 100 miles from your existing courts), `404` (court not found), `409` (already linked and request omitted **`coach_notes`**).

### `DELETE /api/coaches/me/courts/:courtId`
- **Auth**: Required (coach only)
- **Description**: **Unlink only** — removes your **`coach_court_locations`** row for this **`courtId`**. Does **not** soft-delete **`court_locations`** and does **not** affect other coaches. **`courtId`** = **`court_locations.id`** (same as **`court_id`** on each item from **`GET /api/coaches/me/courts`**).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court removed from your profile",
    "data": {
      "court_id": 12,
      "name": "Central Park Pickleball Court"
    }
  }
  ```
- **Response `data`**: `court_id` — `court_locations.id` that was unlinked; `name` — court display name at unlink time (null only if unexpectedly unavailable).
- **Error responses**: `400` (invalid **`courtId`**), `403` (not a coach), `404` (court not found / deleted globally, or you are not linked to this court).

### `GET /api/coaches/me/marketplace-status`
- **Auth**: Required (**coach** or **admin**). Admins may pass `?coach_id=` to inspect another coach.
- **Description**: Checklist for whether this coach appears in student discovery (`GET /api/coaches`). Separate from coach **dashboard readiness** (role + profile + Stripe started).
- **Stripe**: If the coach has a Connect account id, this endpoint **may** call Stripe once to refresh local `stripe_ready` — unlike discovery, which never calls Stripe.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Marketplace status retrieved successfully",
    "data": {
      "listed": false,
      "missing": ["availability", "stripe"],
      "steps": {
        "profile": true,
        "stripe": false,
        "lesson": true,
        "court": true,
        "availability": false
      }
    }
  }
  ```
- **Steps**: `profile`, `stripe` (`stripe_ready`), `lesson`, `court`, `availability` (≥1 row). `listed` is true only when `missing` is empty.

### `POST /api/coaches/me/stripe-connect/onboard`
- **Auth**: Required
- **Description**: Initiate **or resume** Stripe Connect onboarding for coach payouts. The Connect account is created exactly once (`stripe_account_id` stored with **`stripe_ready: false`**). Stripe Account Links are single-use and expire (~5 min), so while onboarding is unfinished every call mints a **fresh `onboarding_url`** for the existing account — abandoned/expired links are never a dead end. Returns `409` only when onboarding is already complete (`stripe_ready: true`).
- **Request Body**:
  ```json
  {
    "coach_id": "number (optional, admin only - defaults to authenticated user's ID)"
  }
  ```
- **Response** (Status: **201** first call / **200** resume):
  ```json
  {
    "success": true,
    "message": "Stripe Connect onboarding initiated successfully",
    "data": {
      "account_id": "acct_...",
      "onboarding_url": "https://connect.stripe.com/setup/e/acct_.../...",
      "expires_at": 1234567890
    }
  }
  ```
- **Error responses**: `409` when `stripe_ready` is already true (message: "Stripe Connect onboarding is already complete").

### `GET /api/coaches/me/stripe-connect/status`
- **Auth**: Required
- **Description**: Check Stripe Connect onboarding status and **sync** local `coach_profiles.stripe_ready` (`payouts_enabled` + `details_submitted`). That flag drives marketplace discovery.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Stripe Connect status retrieved",
    "data": {
      "onboarded": true,
      "account_id": "acct_...",
      "charges_enabled": true,
      "payouts_enabled": true,
      "details_submitted": true,
      "stripe_ready": true
    }
  }
  ```
---

## Students (`/api/students`)

### `GET /api/students/me/reliability`
- **Auth**: Required (**student** role only).
- **Description**: Same purpose as **`GET /api/coaches/me/reliability`**, for the authenticated **student**: curated penalized-impact reliability breakdown + score (no persistence/engine internals).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Student reliability retrieved successfully",
    "data": {
      "reliability": {
        "reliability_score": 96.0,
        "score_source": "computed",
        "total_bookings": 8,
        "late_cancels": 0,
        "misconduct_penalties": 0,
        "lesson_not_completed_penalties": 0,
        "no_shows": 0,
        "coach_cancels": 0,
        "student_cancels_non_late": 2,
        "last_updated": "2026-03-16T18:42:26.000Z"
      }
    }
  }
  ```
- **Error responses**: `400` (user is not a student), `401`, `500`.

### `GET /api/students/me/bookings`
- **Auth**: Required (**student** role only). Coach-only sessions receive **403**. Dual-role users with **student** may call this endpoint.
- **Description**: **Student dashboard** — list bookings where the authenticated user is the **primary student** (`primary_student_id = me` only). Does **not** include bookings where the user is only the coach.
- **Contrast**:
  - `GET /api/coaches/me/bookings` — bookings where the user is the coach
- **DTO contract**: Same booking list DTO as coach inbox (`serializeBookingListItem`). **`primaryStudent.reliability_score` is not included** (student viewer).
- **Query Parameters**: status, optional `page`, optional `limit` (omit both for all matching rows; provide either to paginate)
- **Pagination contract**: Same as other booking list endpoints.

---

## Courts (`/api/courts`)

**Court field notes (MVP)**

`is_private` is a **discovery flag**, not a permissions flag. It does **not** mean invitation-only, restricted booking access, or that customers cannot see the court.

**Address visibility (separate from discovery):** Exact structured address (`address_line1`, `city`, `state`, `postal_code`, `country`) and GPS for **`is_private: true`** courts are revealed **only on booking endpoints**, and only when that booking’s status allows it (**`confirmed`** or later: `awaiting_verification`, `completed`, no-shows, `disputed`).

| Endpoint | Student before confirm | Student after confirm |
|----------|------------------------|------------------------|
| `GET /api/coaches/:id/courts` (and marketplace coach `courts[]`) | Private address hidden | **Still hidden** — discovery/selection surface; no booking context |
| `GET /api/bookings/:id` | Hidden | Visible **for that booking’s court only** |
| Student/coach booking lists (`…/bookings`) | Hidden | Visible for confirmed+ rows that include `courtLocation` |

Before confirmation (browse, intent, authorized/`pending`), students see `name`, `area` (`City, ST ZIP` from structured fields), optional `distance_miles`, and `is_private` — with structured address fields and coordinates `null`. **Public** courts (`is_private: false`) always expose the full structured address. **Coaches** (own courts / booking coach) and **admins** always see exact location. MVP maps “address_visibility = booking_confirmed” onto `is_private` in DTO logic (no separate DB column yet). `cancelled` and `pending` do **not** unlock exact private addresses (avoids leaking home addresses on declined/expired requests). Do **not** unlock all of a coach’s private courts just because the student has one confirmed booking — that would expose unrelated teaching locations.

| Field | Where | MVP behavior |
|-------|--------|----------------|
| `is_private` | `court_locations` | Coach sets at create (`POST /api/courts`). When `true`, the court is **hidden from public court discovery** only (`GET /api/courts`, `GET /api/courts/:id` — returns **`404`** on by-id lookup, same as missing). **`is_private` affects only public court discovery.** Once a court is linked to a coach, it remains available for coach profiles, marketplace eligibility, and booking regardless of its privacy setting. Coach-profile court lists (`GET /api/coaches/:id/courts`, `GET /api/coaches/me/courts`), booking payloads, and admin coach-court tools still expose the court row (exact address may be redacted for students — see above). |
| `rate_modifier` | `coach_court_locations` | **Reserved** for future per-court pricing (`booking_price = lesson.price * rate_modifier`). Stored in DB; **not** exposed on coach/student APIs until pricing ships. Admin endpoints may include it for support. |
| `coach_notes` | `coach_court_locations` | Coach-specific notes on the coach–court relationship. **Only** via `POST /api/coaches/me/courts` (and returned on `GET /api/coaches/me/courts`). **`POST /api/courts` rejects `coach_notes` or legacy `notes`** — court creation is court entity only. |
| `created_by_user_id` | `court_locations` | Internal ownership for delete authorization; not returned on public court endpoints. |

### `GET /api/courts`
- **Auth**: None required
- **Description**: **Public directory only** — returns courts with **`is_private: false`** and **`deleted_at: null`** only (courts with `is_private: true` are hidden from this shared catalog, not from coach/booking surfaces). **List all** when **lat** and **lng** are omitted. **No `page` and no `limit`** → return **all** matching courts in `data` (server-capped at **10,000** for safety). **Either `page` or `limit`** (or both) → **paginated** list (`data` + `pagination`); per-page max **100**. **Search near a point** when both **lat** and **lng** are provided (bounding box + **radius** in miles, default 10); results are ordered **closest to the search point first** (Haversine). If no courts match, may **lazy-import** from OpenStreetMap and re-query (still distance-ordered, up to 100 rows; re-fetch also excludes courts hidden from public discovery).
- **Query Parameters**:
  - **List all**: `page`, `limit` — optional; omit both to fetch the full capped list (no `pagination` object).
  - **Geo search**: `lat`, `lng` (both required together), `radius` (miles, default 10, max 100).
- **Response** (Status: 200):
  - **List all, no pagination** (`no lat/lng`, no `page`/`limit`): `{ success, message, data: [...] }` (array only).
  - **List all, paginated** (`no lat/lng`, with `page` and/or `limit`):
  ```json
  {
    "success": true,
    "message": "Courts retrieved successfully",
    "data": [ { "id": 1, "name": "...", "address_line1": "...", "city": "...", "state": "...", "postal_code": "...", "country": "US", "latitude": 40.7128, "longitude": -74.006, "is_private": false } ],
    "pagination": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 }
  }
  ```
  - **Geo search** (`lat` + `lng`): non-paginated array in `data` (up to 100 courts), **closest first**, same court shape as above.

### `GET /api/courts/:id`
- **Auth**: None required
- **Description**: Get court details by ID (**public directory only**). Courts with **`is_private: true`** are **hidden from public discovery** here: response is **`404`** with the same **`Court not found`** shape as a missing or deleted id (the API does **not** indicate that the row exists). Use **`GET /api/coaches/:id/courts`** (or **`GET /api/coaches/me/courts`**) to see courts a coach teaches at, including locations hidden from the public directory.
- **Error responses**: **`400`** (invalid id), **`404`** (not found, deleted, or hidden from public discovery).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court retrieved successfully",
    "data": {
      "id": 1,
      "name": "Central Park Pickleball Court",
      "address_line1": "123 Main St",
      "city": "New York",
      "state": "NY",
      "postal_code": "10001",
      "country": "US",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "is_private": false,
      "source": "manual",
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/courts`
- **Auth**: Required (Coach or Admin only)
- **Description**: Create **or reuse** a shared court location (**`court_locations`**). **Structured address required** (`address_line1`, `city`, `state`, `postal_code`; `country` defaults to `US`). Free-text **`address` is rejected** (`400`). **Identity / uniqueness:** `(name, address_line1, city, state, postal_code, country)`. Exact match (including **soft-deleted**) is **reused** — restores `deleted_at` when needed — and shared fields are **never overwritten**. **Same name, different address** (active courts) → **`409`** `COURT_NAME_CONFLICT`. **Different name, same address** is allowed (multiple courts at one venue). **Coaches:** also creates (or finds) a `coach_court_locations` link (`coach_id` + `court_id` only; no `coach_notes` on this path). Status: **`201`** when the court or coach link is newly created; **`200`** when already linked. Admins are not auto-linked: **`201`** on create, **`200`** on reuse/restore. **Distance rule (coaches):** If you already have other courts, the target court must be within **100 miles** of one of them. To add or change **`coach_notes`**, call **`POST /api/coaches/me/courts`** with `court_id` and **`coach_notes`**. **Rejected input:** **`coach_notes`**, legacy **`notes`**, or free-text **`address`**. US MVP: `state` / `country` must be 2 letters; `postal_code` must be `12345` or `12345-6789`.
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "address_line1": "string (required)",
    "city": "string (required)",
    "state": "string (required, 2-letter US)",
    "postal_code": "string (required, 12345 or 12345-6789)",
    "country": "string (optional, default US)",
    "latitude": "number (optional)",
    "longitude": "number (optional)",
    "is_private": "boolean (optional, defaults to false)"
  }
  ```
- **Response** (Status: 201) — **coach** (new court or newly linked existing court):
  ```json
  {
    "success": true,
    "message": "Court created successfully",
    "data": {
      "court": {
        "id": 1,
        "name": "Central Park Pickleball Court",
        "address_line1": "123 Main St",
        "city": "New York",
        "state": "NY",
        "postal_code": "10001",
        "country": "US",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "is_private": false
      },
      "coachCourt": {
        "id": 10,
        "coach_id": 2,
        "court_id": 1,
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z"
      }
    }
  }
  ```
- **Response** (Status: 201) — **admin** (court object only; no coach link):
  ```json
  {
    "success": true,
    "message": "Court created successfully",
    "data": {
      "id": 1,
      "name": "Central Park Pickleball Court",
      "address_line1": "123 Main St",
      "city": "New York",
      "state": "NY",
      "postal_code": "10001",
      "country": "US",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "is_private": false,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```
- **Error responses**: For coaches with existing courts, `400` if the target court is more than 100 miles from all of your existing courts. **`400`** if the body includes **`coach_notes`**, **`notes`**, or legacy free-text **`address`**. **`409`** `COURT_NAME_CONFLICT` if an active court with the same **name** already exists at a **different address**. Exact-identity duplicates are reused/linked (or restored if soft-deleted), not rejected.

### `DELETE /api/courts/:id`
- **Auth**: Required (**Admin only**)
- **Description**: **Global soft delete** of a **`court_locations`** row (`deleted_at`). The court no longer appears in the **public directory** (`GET /api/courts`, `GET /api/courts/:id`) or coach geo search that relies on non-deleted courts. **All** **`coach_court_locations`** rows for this court are removed (every coach loses this court from their profile). Coaches **cannot** call this route — they use **`DELETE /api/coaches/me/courts/:courtId`** to unlink themselves only.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court deleted successfully",
    "data": null
  }
  ```
- **Error responses**: `403` (not admin — message: only admins can delete courts globally), `404` (court not found or already deleted), `500` (server error).

---

## Lessons (`/api/lessons` + coach-scoped discovery)

**Coach-first marketplace:** Students browse **coaches**, then that coach’s **lessons**. There is no public lesson catalog.

| Flow | Endpoint |
|------|----------|
| Marketplace offerings for one coach | **`GET /api/coaches/:id/lessons`** |
| Coach dashboard inventory | **`GET /api/coaches/me/lessons`** |
| Admin inventory | **`GET /api/admin/lessons`** |
| Owner/admin resource by id | **`GET /api/lessons/:id`** (authenticated; not discovery) |
| ~~Lesson-first catalog~~ | **`GET /api/lessons`** → **`410 Gone`** |

**Pricing**: `price` is the **total** charged for one booking of that lesson (for its `duration_minutes`). It is the billing source of truth (bookings copy this amount). API responses also include read-only **`effective_hourly_rate`** (USD/hr): `price / (duration_minutes / 60)`. Lesson model has no `updated_at` — never returned.

**Response DTOs** (`utils/lessonDto.js`):

| Audience | Serializer | Endpoints |
|----------|------------|-----------|
| Marketplace | `serializePublicMarketplaceLesson` | `GET /api/coaches/:id/lessons`, `GET /api/coaches/:id` lesson embed |
| Coach owner | `serializeCoachOwnerLesson` | `GET /api/coaches/me/lessons`, `POST/PUT /api/lessons` |
| Admin list | `serializeAdminLesson` | `GET /api/admin/lessons` |
| Detail | `serializeLessonDetail` | `GET /api/lessons/:id` (owner vs admin coach nest) |

**Lifecycle** (`deleted_at` soft-delete):

| API category | Endpoints | Deleted lessons |
|--------------|-----------|-----------------|
| Marketplace discovery | `GET /api/coaches/:id/lessons`, coach profile lesson embed | Hidden (`404` or empty) |
| Coach inventory | `GET /api/coaches/me/lessons` | Omitted (not deleted) |
| Admin inventory | `GET /api/admin/lessons` | Excluded by default; pass `include_deleted=true` |
| Historical context | booking list/detail endpoints | Nested `lesson` allowed on existing bookings |
| Mutations | `PUT /api/lessons/:id`, `DELETE /api/lessons/:id` | **`404`** — not editable after delete |

**Inactive** (`is_active: false`, not deleted) = recoverable via coach APIs. **Deleted** = no longer a listing; row kept for booking history only.

### `GET /api/coaches/:id/lessons`
- **Auth**: Required (`student`, `coach`, or `admin`) — marketplace browse (viewing ≠ booking; booking still requires **student** role).
- **Description**: Public offerings for one coach. Returns **active**, **non-deleted** lessons only when the coach is **marketplace-eligible** (same checklist as `GET /api/coaches`). Non-listable coaches → **`404`** (same as missing). This is the student lesson-discovery endpoint.
- **DTO contract**: Public marketplace fields only — `id`, `coach_id`, `title`, `description`, `duration_minutes`, `price`, `effective_hourly_rate`, `max_students`. **Omits** `is_active`, `deleted_at`, timestamps, nested `coach`, and bookings.
- **Query Parameters**: optional `page`, `limit`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Lessons retrieved successfully",
    "data": [
      {
        "id": 29,
        "coach_id": 37,
        "title": "Beginner Pickleball",
        "description": "Learn the basics",
        "duration_minutes": 60,
        "price": "60.00",
        "effective_hourly_rate": 60,
        "max_students": 1
      }
    ]
  }
  ```

### `GET /api/lessons`
- **Auth**: None
- **Status**: **`410 Gone`** — lesson-first catalog removed. Use **`GET /api/coaches/:id/lessons`**, **`GET /api/coaches/me/lessons`**, or **`GET /api/admin/lessons`**.
- **Error body**: `code: lesson_catalog_removed`.

### `GET /api/lessons/:id`
- **Auth**: Required. **Owner coach** or **admin** only — **not** marketplace discovery.
- **Description**: Resource access for managing a lesson or admin support. Students must use **`GET /api/coaches/:id/lessons`** (or booking payloads after booking). **Does not** embed booking history — use booking list/detail endpoints.

  | Caller | Active | Inactive | Soft-deleted |
  |--------|--------|----------|--------------|
  | Owner coach | ✅ | ✅ | ❌ **404** |
  | Admin | ✅ | ✅ | ✅ |
  | Student / other | ❌ **403** | ❌ **403** | ❌ **403** |

- **DTO contract**:
  - **Owner**: `id`, `coach_id`, `title`, `description`, `duration_minutes`, `price`, `effective_hourly_rate`, `max_students`, `is_active`, `deleted_at`, `created_at` — **no** nested `coach`.
  - **Admin**: same fields + nested `coach` `{ id, full_name, email, is_active, deleted_at }`.
- **Error responses**: **`401`**, **`403`** (`lesson_detail_not_for_discovery`), **`404`**.
- **Response** (Status: 200, owner):
  ```json
  {
    "success": true,
    "message": "Lesson retrieved successfully",
    "data": {
      "id": 1,
      "coach_id": 2,
      "title": "Beginner Pickleball Lesson",
      "description": "Learn the basics of pickleball",
      "duration_minutes": 60,
      "price": "50.00",
      "effective_hourly_rate": 50,
      "max_students": 4,
      "is_active": true,
      "deleted_at": null,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/lessons`
- **Auth**: Required (**Coach only** — admins do not create lessons; they moderate via `PUT` / `DELETE /api/lessons/:id`)
- **Description**: Create a new lesson owned by the authenticated coach (`coach_id` = JWT user)
- **Request Body**:
  ```json
  {
    "title": "string (required, 3-255 chars)",
    "description": "string (optional)",
    "duration_minutes": "number (required, 15-480)",
    "price": "number (required, positive)",
    "max_students": "number (optional, 1-20, defaults to 1)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Lesson created successfully",
    "data": {
      "id": 1,
      "coach_id": 2,
      "title": "Beginner Pickleball Lesson",
      "description": "Learn the basics of pickleball",
      "duration_minutes": 60,
      "price": "50.00",
      "effective_hourly_rate": 50,
      "max_students": 4,
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/lessons/:id`
- **Auth**: Required
- **Description**: Update lesson (coach owner or admin). Optional **`is_active`** toggles marketplace visibility without deleting: **`false`** hides from public list, coach profile lesson embed, and **`GET /api/lessons/:id`** for non-owners; owner/admin can still load by id and edit. **`404`** if the lesson is soft-deleted (`deleted_at` set) — use booking history for archived titles; archived coach list may be added later. **`DELETE /api/lessons/:id`** soft-archives (`deleted_at` + **`is_active: false`**).
- **Error responses**: **`404`** — missing id or soft-deleted lesson.
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "title": "string (optional)",
    "description": "string (optional)",
    "duration_minutes": "number (optional)",
    "price": "number (optional)",
    "max_students": "number (optional)",
    "is_active": "boolean (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Lesson updated successfully",
    "data": {
      "id": 1,
      "coach_id": 2,
      "title": "Updated Lesson Title",
      "description": "Updated description",
      "duration_minutes": 90,
      "price": "55.00",
      "effective_hourly_rate": 36.67,
      "max_students": 6,
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `DELETE /api/lessons/:id`
- **Auth**: Required
- **Description**: Soft-delete lesson (`deleted_at`, `is_active: false`). Row kept for booking history (nested `lesson` on booking GETs). **Not** returned on lesson discovery or coach lesson list; **`PUT`** / **`DELETE`** also return **`404`** if already deleted. Use **`is_active: false`** via **`PUT`** when the coach may need to view or reactivate later without deleting.
- **Error responses**: **`404`** — missing id or already soft-deleted.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Lesson deleted successfully",
    "data": null
  }
  ```

---

## Bookings (`/api/bookings`)

**Authorize-first booking flow (MVP)**

| Step | Method | Path | Who |
|------|--------|------|-----|
| 1 | `POST` | `/api/booking-intents` | **Student** — validate lesson + slot; create Stripe PaymentIntent (manual capture). No booking row yet. |
| 2 | *(client)* | Stripe.js / mobile SDK | Student authorizes card (`requires_capture`). |
| 3 | `POST` | `/api/bookings/confirm` | **Student** — verify authorization; re-check availability; create booking (`pending`) + payment (`authorized`). |
| 4 | `PUT` | `/api/bookings/:id/accept` | **Coach only** — capture funds and confirm booking. |
| 5 | `PUT` | `/api/bookings/:id/decline` | **Coach only** — void authorization; booking cancelled. |

**Booking lists are role-dashboard only** (matches Student Mode / Coach Mode in the client; the API does not store active role):

| Method | Path | Scope |
|--------|------|-------|
| `GET` | `/api/students/me/bookings` | `primary_student_id = me` |
| `GET` | `/api/coaches/me/bookings` | `coach_id = me` |
| `GET` | `/api/bookings/:id` | Detail for an authorized participant |
| `GET` | `/api/admin/bookings` | Admin list (optional filters) |

There is **no** `GET /api/bookings` combined participant list.

`POST /api/bookings` (legacy create) returns **410 Gone** with code `booking_create_deprecated_use_intent_flow`. Use the intent + confirm flow instead.

See `backend/docs/MIGRATION_AUTHORIZE_FIRST_BOOKING.md` for migration notes.

**Pending meaning:** `pending` = waiting for **coach acceptance**, not payment authorization. New bookings are only created after Stripe authorization succeeds.

**Coach notification:** After successful `POST /api/bookings/confirm`, the API notifies the coach (in-app + email when SendGrid is configured).

**Coach acceptance timeout:** If the coach does not accept or decline within **`COACH_ACCEPTANCE_TIMEOUT_HOURS`** (default **24**, alias `PENDING_BOOKING_EXPIRY_HOURS`), a worker cancels the booking (`cancelled_by: system`), voids the uncaptured PaymentIntent, and frees the slot. This applies to **authorized** pending bookings only — it is a marketplace responsiveness rule, not a payment-authorization timeout. Runs every 15 minutes when workers are enabled.

Admins and students get **403** on accept/decline.

### Booking Status Reference (Meaning + Cancellation Rules)

Use this table as the source of truth for practical status meaning and whether **cancellation via the shared cancel API** is allowed. **Cancellation** means `POST /api/bookings/:id/cancel` or `POST /api/admin/bookings/:id/cancel` — same rules; admin cancel sets `cancelled_by: admin` and does not apply reliability penalties.

Only **`pending`** and **`confirmed`** are cancellable through these endpoints (and only while **`scheduled_at` is still in the future** for `confirmed`). All other statuses receive **400** with a status-specific or generic `code` (e.g. `cancel_pre_lesson_only`, `booking_in_post_lesson_phase`, `lesson_started_cancellation_unavailable`, `disputed_use_dispute_flow`). Post-lesson money or outcomes use **other** routes (`POST /api/bookings/:id/complete`, student/coach no-show, `POST /api/disputes`, `PUT /api/disputes/:id/resolve`, `POST /api/admin/bookings/:id/refund`, auto-complete worker, etc.).

| Status | Practical meaning | Typically set by | Cancellable via cancel API? | Why / guardrail |
|--------|-------------------|------------------|----------------------------|-----------------|
| `pending` | Student confirmed authorization; waiting for coach decision | `POST /api/bookings/confirm` | **Yes** (student, coach on booking, or admin) | Pre-lesson; payment already `authorized`; cancel voids or refunds per policy |
| `confirmed` | Coach accepted; lesson not yet ended (or still in coach-action window before worker moves it) | `PUT /api/bookings/:id/accept` | **Yes** (same callers), only while **`scheduled_at` is still in the future** | Pre-lesson; same **`payment_actions`**-backed cancel refund path as **`pending`**. After lesson start → **400** `lesson_started_cancellation_unavailable` |
| `awaiting_verification` | Lesson **end** time has passed while still `confirmed`; worker moved booking here until coach marks complete / no-show or **auto-complete** runs (**24h after lesson end**) | Background worker (`autoConfirmWorker`, ~every 5 min): `confirmed` → `awaiting_verification` when `scheduled_at + duration` ≤ now (typically 0-5 minutes after lesson end when workers are healthy) | **No** | **400** `booking_in_post_lesson_phase` — use complete, no-show, or dispute workflows. **No coach payout** while in this status — escrow stays held until `completed` (or `student_no_show`) |
| `completed` | Lesson treated as completed (coach `POST .../complete`, or auto worker **24h after lesson end** if still `awaiting_verification` and no open dispute) | Coach or `autoConfirmWorker` | **No** | Terminal. Coach payout eligible via **`payoutWorker`** (~every 10 min) once `payout_status` is `pending` and guards pass |
| `cancelled` | Booking cancelled | `POST .../cancel`, coach decline, coach acceptance timeout worker, etc. | **No** | Terminal |
| `disputed` | Chargeback / dispute workflow tied to payment (e.g. Stripe dispute sync may set this on the booking) | `stripeDisputeSyncService` (webhook path); seeds/tests | **No** | Cancel endpoint rejects; resolve dispute and handle funds via documented dispute/refund flows |
| `student_no_show` | Primary **student** did not attend | `POST .../student-no-show` (coach or admin) | **No** | Terminal attendance outcome; **not** reversible via cancel (no `reason_notes` token path). Coach payout is eligible; adjust with dispute/admin override if contested |
| `coach_no_show` | **Coach** did not attend | `POST /api/admin/bookings/:id/coach-no-show` | **No** | Terminal attendance outcome; cancel endpoint does not apply |

The sections below document the **authorize-first write flow** first, then **beyond MVP** (list, detail, cancel).

## Booking intents (`/api/booking-intents`)

### `POST /api/booking-intents` (MVP — student)
- **Auth**: Required (email must be verified); **student** role.
- **Description**: Validate lesson, **coach court**, schedule, and availability (no slot reservation). Create a manual-capture Stripe PaymentIntent. **No booking row is created.** After the client authorizes the card, call `POST /api/bookings/confirm`.
- **MVP product model**: Student buys a **fixed lesson package** (`lessons.price` + `lessons.duration_minutes`). No hourly billing. No student duration override. JWT user becomes `primary_student_id` (do not send user ids).
- **Request Body**:
  ```json
  {
    "lesson_id": 14,
    "scheduled_at": "2026-07-01T15:00:00.000Z",
    "court_location_id": 58,
    "payment_method": "stripe",
    "payment_method_id": "pm_xxx",
    "idempotency_key": "optional-client-key"
  }
  ```
  - **Required**: `lesson_id`, `scheduled_at` (ISO, future), `court_location_id` (must exist, not deleted, and linked to the lesson’s coach via `coach_court_locations`).
  - **Optional**: `payment_method` (default `stripe`; also `card` | `apple_pay` | `google_pay`), `payment_method_id`, `idempotency_key` (or `Idempotency-Key` header).
  - **Forbidden (400)**: `duration_minutes` (lesson owns duration), `player_ids` (MVP is one student).
- **Pricing**: Charge = listed lesson price (`calculatePaymentAmounts(lesson.price)` → `total_charge_to_student` equals lesson). Platform retains ~8% of the lesson as internal commission; coach expected payout ~92% of lesson. Student is **not** charged an add-on fee. Display-only `effective_hourly_rate` on lessons does not affect checkout.
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Booking authorization created.",
    "data": {
      "client_secret": "pi_..._secret_...",
      "payment_intent_id": "pi_...",
      "lesson_id": 14,
      "scheduled_at": "2026-07-01T15:00:00.000Z",
      "duration_minutes": 60,
      "court_location_id": 58,
      "amount": 50,
      "amount_cents": 5000,
      "currency": "usd"
    }
  }
  ```
  - `duration_minutes` in the response is always **`lesson.duration_minutes`**.
  - **`amount`**: total charge to the student in **USD dollars** (listed lesson price; e.g. `50` for a $50 lesson). This is **not** Stripe’s integer unit — do not pass `amount` to Stripe APIs that expect cents.
  - **`amount_cents`**: same total in **Stripe smallest currency units** (e.g. `5000` for $50.00 USD). Matches PaymentIntent `amount`.
  - **`currency`**: lowercase ISO code (`usd`).
- **Intended client flow**: view coach → pick lesson → pick time → pick one of coach’s courts → intent → Stripe authorize → confirm.
### `POST /api/bookings/confirm` (MVP — student)
- **Auth**: Required (email must be verified)
- **Description**: After Stripe authorization (`requires_capture`), creates the booking and payment in one transaction. Re-checks slot availability; on conflict cancels the PaymentIntent and returns **409** `slot_no_longer_available`. Idempotent per `payment_intent_id`.
- **Request Body**:
  ```json
  {
    "payment_intent_id": "pi_xxx"
  }
  ```
- **Response** (Status: 201, or 200 on idempotent replay):
  ```json
  {
    "success": true,
    "message": "Booking created successfully",
    "data": {
      "booking": {
        "id": 1,
        "lesson_id": 1,
        "status": "pending",
        "scheduled_at": "2026-07-01T15:00:00.000Z"
      },
      "payment": {
        "payment_status": "authorized",
        "payment_intent_id": "pi_..."
      }
    }
  }
  ```
- **Errors**: `400` `payment_intent_not_authorized`, `403` `payment_intent_not_owned`, `409` `slot_no_longer_available`

### `POST /api/bookings` (deprecated)
- **Status**: **410 Gone** — `booking_create_deprecated_use_intent_flow`
- **Description**: Replaced by `POST /api/booking-intents` + client authorization + `POST /api/bookings/confirm`.

### `PUT /api/bookings/:id/accept` (MVP — coach only)
- **Auth**: Required
- **Description**: The assigned coach confirms a **pending** booking, captures payment when applicable, and moves the booking toward **confirmed**. Admins and students receive 403.
- **Request Body**: None required (empty body is fine).
- **Response** (Status: 200): Booking object with related lesson/coach/student (same shape as get-by-id summary fields).

### `PUT /api/bookings/:id/decline` (MVP — coach only)
- **Auth**: Required
- **Description**: The assigned coach declines a **pending** booking; cancels the PaymentIntent so the student is not charged. Admins and students receive 403.
- **Request Body**:
  ```json
  {
    "message_to_student": "Unfortunately this time no longer works for me. Please choose another slot.",
    "decline_reason_code": "availability_conflict"
  }
  ```
  - `message_to_student` — required, 10–500 chars (shown to the student).
  - `decline_reason_code` — optional enum for analytics: `availability_conflict`, `sickness`, `weather`, `outside_service_area`, `lesson_not_fit`, `other`. Invalid values return **400**.
- **Response** (Status: 200): Booking object with related lesson/coach/student (same shape as accept/get-by-id). Decline fields on the booking: `declined_at`, `decline_message_to_student`, `decline_reason_code`, `status: cancelled`, `cancelled_by: coach`. Client displays `decline_message_to_student` directly; no duplicate top-level message fields.
- **Student notification** (`booking_declined`, in-app + email when configured): payload includes `decline_reason_code`, `message_to_student`, plus display helpers `headline`, `summary` (one sentence for the bell), and `reason_line`. Extra detail stays in structured fields — not stuffed into `summary`.

---

### Beyond MVP

### `GET /api/bookings/:id`
- **Auth**: Required
- **Description**: Get booking details by ID (participant access). Admin must use `GET /api/admin/bookings/:id`. Includes **`conversation`** summary (`id`, `can_send_messages`, `message_count`) so the client knows chat availability without extra round trips.
- **List endpoints (role dashboards)**: There is **no** participant-wide `GET /api/bookings` list. Use **`GET /api/students/me/bookings`** (student mode) or **`GET /api/coaches/me/bookings`** (coach mode).
- **DTO contract**: Summary fields plus lifecycle fields (`attendance_finalized`, `cancelled_by`, `cancelled_at`, `payout_status`, decline fields, `created_at`, `updated_at`). Nested **`lesson`**, **`coach`**, **`primaryStudent`**, **`courtLocation`**, **`payments[]`**, optional **`cancellationHistory`**, **`conversation`**. **No `players` array** — MVP is one student (`primary_student_id` / `primaryStudent`) per booking; group attendees are V2. **`payments[]`** uses the participant payment DTO (no Stripe IDs / `metadata`); admin routes include Stripe reconciliation fields on payments. When the viewer is the booking’s coach, **`primaryStudent.reliability_score`** is included (score only — see coach inbox list docs).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Booking retrieved successfully",
    "data": {
      "id": 1,
      "lesson_id": 1,
      "coach_id": 2,
      "primary_student_id": 1,
      "scheduled_at": "2026-02-01T10:00:00.000Z",
      "duration_minutes": 60,
      "price": 50.00,
      "status": "pending",
      "conversation": {
        "id": null,
        "can_send_messages": false,
        "message_count": 0
      },
      "lesson": {
        "id": 1,
        "title": "Beginner Pickleball Lesson"
      },
      "coach": {
        "id": 2,
        "full_name": "Jane Coach"
      },
      "student": {
        "id": 1,
        "full_name": "John Doe"
      }
    }
  }
  ```

### `POST /api/bookings/:id/complete`
- **Auth**: Required
- **Description**: Coach only. Mark booking as completed after lesson end time. Allowed from `confirmed` or `awaiting_verification`. Sets payout pipeline to pending.
- **Request Body**: Optional (e.g. notes)

### `POST /api/bookings/:id/student-no-show`
- **Auth**: Required
- **Description**: Coach only. Records that the **primary student did not attend**; sets booking status to `student_no_show` after lesson end time. Allowed from `confirmed` or `awaiting_verification` **when there is no active dispute**. If booking is disputed (or has open/under_review dispute), use **`PUT /api/disputes/:id/resolve`** as final authority for status + money outcome. This is **not** for “coach did not show”—that scenario uses `POST /api/disputes` with dispute type **`coach_no_show_claim`** (`dispute_type_id` **1**). Admin override: `POST /api/admin/bookings/:id/student-no-show`.
- **Request Body**: Optional (e.g. notes)

### `POST /api/bookings/:id/cancel`
- **Auth**: Required
- **Description**: Cancel a **pre-lesson** booking only (`pending` or `confirmed`, and **`scheduled_at` must still be in the future**). Once lesson start time has arrived (`now >= scheduled_at`), returns **400** with code **`lesson_started_cancellation_unavailable`**. If status is **`awaiting_verification`**, returns **400** with code **`booking_in_post_lesson_phase`**. In both cases, use completion, attendance (no-show), or dispute workflows instead of cancel. Persists **`cancellation_history`** and sets booking → **`cancelled`**. Money movement:
  - **Captured / partially refunded / pending_capture charges**: enqueues a **`payment_actions`** row (`action_type` **`booking_cancel_refund`**) with the policy-derived **`refund_cents`**; Stripe execution runs asynchronously via **`processPendingRefundPaymentActions`** (~every **2 minutes**), same pipeline as dispute/admin refunds (**idempotency, metadata, reconciliation**).
  - **Uncaptured authorize-only PaymentIntent** (`pending`): cancels the PaymentIntent in Stripe inside the cancel transaction (**synchronous**) and marks the payment **`pending_void`**.
  Notifies the other party (in-app + email) with **`booking_id`**, **`cancelled_by`**, **`reason`**, optional **`reason_notes`**, and refund context when applicable.
  For `awaiting_verification`, `disputed`, or other post-lesson states, use **`PUT /api/disputes/:id/resolve`**, **`POST /api/admin/bookings/:id/refund`**, or other documented flows instead of this endpoint.
- **Late cancel policy (<24h before `scheduled_at`)** — applies to **student** cancels only:
  - **Captured charge** (`payment_status`: `captured`, `partially_refunded`, or `pending_capture` with `charge_id`): **50%** Stripe refund to student; **50%** retained on the charge. Retained amount is split **coach payout share + platform commission** (same ratio as a completed lesson). Booking sets **`payout_status: pending`**. **Payout ordering:** partial refund must finish first (`payment_actions` → Stripe → `payment_status: partially_refunded`, `refund_status: succeeded`); **then** `payoutWorker` releases the coach share. Payout is blocked while a cancel refund action is pending or `refund_status === pending`.
  - **Uncaptured authorize-only PaymentIntent** (`payment_status: pending`, **no `charge_id`**) — typical for **`pending`** bookings before coach accept/capture: the API **voids the full authorization** synchronously (`pending_void`). **No money was captured**, so there is **no 50/50 split**, **no retained penalty**, **no coach payout**, and **`cancellation_history`** records **`refund_amount` / `penalty_amount` as `0.00`**. Notification uses **`refund_status: voided_authorization`**. Reliability rules for late cancel still apply when the reason is unexcused.
  - **Coach cancel**, **student cancel ≥24h**, and **admin cancel**: **full refund** (or full void if uncaptured), **no coach payout**.
  - **Reliability** (separate from money): excused reasons (`weather`, `emergency`, `sickness`) skip reliability impact; unexcused reasons still apply. Excused reasons do **not** change the 50/50 financial split when a charge **was** captured.
- **Request Body**:
  ```json
  {
    "reason": "string (required, valid cancellation reason)",
    "reason_notes": "string (optional, max 255 chars)"
  }
  ```
- **Response** (Status: 200): `data` includes **`booking`** (full cancelled row), **`cancellation`** (timing + financial + reliability summary from **`cancellation_history`**), and when a Stripe refund was enqueued **`refund`** (omit when no refundable charge/refund cents was **0**):
  ```json
  {
    "success": true,
    "message": "Booking cancelled successfully",
    "data": {
      "booking": {
        "id": 1,
        "status": "cancelled",
        "cancelled_at": "2026-01-01T00:00:00.000Z",
        "cancelled_by": "student",
        "...": "other booking fields"
      },
      "cancellation": {
        "id": 10,
        "booking_id": 1,
        "cancelled_by": "student",
        "cancellation_type": "late",
        "affects_reliability": true,
        "reason": "forgot",
        "reason_notes": null,
        "refund_amount": "40.50",
        "penalty_amount": "40.50",
        "penalty_reason": "Late cancellation",
        "cancelled_at": "2026-01-01T00:00:00.000Z"
      },
      "refund": {
        "queued": true,
        "payment_action_id": 42,
        "refund_amount": "40.50",
        "refund_status": "pending_stripe_execution"
      }
    }
  }
  ```
  - **`cancellation_type`**: `"late"` when cancel occurs **&lt; 24 hours** before `scheduled_at`; otherwise `"non_late"`. Independent of `penalty_reason` (timing vs financial rule).
  - **`affects_reliability`**: `true` when this cancellation **is included in reliability calculations** for the cancelling party (`false` for excused reasons `weather` / `emergency` / `sickness`, and always `false` for admin cancel). It means the cancel **qualifies** to affect reliability — **not** that the score was definitely reduced, or by any specific amount. Actual score movement depends on booking history, smoothing (`RELIABILITY_SMOOTHING_K`), decay window, and penalty weights; a single event on a lightly used account may produce a very small change. **`GET /api/bookings/:id`** history rows still omit this field; only the cancel response includes it.

### `POST /api/admin/bookings/:id/cancel`
- **Auth**: Required (`admin`)
- **Description**: Same rules and **same response shape** as **`POST /api/bookings/:id/cancel`**: only **`pending`** or **`confirmed`** bookings; `cancelled_by` is set to **`admin`**. Post-lesson issues are not cancelled here — use dispute resolution (**`PUT /api/disputes/:id/resolve`**), refunds, or other documented admin actions.

- **Side effects — reliability & payments (read this carefully)**:
  - **Reliability — NO, never adjusted by admin cancel.** Code path: `cancelledBy === 'admin'` forces `willAffectReliability = false`, and the `updateUserReliability(...)` call is gated by `cancelledBy !== 'admin'`. The `cancellation_history` row is written with **`affects_reliability: false`**, and neither the coach nor the student score is recomputed. If you decide the cancellation should still penalize a party, use **`PUT /api/admin/users/:id/reliability`** as a manual override (audit-logged).
  - **Refund — YES, full refund when there is money to return (admin cancel has no penalty).** `computeCancellationSplitCents` for `cancelledBy === 'admin'` falls through to the default branch: **`refundCents = totalChargeCents`, `penaltyCents = 0`** (no late-cancel split even within 24h). The refund amount is then capped by the latest charge's remaining Stripe balance. What actually happens:
    - **Captured / `partially_refunded` / `pending_capture` charge** → in the same transaction that sets `status = cancelled`, a **`payment_actions`** row is created with `action_type` **`booking_cancel_refund`** and the computed `refund_cents`. Stripe runs via **`processPendingRefundPaymentActions`** (~2 minutes), same idempotent reconciliation as student/coach cancel, dispute resolve refunds, and admin manual refunds. Response includes the `refund` block (`queued: true`, `payment_action_id`, `refund_amount`, `refund_status: pending_stripe_execution`).
    - **Authorize-only `PaymentIntent`** that was never captured (payment_status `pending`, no `charge_id`) → Stripe `cancelPaymentIntent` is called **synchronously inside the cancel transaction**; payment is marked **`pending_void`**. No `refund` block in the response (nothing was ever captured). If the Stripe void call fails, the booking is **not** cancelled (502).
    - **No payment row / no refundable amount / Stripe remaining balance is 0** → booking still cancels, but no `payment_actions` row is enqueued and the `refund` block is omitted from the response.
  - **Other side effects**: `cancelled_by: admin`, `cancelled_at = now`, `messaging_locked: true`; a `cancellation_history` row is written with `refund_amount`, `penalty_amount` (`"0.00"` for admin), `penalty_reason` (`null` for admin), and the `cancellation_financials` audit log captures `total_charge_cents`, `refund_cents`, `retained_penalty_cents` (always 0 for admin), `queued_refund_payment_action_id`, `payment_voided_id`, and `is_late_cancel`.
  - **Need to also penalize a party's reliability?** Use **`PUT /api/admin/users/:id/reliability`** after cancelling (the standard cancel path will not do it for you).

- **Request Body**:
  ```json
  {
    "reason": "string (required; valid cancellation reason)",
    "reason_notes": "string (optional, max 255 chars)"
  }
  ```

### `POST /api/admin/bookings/:id/student-no-show`
- **Auth**: Required (`admin`)
- **Description**: Admin override for **student** no-show. Lesson must have ended; allowed source statuses are `confirmed`, `awaiting_verification`, `student_no_show`, or `coach_no_show` **when there is no active dispute** and **`bookings.attendance_finalized` is false**. After any dispute has been resolved on the booking, this endpoint returns **`409`** with **`code: attendance_finalized_locked`** — attendance changes must go through a **new** dispute + **`PUT /api/disputes/:id/resolve`**. While the booking is not finalized, this endpoint sets `bookings.status` → `student_no_show` and can correct an earlier admin attendance mark (including `coach_no_show` → `student_no_show`) subject to payment/attendance-lock guards. If disputed (or any open/under_review dispute exists), this endpoint returns conflict and you should resolve through **`PUT /api/disputes/:id/resolve`** so final status + financial outcome are decided in one path. Coach payout is handled by the payout worker as a payable attendance outcome: once eligible (no open dispute, no pending refund, escrow still `held`), payout proceeds on the next worker cycle (`~10 minutes`); **`student_no_show` is payable immediately** — unlike the default post-lesson path, which waits for **`completed`** after the 24h verification window.

- **Side effects — reliability & payments (read this carefully)**:
  - **Reliability — YES, student only.** After the status flip, the controller calls `updateUserReliability(primary_student_id, 'student')`. The new `student_no_show` row is picked up by `calculateStudentMetrics` → `calculateStudentReliabilityScore`, so the **student's** score recomputes (a no-show is a negative signal). **Coach reliability is not touched** by this endpoint. Recalculation is skipped only when the student user also has the `admin` role.
  - **Refund — NO, no automatic refund.** The student is **not** refunded by this endpoint. The booking is treated as a payable attendance outcome: coach payout proceeds via the normal payout worker once the booking is eligible (escrow still `held`, no open dispute, no pending refund). **`student_no_show` pays out on the next worker cycle** — there is no 24h verification hold for this attendance outcome.
  - **Need a refund anyway?** Use **`POST /api/admin/bookings/:id/refund`** (enqueues a `booking_admin_refund` `payment_actions` row), or open/resolve a dispute via **`POST /api/admin/disputes`** + **`PUT /api/disputes/:id/resolve`** with the appropriate `financial_action`.

- **Execution rule (required)**: status alone is not sufficient. Admin no-show is allowed only when **both** conditions are true:
  1. Booking status is in allowed source statuses.
  2. Lesson has already ended (`lessonHasEnded` check).

- **Request Body** (all optional):
  ```json
  {
    "notes": "string (optional, max 255 chars; internal admin context)"
  }
  ```

### `POST /api/admin/bookings/:id/coach-no-show`
- **Auth**: Required (`admin`)
- **Description**: Sets `bookings.status` → **`coach_no_show`** (coach did not attend). Allowed source statuses are `confirmed`, `awaiting_verification`, `student_no_show`, or `coach_no_show`, and the lesson end time has passed, **with no active dispute** and **`bookings.attendance_finalized` false**. After any dispute has been resolved on the booking, returns **`409`** **`attendance_finalized_locked`** (same as student no-show admin route). While not finalized, this endpoint can correct an earlier admin attendance mark (including `student_no_show` → `coach_no_show`) subject to payment/attendance-lock guards. If disputed (or any open/under_review dispute exists), this endpoint returns conflict and you should resolve through **`PUT /api/disputes/:id/resolve`** as the final authority path. **`409`** with **`booking_concurrent_update`** if another process changed the booking between read and transactional update. Coach attendance penalties in reliability come from **`bookings.status` only** (see dispute resolve **Reliability** notes).

- **Side effects — reliability & payments (read this carefully)**:
  - **Reliability — YES, coach only.** After the status flip, the controller calls `updateUserReliability(coach_id, 'coach')`. The new `coach_no_show` row is picked up by `calculateCoachMetrics` → `calculateCoachReliabilityScore`, so the **coach's** score recomputes (a no-show is a negative signal). **Student reliability is not touched** by this endpoint. Recalculation is skipped only when the coach user also has the `admin` role.
  - **Refund — YES, automatic refund to student when payment is refundable.** In the same transaction that sets `status = coach_no_show`, the controller inspects the latest `payments` row. If it is refundable (Stripe charge present, `payment_status` is `captured` or `partially_refunded`, no pending refund / refund-pipeline action, remaining Stripe balance ≥ 1¢), it queues a **`payment_actions`** row with `action_type` **`booking_coach_no_show_refund`** and returns **`auto_refund.status: queued`** plus **`payment_action_id`**. Stripe is executed by **`processPendingRefundPaymentActions`** (~2 minutes), same reconciliation path used by cancel and dispute refunds.
  - **When refund is not queued** the response carries **`auto_refund.status: skipped`** with a **`reason`** (`payment_missing`, `charge_missing`, `refund_pending`, `refund_pipeline_pending`, `already_fully_refunded`, `payment_status_not_refundable:<status>`, or `no_refundable_payment`). The status flip and coach reliability recalc still happen. Fallback for money movement in `skipped` cases is **`POST /api/admin/bookings/:id/refund`**.

- **Execution rule (required)**: status alone is not sufficient. Admin no-show is allowed only when **both** conditions are true:
  1. Booking status is in allowed source statuses.
  2. Lesson has already ended (`lessonHasEnded` check).

- **Request Body** (all optional except as noted):
  ```json
  {
    "notes": "string (optional, max 255 chars; audit-only context)"
  }
  ```

- **Notes field guidance**:
  - `notes` is optional and not required for booking status transitions.
  - Use `notes` for quick internal support/audit context (for example, who reported the issue).
  - For contested or financially sensitive cases, use dispute flow fields (`disputes.notes`, `resolution_notes`) as the canonical case record.

- **Attendance correction lock (both admin no-show endpoints)**:
  - Admin attendance corrections are allowed only while the booking is financially mutable.
  - Attendance changes are blocked once payout/refund settlement is finalized (for example payout already finalized, escrow already released, or refund finalized).
  - After **any** dispute on the booking has been **resolved** via **`PUT /api/disputes/:id/resolve`**, **`bookings.attendance_finalized`** is **`true`** and both endpoints return **`409`** with **`code: attendance_finalized_locked`**. Further attendance changes require a **new** dispute + resolve (see **Attendance finalization** under **`PUT /api/disputes/:id/resolve`**).

- **Response** (coach-no-show; **`data`** is the booking plus attendance fields):

  ```json
  {
    "success": true,
    "message": "Booking marked as coach_no_show",
    "data": {
      "...": "booking fields incl. lesson, coach, primaryStudent embeds",
      "attendance_outcome": "coach_no_show",
      "no_show_party": "coach",
      "auto_refund": {
        "status": "queued",
        "reason": null,
        "payment_id": 5,
        "refund_cents": 4550,
        "stripe_refund_id": null,
        "payment_action_id": 18,
        "refund_status": "pending_stripe_execution"
      }
    }
  }
  ```

  With no refundable path, **`auto_refund.status`** is **`skipped`** and **`reason`** explains (**`payment_missing`**, **`charge_missing`**, **`refund_pending`**, **`refund_pipeline_pending`** when another **`payment_actions`** row is queued, **`already_fully_refunded`**, **`payment_status_not_refundable:…`**, …). (**Open/active disputes return **409** earlier — not **`skipped`** for that reason.**)

### `POST /api/admin/bookings/:id/refund`
- **Auth**: Required (`admin`)
- **Description**: Admin override refund **intent** for a booking's latest payment. Does **not** call Stripe synchronously: creates a **`payment_actions`** row (`action_type` **`booking_admin_refund`**) with the computed **`refund_cents`**; Stripe runs via **`processPendingRefundPaymentActions`** (~**2 minutes**) with the same **`payment_actions`** reconciliation path as cancellations and disputes.
  - **Single-settlement guardrail**: if the booking already has **any refunded amount**, a **pending `payments.refund_status`**, **or any pending `payment_actions` row** for Stripe execution, returns **409** `code: refund_path_already_used` (includes partial refunds and queued intents).
  - **Dispute-first guardrail**: if the booking has an **open** or **under_review** dispute, returns **409** `code: refund_requires_dispute_resolution`.
  - Resolved disputes whose resolution action **`requires_payout_adjustment`** still yield **409** **`refund_path_already_used`** (matches server guard against mixed dispute + manual refund paths).
- **Request Body**:
  ```json
  {
    "refund_amount": "number (optional, USD; server reads full remaining Stripe balance when omitted)",
    "reason": "string (optional; requested_by_customer | duplicate | fraudulent)",
    "reason_notes": "string (optional, max 255 chars)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Booking refund queued; Stripe executes via worker",
    "data": {
      "queued": true,
      "booking_id": 1,
      "payment_id": 5,
      "payment_action_id": 22,
      "refund_amount": "45.50",
      "refund_status": "pending_stripe_execution",
      "stripe_refund_id": null,
      "reason": "requested_by_customer"
    }
  }
  ```

### `POST /api/admin/disputes`
- **Auth**: Required (`admin`)
- **Description**: Same behavior as **`POST /api/disputes`**: creates a dispute row with **`opened_by` → `admin`**. Use when support records an issue (e.g. user contacted support instead of the app). Does **not** change `bookings.status` by itself — combine with **`PUT /api/disputes/:id/resolve`**, **`POST /api/admin/bookings/:id/refund`**, **`POST /api/admin/bookings/:id/cancel`** (pre-lesson only), or **`POST /api/admin/bookings/:id/coach-no-show`** as appropriate. For **coach did not attend** after lesson end, prefer **`POST /api/admin/bookings/:id/coach-no-show`** (reliability) and/or this endpoint + resolve for the audit trail and refunds.
- **Request Body**: Same as **`POST /api/disputes`** (`booking_id`, `dispute_type_id`, optional `notes`).

### Admin Incident Playbook (What To Use, When)

Use this section as the admin decision guide for incidents, payouts/refunds, disputes, and reliability.

- **Booking status endpoints** (`cancel`, `student-no-show`, `coach-no-show`) set the canonical booking outcome.
- **Dispute endpoints** (`create`, `resolve`) manage case workflow and optional dispute-driven refunds.
- **Refund endpoint** (`POST /api/admin/bookings/:id/refund`) enqueues money movement (**`booking_admin_refund`**) without requiring a dispute.
- **Reliability adjust endpoint** (`PUT /api/admin/users/:id/reliability`) is a manual support override, not the normal path.

| Situation | Primary endpoint | Add these if needed | Important notes |
|---|---|---|---|
| Lesson has **not** happened yet (`pending` / `confirmed`) and needs cancellation | `POST /api/admin/bookings/:id/cancel` | `POST /api/admin/bookings/:id/refund` only for rare/manual follow-up adjustments after **`payment_actions`** from cancel have finished (exceptional; not the default path); `PUT /api/admin/users/:id/reliability` if a party should still be penalized | Cancel is pre-lesson only; sets `cancelled_by: admin`. **Reliability: NO** — admin cancel never adjusts coach or student score (`affects_reliability=false`). **Refund: YES, full refund (no penalty)** when money is recoverable — refundable charges enqueue **`booking_cancel_refund`** (`payment_actions`, worker ~2 min); uncaptured intents are voided in-txn |
| Lesson ended and **student** did not attend | `POST /api/admin/bookings/:id/student-no-show` | If disputed/active case: `PUT /api/disputes/:id/resolve`; `POST /api/admin/bookings/:id/refund` if a refund is also warranted | Sets `bookings.status -> student_no_show`. **Reliability: YES — student only** (`updateUserReliability(primary_student_id, 'student')`). **Refund: NO automatic refund** — coach payout follows normal payout flow. Admin may also use this to correct `coach_no_show -> student_no_show` before financial settlement lock |
| Lesson ended and **coach** did not attend | `POST /api/admin/bookings/:id/coach-no-show` | If disputed/active case: `PUT /api/disputes/:id/resolve`; manual refund endpoint only if **`auto_refund` skipped** (e.g. not captured) — not synchronous Stripe anymore | Sets `bookings.status -> coach_no_show`. **Reliability: YES — coach only** (`updateUserReliability(coach_id, 'coach')`). **Refund: YES (automatic when eligible)** — queues **`booking_coach_no_show_refund`** on `payment_actions`; worker runs Stripe ~2 min. Corrects `student_no_show -> coach_no_show` before financial lock |
| Quality/conduct/billing issue needs case tracking (user contacted support, evidence review, etc.) | `POST /api/admin/disputes` | `PUT /api/disputes/:id/resolve` (+ optional refund via resolution action) | Creating a dispute does not change booking status by itself |
| Existing dispute is ready for outcome | `PUT /api/disputes/:id/resolve` | Send `decision` + `financial_action` for all disputes; for attendance claims also send **`outcome`** (required on every resolve) | Resolve is the final authority; decision is explicit, booking status comes from `outcome` (attendance only), money comes from `financial_action` |
| Need money returned and **no active dispute** | `POST /api/admin/bookings/:id/refund` | N/A | Creates **`booking_admin_refund`** on `payment_actions`; money returns via Stripe after worker (**same reconciliation** as cancel/dispute refunds); booking row unchanged unless you change status separately |
| Score is clearly wrong after investigation and standard flows cannot correct it in time | `PUT /api/admin/users/:id/reliability` | `GET /api/admin/users/:id/reliability` before/after for audit check | Manual override only; choose correct `role` (`coach` default, `student` when needed) |

#### Recommended order by incident type

1. **Pre-lesson issue**: use **admin cancel** first; then refund/dispute only if needed.
2. **Attendance outcome issue** (student no-show or coach no-show): set booking outcome first with the correct no-show endpoint; then add dispute/refund only if needed.
3. **Service/billing dispute without attendance status change**: create dispute, investigate, then resolve (and refund via resolution action if applicable).

#### Additional admin guardrails

- **Do not use dispute endpoints as a booking-status shortcut.** Disputes are case records; status endpoints are source of truth for attendance/cancellation outcomes.
- **Do not use cancel for post-lesson states.** Cancel is only for `pending` / `confirmed`.
- **No-show endpoints are post-lesson only.** They require lesson end-time conditions and valid status transitions.
- **`confirmed` is necessary but not sufficient.** `confirmed` remains an allowed source status to handle worker timing windows where the lesson has ended but status has not yet moved to `awaiting_verification`; before lesson end, no-show endpoints still reject.
- **Refunds and status are separate except coach no-show.** **Coach no-show** queues a refund when refundable; otherwise use cancel or **`POST …/refund`** explicitly.
- **Refund is a single settlement per booking incident.** Once Stripe shows money moved **or any `payment_actions`/payment refund is pending**, additional refund attempts are blocked with `409 refund_path_already_used`.
- **When a dispute is open/under_review, refunds must be decided in dispute resolution.** Manual refund endpoint returns `409 refund_requires_dispute_resolution`.
- **Dispute visibility is not admin-only.** Booking participants (coach/student on that booking) can view related disputes; admins can view all.
- **Reliability deduplication exists for no-show overlap.** If booking is already `coach_no_show`/`student_no_show`, resolving the matching no-show claim dispute does not double-penalize scoring.

### `GET /api/admin/lessons`
- **Auth**: Required (`admin`)
- **Description**: **Admin lesson inventory** — lessons across coaches (**no** marketplace gate). Default includes **active + inactive** non-deleted rows. Pass **`include_deleted=true`** to include soft-deleted.
- **DTO contract**: Admin inventory fields (`id`, `coach_id`, `title`, `description`, `duration_minutes`, `price`, `effective_hourly_rate`, `max_students`, `is_active`, `deleted_at`, `created_at`) + nested **`coach`**: `id`, `full_name`, `email`, `is_active`, `deleted_at` (no `avatar_url`).
- **Contrast**:
  | Endpoint | Audience | Scope |
  |----------|----------|--------|
  | `GET /api/coaches/:id/lessons` | Marketplace | Active + eligible coach only |
  | `GET /api/coaches/me/lessons` | Coach | Own lessons (not deleted; includes inactive) |
  | `GET /api/admin/lessons` | Admin | All coaches; non-deleted by default |
- **Query Parameters**:
  - `coach_id` (optional)
  - `is_active` (optional) — `"true"` \| `"false"`
  - `include_deleted` (optional) — `"true"` to include soft-deleted (default excludes them)
  - `deleted` (optional) — `"true"` deleted-only; `"false"` non-deleted only
  - `min_price` / `max_price`, `page` / `limit`
- **Pagination contract**: Same as other admin lists.
- **Error responses**: **`401`**, **`403`** (not admin).

### `GET /api/admin/bookings`
- **Auth**: Required (`admin`)
- **Description**: Admin list bookings (all bookings, optional filters like status/coach_id/student_id).

### `GET /api/admin/bookings/:id`
- **Auth**: Required (`admin`)
- **Description**: Admin get any booking by ID.

### `GET /api/coaches/me/bookings`
- **Auth**: Required (`coach`)
- **Description**: **Coach dashboard / inbox** — bookings where `coach_id` is the authenticated coach only. Each **`primaryStudent`** includes informational **`reliability_score`** (defaults to **100** when no student reliability row exists). Preserves coach-inbox pending visibility rules (pending rows require latest payment `authorized`).
- **Contrast**: `GET /api/students/me/bookings` — bookings where the user is the primary student (student dashboard). There is no combined participant list endpoint.
- **DTO contract**: Booking list uses **`serializeBookingListItem`** — summary fields plus trimmed nested **`lesson`**, **`coach`**, **`primaryStudent`**, **`courtLocation`**, and **`conversation`**.
- **Query Parameters**: status, optional `page`, optional `limit` (omit both for all matching rows; provide either to paginate)

**Schedule changes:** There is no reschedule API. To move a lesson, **cancel** the booking (`POST /api/bookings/:id/cancel`) and **book a new slot** (`POST /api/booking-intents` → authorize → `POST /api/bookings/confirm`). Cancellation reasons: excused (`weather`, `emergency`, `sickness`) vs unexcused (`travel_delay`, `schedule_conflict`, `forgot`, `other`) for reliability. Cancel notifies the other party with `cancelled_by`, `reason`, and optional `reason_notes`.

**Notifications (email + in-app when configured):** booking accepted (`booking_confirmed`), declined (`booking_declined`), cancelled (`booking_cancelled`). **Lesson reminders (MVP):** `pre_lesson_24h` — in-app + email; `pre_lesson_1h` — in-app only (no 1h email). Chat: in-app only `new_message` when the other participant sends a message. **Stripe Connect:** `stripe_payouts_disabled` / `stripe_payouts_enabled` (in-app + email) — sent to the coach **only when `stripe_ready` actually flips** (via `account.updated` webhook or a status sync); duplicate webhook deliveries stay silent.

---

## Payments (`/api/payments`)

### `GET /api/payments`
- **Auth**: Required
- **Description**: Get payments visible to the caller. **Non-admin:** scoped by participation — if the user has **both** `coach` and `student`, rows where they are **either** `coach_id` **or** `student_id` are included (additive capabilities). If only `coach` or only `student`, that side applies. Users with neither role see an empty list. **Admin:** no participant filter (full list subject to query params).
- **DTO contract**: Participant-facing responses expose business payment fields (`payment_status`, `escrow_status`, `refund_status`, amounts, `booking` summary, coach/student names). **Omits** `payment_intent_id`, `charge_id`, `transfer_id`, `metadata`, and other Stripe reconciliation fields unless the caller is **admin**.
- **Query Parameters**: Filters (`status`, `escrow_status`, `student_id`, `coach_id`), optional `page`, optional `limit` (omit both for all matching rows; provide either to paginate)
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Payments retrieved successfully",
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "student_id": 1,
        "coach_id": 2,
        "total_charge_to_student": "50.00",
        "platform_fee_amount": "4.00",
        "coach_payout_expected": "46.00",
        "payment_status": "captured",
        "escrow_status": "released",
        "refund_status": "none",
        "booking": {
          "id": 1,
          "scheduled_at": "2026-02-01T10:00:00.000Z",
          "status": "completed",
          "messaging_locked": true
        }
      }
    ]
  }
  ```

### `GET /api/payments/:id`
- **Auth**: Required
- **Description**: Get payment details by ID
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Payment retrieved successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "student_id": 1,
      "coach_id": 2,
      "total_charge_to_student": 50.00,
      "platform_fee_amount": 4.00,
      "coach_payout_amount": 46.00,
      "payment_status": "captured",
      "escrow_status": "released",
      "booking": {
        "id": 1,
        "scheduled_at": "2026-02-01T10:00:00.000Z"
      }
    }
  }
  ```

**MVP note:** Payment rows are created when a student confirms a booking (`POST /api/bookings/confirm`) and updated via Stripe webhooks and booking flows. There are no admin HTTP endpoints to create payments or tweak rows in isolation without a booking/dispute route—use Stripe Dashboard when appropriate. Money-back flows enqueue **`payment_actions`** (cancel / coach-no-show auto / manual admin refund / dispute resolve); **`paymentService.processPendingRefundPaymentActions`** issues **`stripe.refunds.create`** with idempotent keys and attaches refund metadata (**`booking_id`**, **`payment_action_id`**) used by **`reconcileRefundPaymentActionsWithStripe`**.

---

## Reviews (`/api/reviews` + scoped lists)

**Coach-first reviews (no global feed for regular users):**

| Flow | Endpoint |
|------|----------|
| Reviews about one coach | **`GET /api/coaches/:id/reviews`** (also embedded on `GET /api/coaches/:id`) |
| Reviews I wrote | **`GET /api/students/me/reviews`** |
| Reviews about me (coach) | **`GET /api/coaches/me/reviews`** |
| Admin inventory | **`GET /api/admin/reviews`** |
| ~~Global list~~ | **`GET /api/reviews`** → **`410 Gone`** |

### `GET /api/reviews`
- **Auth**: Required
- **Status**: **`410 Gone`** — platform-wide review catalog removed (`code: reviews_catalog_removed`). Use the purpose-specific endpoints above.

### `GET /api/coaches/:id/reviews`
- **Auth**: Required (`student`, `coach`, or `admin`)
- **Description**: Reviews about this coach. Coach must be publicly active. Optional `page` / `limit`.
- **DTO contract**: Same as `serializeReview` (trimmed booking + party summaries).

### `GET /api/students/me/reviews`
- **Auth**: Required (`student`)
- **Description**: Reviews the authenticated student **wrote**. Optional `page` / `limit`.

### `GET /api/coaches/me/reviews`
- **Auth**: Required (`coach`)
- **Description**: Reviews **about** the authenticated coach. Optional `page` / `limit`.

### `GET /api/admin/reviews`
- **Auth**: Required (`admin`)
- **Description**: Full review inventory. Optional filters: `coach_id`, `student_id`, `page`, `limit`.

### `POST /api/reviews`
- **Authentication**: Logged-in user with the student role and a verified email.
- **Authorization**: Must be the booking's `primary_student_id`. Dual-role coach+student users may review when they were the student on that booking. **`student_id` / `coach_id` are not accepted** in the body — they are set from the authenticated student and **`booking.coach_id`**. Admins cannot create reviews on behalf of users.
- **Description**: Create a review for a **completed** booking (1–5 star rating; optional written comment). **One review per booking** (`UNIQUE(booking_id)`). FK `booking_id` → `bookings.id` is **`ON DELETE RESTRICT`** (bookings are cancelled, not deleted; hard-deleting a booking that has a review fails).
- **Request Body**:
  ```json
  {
    "booking_id": 162,
    "rating": 5,
    "comment": "Great lesson!"
  }
  ```
  - `booking_id` (required): positive integer
  - `rating` (required): integer 1–5
  - `comment` (optional): string, max 1000 chars
- **Error conditions**:

  | Situation | Status |
  |-----------|--------|
  | Booking not found | 404 |
  | Not the booking's student | 403 |
  | Email not verified | 403 |
  | Missing student role | 403 |
  | Booking not completed | 400 |
  | Self-review (student would equal coach) | 400 (`cannot_review_self`) |
  | Review already exists | 409 |
  | Invalid body | 400 |

- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Review created successfully",
    "data": {
      "id": 1,
      "booking_id": 162,
      "student_id": 1,
      "coach_id": 2,
      "rating": 5,
      "comment": "Great lesson!",
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/reviews/:id`
- **Auth**: Required (review author / student or admin)
- **Description**: Update review. Only **`rating`** and/or **`comment`** may change — `booking_id`, `student_id`, `coach_id`, and `created_at` are immutable. Sets **`updated_at`**. When **`rating`** changes, recomputes the coach's **`rating_average`** / **`rating_count`**.
- **Request Body** (all fields optional — omit fields you don't want to update):
  ```json
  {
    "rating": 4,
    "comment": "Updated review comment"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Review updated successfully",
    "data": {
      "id": 1,
      "booking_id": 162,
      "student_id": 1,
      "coach_id": 2,
      "rating": 4,
      "comment": "Updated review comment",
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-02T15:30:00.000Z"
    }
  }
  ```

### `DELETE /api/reviews/:id`
- **Auth**: Required
- **Description**: Delete review (only by the review's student or admin). Recomputes the coach's **`rating_average`** / **`rating_count`**.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Review deleted successfully",
    "data": null
  }
  ```

---

## Messages (`/api/messages`)

**Booking-scoped messaging (V1).** One conversation per booking (`conversations.booking_id` unique). Text only — no attachments, edits, deletes, reactions, typing indicators, or read receipts. Sending a message creates an in-app `new_message` notification for the other participant (no realtime push; poll notifications).

**Messaging lifecycle** (derived from `booking.status` via `utils/bookingMessaging.js`; `messaging_locked` column synced on every status transition):

| Booking status | Messaging |
|----------------|-----------|
| `pending` | Locked |
| `confirmed` | Unlocked |
| `awaiting_verification` | Unlocked |
| `completed`, `cancelled`, `disputed`, `coach_no_show`, `student_no_show` | Locked (read-only history) |

**Access:** booking coach, primary student, or admin may **read** threads they are allowed to see. Only coach and student may **send** when messaging is unlocked. Others receive **403**. Locked sends return **409** `{ "success": false, "message": "Messaging is unavailable for this booking" }`.

**Auto-create:** When a booking transitions to **`confirmed`**, the server creates the conversation if missing (coach accept or payment capture webhook). `POST /api/messages/conversations` remains an idempotent fallback.

### `GET /api/messages/conversations`
- **Auth**: Required
- **Description**: **Inbox / preview endpoint** — list booking-scoped conversation threads for the caller. Returns one row per conversation (newest conversations first). Does **not** return full message history; use `GET /api/messages/conversations/:id` for the complete thread.
- **Scope**: Non-admin — conversations for bookings where the caller is `coach_id` or `primary_student_id`. Admin — all conversations (optional `booking_id` filter). If a non-admin filters by `booking_id` for a booking they are not on, returns an empty list (**200**).
- **Query Parameters**: `booking_id` (optional), optional `page`, optional `limit`
- **Response** (Status: 200) — each item in `data`:
  ```json
  {
    "id": 1,
    "booking_id": 5,
    "created_at": "2026-05-29T10:00:00.000Z",
    "updated_at": "2026-06-01T09:00:00.000Z",
    "latest_message": {
      "id": 42,
      "conversation_id": 1,
      "sender_id": 20,
      "message_text": "See you at court!",
      "created_at": "2026-06-01T09:00:00.000Z",
      "updated_at": "2026-06-01T09:00:00.000Z",
      "sender": {
        "id": 20,
        "full_name": "Student User",
        "avatar_url": null
      }
    },
    "booking": {
      "id": 5,
      "lesson_id": 12,
      "scheduled_at": "2026-06-01T10:00:00.000Z",
      "status": "confirmed",
      "messaging_locked": false
    },
    "unread_count": 2
  }
  ```
  - **`latest_message`**: newest message in the thread, or **`null`** when the conversation has no messages (never an array). Same message DTO as detail / send (includes nested `sender`).
  - **`booking`**: lean **messaging** summary — `id`, `lesson_id`, `scheduled_at`, `status`, `messaging_locked`. Omits `duration_minutes`, `price`, `court_location_id`, party ids, and persistence internals. Use booking detail for full booking fields.
  - **`unread_count`**: number of messages **from other participants** after this viewer's `conversation_reads.last_read_at` (or all incoming messages if the viewer has never opened the thread). Always present (use `0` when fully read). Frontend badge: `unread_count > 0`. Your own outbound messages never increment this.

### `GET /api/messages/conversations/:id`
- **Auth**: Required
- **Description**: Get conversation with messages (oldest first). Readable even when messaging is locked. **`messaging_locked`** is on **`booking`** (status-derived), same as the inbox list — not at the conversation root. **Side effect:** successful access upserts `conversation_reads` for the viewer with **`last_read_at` = newest message `created_at`** in the thread (empty thread → now). Messages sent after that cursor remain unread on the next inbox poll.
- **Query Parameters**: Optional `page`, optional `limit` (paginate messages)
- **Response notes**:
  - **`booking`**: same lean messaging DTO as the inbox list (see above).
  - **`messages`**: full thread (unlike the inbox list); each item is the shared message DTO (includes nested `sender`).

### `POST /api/messages/conversations`
- **Auth**: Required (email verified)
- **Description**: Create (or return existing) conversation for a booking. Requires unlocked messaging and participant role.
- **Request Body**: `{ "booking_id": number }`
- **Errors**: **403** non-participant; **409** messaging locked

### `POST /api/messages/send`
- **Auth**: Required (email verified)
- **Description**: Send a text message in a booking conversation.
- **Notification**: After the message is saved, the API creates an **in-app** notification (`type: new_message`) for the **other** booking participant (coach ↔ student). No email/SMS. Payload includes `route` (`/messages/:conversation_id`), `conversation_id`, `booking_id`, `message_id`, `sender_id`, `sender_name`, `headline`, `preview`, and `summary` for a notification bell / deep link. Frontend can poll **`GET /api/notifications/unread-count`** for the badge and `GET /api/notifications` when the panel opens; unread ≈ `read_at` is null; tap → `navigate(payload.route)`.
- **Request Body**:
  ```json
  {
    "conversation_id": "number (required)",
    "message_text": "string (required, 1-5000 chars)"
  }
  ```
- **Response** (Status: 201): same message DTO as inbox `latest_message` / conversation `messages[]` — includes nested `sender` (`id`, `full_name`, `avatar_url`) so the client can append without inferring the current user.
- **Errors**: **403** non-participant or admin; **409** messaging locked

---

## Disputes (`/api/disputes`)

**Dispute types (`dispute_types` table)** — use `dispute_type_id` when creating a dispute. **Five active types** (after migration `20260706153000-simplify-dispute-types-catalog`):

| `id` | `code` | Meaning |
|------|--------|---------|
| 1 | `coach_no_show_claim` | **Claim:** student alleges the coach did not attend (final outcome is `bookings.status`, set on `PUT /api/disputes/:id/resolve`) |
| 3 | `misconduct` | Conduct / safety issue |
| 4 | `lesson_not_completed` | Lesson did not complete as expected (includes late arrival / quality issues) |
| 7 | `other` | Catch-all — describe refund requests or edge cases in `notes`. Preserves lesson outcome (no attendance/reliability change); releases Stripe-parked `disputed` → `completed` on resolve only. |
| 8 | `student_no_show_claim` | **Claim:** coach alleges the primary student did not attend |

**Removed from catalog** (migrated on existing rows): `refund_request` / `billing_issue` → `other` (late-arrival quality issues fold into `lesson_not_completed`). **Refunds are not a dispute type** — use `financial_action` on resolve (`refund_student`, `refund_student_partial`, `no_change`). Payment/billing support issues should use admin payment tools, not a separate dispute type.

### `GET /api/disputes`
- **Auth**: Required
- **Description**: Get disputes (filtered by user role). If `page` and `limit` are omitted, returns all matching disputes in `data` (server-capped at 10,000). If `page` or `limit` is provided, returns the requested page size.
- **Query Parameters**: Filters such as `status`, `booking_id`; optional `page`, optional `limit`.
- **Resolver field**: `resolved_by_admin` only (`{ id, full_name }` or `null`). No separate `admin_id` / `resolved_by_admin_id` in JSON (use `resolved_by_admin.id` when present).
- **Nested DTOs** (when associations are loaded — list and detail endpoints): embedded `booking`, `disputeType`, and `resolutionAction` are trimmed purpose-built objects, not raw Sequelize rows. `booking` uses the **booking summary** shape (`id`, `lesson_id`, `coach_id`, `primary_student_id`, `scheduled_at`, `duration_minutes`, `price`, `status`, `court_location_id`, `messaging_locked`) — fuller than the lean messaging booking embed. `disputeType` is `{ id, code, name, description? }`. `resolutionAction` is `{ id, code, name, description? }` or `null` when unresolved.
- **Payment embed** (detail when loaded): uses **`serializePaymentSummary`** — participants never receive Stripe IDs / `metadata`. Admins may receive reconciliation fields.
- **Admin-only dispute fields**: `escalated`, `escalated_to`, `escalation_triggered_at`, `stripe_dispute_id`, `stripe_dispute_status` (omitted for participants).
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Disputes retrieved successfully",
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "dispute_type_id": 1,
        "notes": "Optional context from the reporter",
        "opened_by": "student",
        "status": "open",
        "decision": null,
        "outcome": null,
        "refund_amount": null,
        "resolved_by_admin": null,
        "booking": {
          "id": 352,
          "lesson_id": 61,
          "coach_id": 77,
          "primary_student_id": 2,
          "scheduled_at": "2026-06-01T10:00:00.000Z",
          "duration_minutes": 60,
          "price": "80.00",
          "status": "disputed",
          "court_location_id": 75,
          "messaging_locked": true
        },
        "disputeType": {
          "id": 1,
          "code": "coach_no_show_claim",
          "name": "Coach no-show (claim)",
          "description": "Student claims the coach did not attend"
        },
        "resolutionAction": null,
        "opened_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

  **Resolution fields surfaced on every dispute row** (populated on resolve, null otherwise):
  - **`decision`**: `upheld` | `rejected` | `partial` | `null`. Admin ruling.
  - **`outcome`**: `coach_no_show` | `student_no_show` | `null`. Factual attendance result for attendance dispute types (`coach_no_show_claim`, `student_no_show_claim`). Persisted on the dispute so the historical determination survives subsequent admin overrides of `bookings.status`. Always `null` for behavior disputes and unresolved disputes.
  - **`refund_amount`**: US dollars decimal string (e.g. `"12.34"`) or `null`. Approved partial-refund amount recorded at resolve time for `financial_action = refund_student_partial`. **Always `null` for full refunds (`refund_student`) and for `no_change`.** For full refunds the executed cents are determined later by the payment-action worker from the remaining Stripe charge balance; read the linked `payment_actions` row (by `dispute_id`) for that value.

### `GET /api/disputes/:id`
- **Auth**: Required
- **Description**: Get dispute details by ID.
- **Resolver field**: `resolved_by_admin` is the admin who resolved the dispute (`null` if still open or not yet resolved).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Dispute retrieved successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "dispute_type_id": 1,
      "notes": "Optional context from the reporter",
      "opened_by": "student",
      "status": "resolved",
      "decision": "partial",
      "outcome": "coach_no_show",
      "refund_amount": "20.00",
      "booking": {
        "id": 1,
        "lesson_id": 12,
        "coach_id": 10,
        "primary_student_id": 20,
        "scheduled_at": "2026-02-01T10:00:00.000Z",
        "duration_minutes": 60,
        "price": "50.00",
        "status": "coach_no_show",
        "court_location_id": 3,
        "messaging_locked": true
      },
      "disputeType": {
        "id": 1,
        "code": "coach_no_show_claim",
        "name": "Coach no-show (claim)",
        "description": "Student claims the coach did not attend"
      },
      "resolutionAction": {
        "id": 2,
        "code": "partial_refund",
        "name": "Partial refund",
        "description": "Partial refund to student"
      },
      "resolved_by_admin": {
        "id": 10,
        "full_name": "Admin User"
      },
      "opened_at": "2026-01-01T00:00:00.000Z",
      "resolved_at": "2026-01-02T00:00:00.000Z"
    }
  }
  ```

  See **`GET /api/disputes`** above for the meaning of `decision`, `outcome`, and `refund_amount`.

### `POST /api/disputes`
- **Auth**: Required. **Students and coaches** must have **verified email**. **Admins** may create disputes without email verification; the row is stored with **`opened_by` → `admin`** (same as **`POST /api/admin/disputes`**).
- **Description**: Create a dispute. **Student/coach** callers get **`opened_by` → `student`** or **`coach`** as appropriate. **Admin** callers get **`opened_by` → `admin`**. Active types only: `coach_no_show_claim`, `student_no_show_claim`, `misconduct`, `lesson_not_completed`, `other`. Types outside the active catalog (including removed codes such as `refund_request` / `billing_issue`) return **400** `dispute_type_deprecated` when still referenced. Refund intent belongs in **`notes`** and admin **`financial_action`** on resolve — not a separate dispute type.
- **Booking status guard**: Disputes are **post-lesson** case records. The booking must be in an eligible status before create succeeds (**400** with `booking_status` in the error payload):

  | Booking status | Can create? |
  |----------------|-------------|
  | `awaiting_verification` | **Yes** |
  | `completed` | **Yes** |
  | `student_no_show` | **Yes** (e.g. second dispute after a prior resolve) |
  | `coach_no_show` | **Yes** |
  | `disputed` | **Yes** when no other active in-app dispute exists |
  | `confirmed` | **Yes** only after lesson end time (`scheduled_at + duration_minutes`) |
  | `pending` | **No** — `dispute_create_pre_lesson_booking` |
  | `confirmed` (lesson not ended) | **No** — `dispute_create_lesson_not_ended` |
  | `cancelled` | **No** — `dispute_create_cancelled_booking` |

  Also blocked: **409** when another dispute on the same booking is `open` or `under_review`.
- **Request Body**:
  ```json
  {
    "booking_id": "number (required)",
    "dispute_type_id": "number (required)",
    "notes": "string (optional, max 1000) — stored on the dispute for support / audit"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Dispute created successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "dispute_type_id": 1,
      "notes": "Issue with the lesson - coach was late",
      "opened_by": "student",
      "status": "open",
      "decision": null,
      "outcome": null,
      "refund_amount": null,
      "resolved_by_admin": null,
      "opened_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/disputes/:id/resolve`
- **Auth**: Required (Admin only)
- **Description**: Resolve a dispute (admin only). Sets `status` → `resolved`, records resolver and `resolved_at`.

### Attendance finalization (`bookings.attendance_finalized`)

Dispute resolution is the **authoritative adjudication boundary** for whether the booking’s attendance outcome may still be changed **outside** the dispute flow.

- **On every successful resolve** (all dispute types: attendance claims **`coach_no_show_claim`**, **`student_no_show_claim`**, behavior **`misconduct`**, **`lesson_not_completed`**, and catch-all **`other`**), the server sets **`bookings.attendance_finalized` → `true`**.
- **What the flag means**: it does **not** freeze the entire booking row forever. It means **attendance outcome** cannot be mutated via **`POST /api/admin/bookings/:id/student-no-show`** or **`POST /api/admin/bookings/:id/coach-no-show`** — those return **`409`** with **`code: attendance_finalized_locked`** once the flag is true.
- **Changing attendance after finalization**: open a **new** dispute on the same booking (when no dispute is active) and resolve it via this endpoint. Resolve may still update **`bookings.status`** from allowed source statuses (including `student_no_show`, `coach_no_show`, `completed`, `disputed` per `DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES` for attendance outcomes) and always re-affirms **`attendance_finalized`**.
- **Canonical records**: **`disputes.outcome`** is the historical attendance determination for that dispute row (attendance types only). **`bookings.status`** is the operational final state for product/UI. **`attendance_finalized`** is the guardrail preventing post-resolution drift from admin no-show endpoints.

**`lesson_not_completed`**: this dispute type describes a quality/completion claim on a lesson that **occurred** in the product sense — it does **not** mean the booking is deleted or that attendance stays editable via admin no-show routes after a resolve. The booking remains a normal row with a finalized adjudication boundary.

  Canonical resolve contract:
  - **`decision`** (**required**, all dispute types): **`upheld`** | **`rejected`** | **`partial`**. This is the admin ruling and does not need to be inferred from attendance outcome.
  - **`financial_action`** (money on resolve): **`no_change`** (no Stripe refund enqueued by this request), **`refund_student`** (full remaining on the booking’s latest captured charge), **`refund_student_partial`** (**`refund_amount`** required, US dollars). For **attendance** disputes, which values are valid is determined jointly with **`outcome`** (see alignment): e.g. **`coach_no_show`** requires a refund path; **`student_no_show`** requires **`no_change`**. For **behavior** disputes, **`rejected`** still requires **`no_change`**.
  - **`outcome`** (attendance claims only — dispute types **`coach_no_show_claim`**, **`student_no_show_claim`**): **`student_no_show`** | **`coach_no_show`**. **Always required** for attendance disputes (factual determination on every resolve). Non-attendance disputes must omit **`outcome`**.
    - **`decision`** **`upheld`** or **`partial`**: **`outcome`** may be either value; it is validated against **`financial_action`** per the alignment matrix below, then mapped **one-to-one** onto **`bookings.status`**.
    - **`decision`** **`rejected`**: **`outcome`** must be the **contradicting** factual result — **`coach_no_show_claim`** → **`student_no_show`** only; **`student_no_show_claim`** → **`coach_no_show`** only. Any other **`outcome`** for **`rejected`** is **`400`** with **`attendance_rejected_outcome_aligns_with_claim`**. **`financial_action`** follows the same **outcome ↔ money** rules as **`upheld`**/**`partial`** (see **Attendance outcome ↔ financial_action** below): **`coach_no_show`** requires a student refund; **`student_no_show`** requires **`no_change`** (no refund on resolve).
  - **`penalize_role`** (behavior disputes only): **`coach`** | **`student`** | **`none`** for `misconduct`, `lesson_not_completed`. Must be **`none`** for `other`.
    - `decision = upheld|partial` -> must be `coach` or `student`
    - `decision = rejected` -> must be `none`
    - attendance claims must omit `penalize_role`
    - **Reversible philosophy**: a behavior dispute claimant may end up being the penalized party (e.g. a student-opened misconduct claim is concluded against the student because the student was actually at fault). This is **allowed**, not blocked, and produces an advisory entry in `data.warnings[]`:
      - `penalize_role` equals the `opened_by` side (student-opened + `penalize_role=student`, or coach-opened + `penalize_role=coach`) → `behavior_claim_reversal` so moderators confirm the reversal matches the evidence.
      - Admin-opened sustained behavior disputes (`opened_by=admin`) → `behavior_resolution_direction_ambiguous`, because claimant-vs-accused is not inferable from `opened_by`; the admin must consciously pick a side.

  **Alignment (Layer 3) — strict consistency rules (returned as `400` with `code`):**
  - **Unsupported / unknown `dispute_type_code`** → `unsupported_dispute_alignment_type`. Alignment is only defined for `coach_no_show_claim`, `student_no_show_claim`, `misconduct`, `lesson_not_completed`, `other`.
  - **Attendance claims (`coach_no_show_claim`, `student_no_show_claim`):**
    - Missing **`outcome`** (any **`decision`**) → **`attendance_outcome_required`**.
    - `decision = rejected` + **`outcome`** that is not the required contradicting fact (`coach_no_show_claim` requires `student_no_show`; `student_no_show_claim` requires `coach_no_show`) → **`attendance_rejected_outcome_aligns_with_claim`**.
    - **Attendance outcome ↔ financial_action** (all of **`upheld`**, **`partial`**, **`rejected`** after the rejected-outcome check above): **`outcome = coach_no_show`** requires **`financial_action`** of **`refund_student`** or **`refund_student_partial`** (student must be compensated). **`outcome = student_no_show`** requires **`financial_action = no_change`** (no refund on resolve; coach payout follows normal booking rules). Any other pairing → **`attendance_financial_mismatch`**.
    - When **`outcome`** contradicts the opener's claim (student-opened `coach_no_show_claim` resolved as `student_no_show`, or coach-opened `student_no_show_claim` resolved as `coach_no_show`), including **`decision = rejected`** with that **`outcome`**: allowed, but adds advisory **`attendance_claim_reversal`** to `data.warnings[]` when the opener is student/coach (not admin).
  - **Behavior disputes (`misconduct`, `lesson_not_completed`):**
    - `decision = rejected` + any refund → `behavior_rejected_financial`.
    - `decision = rejected` + `penalize_role` not `none` → `behavior_rejected_penalize`.
    - `decision = upheld|partial` + `penalize_role` not `coach`/`student` → `behavior_penalize_required`.
    - `decision = upheld|partial` + `penalize_role = student` + any refund → `behavior_financial_penalize_mismatch` (do not refund the at-fault student through this endpoint).
  - **Joi structural rules** (also `400`): `outcome` is forbidden on behavior types; `penalize_role` is forbidden on attendance types; `refund_amount` is required when `financial_action = refund_student_partial`; legacy `resolution_action_id` field is rejected.

  The API still stores internal `resolution_action_id` mappings on the dispute row for audit/FKs.

  **Consistency (DB + Stripe):** Persisting **`disputes`** as **`resolved`**, updating **`bookings.status`** when **`outcome`** applies, and creating a **`payment_actions`** row (when a refund is needed) happens in **one database transaction**. The database is authoritative for workflow state; Stripe refund execution runs **after** commit via **`processPendingRefundPaymentActions`** (~every **2 minutes**). That avoids “Stripe succeeded / DB rolled back” and “DB committed / Stripe never ran” drift on the HTTP request path; stale or failed executions are surfaced in logs and hourly Stripe reconciliation probes (see **`stripeReconciliationWorker`**). Attendance **`outcome`** transitions are validated (allowed source statuses include **`confirmed`**, **`awaiting_verification`**, **`student_no_show`**, **`coach_no_show`**, **`disputed`**, **`completed`**) — **400** with **`invalid_attendance_status_transition`** otherwise; see `backend/utils/bookingAttendanceStatus.js`.

  **Refunds (money path):** Automatic refunds use the booking’s **latest** payment’s Stripe **charge**. Money returns to the **original payment method** on that charge (typically the **student** who paid). Coaches and admins do not receive these funds via this endpoint.
  - **Single-path guardrail**: when a refund would run (`refund_student` / `refund_student_partial`), if the booking already has any refund activity (pending or already refunded amount), the API returns **409** with `code: refund_path_already_used`. Resolve with `financial_action: no_change` instead, or finish refunds through a single path.

  **Decimal amounts:** `refund_amount` is US dollars. The server converts to **integer cents** with `Math.round(dollars * 100)` before calling Stripe (avoids float drift such as `12.34 * 100`).

  **Idempotency:** Each **`payment_actions`** row gets a stable Stripe idempotency key **`refund_{booking_id}_{payment_action_id}`** (written before the Stripe call once the row has an **`id`**). Migrating installs also copy any legacy **`idempotency_key`** into **`stripe_idempotency_key`** so retries and reconcilers replay the **same** key. Deferred refunds attach Stripe **`metadata`** (`payment_action_id`, `booking_id`) so reconciliation can **`refunds.list` → match → heal DB** without double-charging when Stripe already succeeded.

  **Payouts vs refunds:** Automatic refunds here only hit the **charge** on the booking payment. Coach **payout** timing is handled elsewhere (payout workers, Connect, webhooks). If no payout has been sent, a refund reduces what can be transferred; if a payout **already** completed, recovering funds may require Stripe/support flows—verify in your environment rather than assuming this endpoint reverses transfers.

  **Reliability:**  
  - **Attendance claims** (`coach_no_show_claim`, `student_no_show_claim`): scoring uses **`bookings.status`** after resolve — **not** dispute **`notes`**, **not** who opened the dispute, and **not** **`penalize_role`**. Every attendance resolve supplies **`outcome`**; **`bookings.status`** is updated to match **`outcome`** (subject to transition rules), so reliability and payouts stay tied to a single factual attendance row.
  - Behavior disputes (`misconduct`, `lesson_not_completed`): two fields work together; **`financial_action` does not** decide whether reliability is penalized.
    - **`decision`** — **eligibility:** only **`upheld`** and **`partial`** apply behavior penalty metrics (**`misconduct_penalties`**, **`lesson_not_completed_penalties`**). **`rejected`** applies **no** behavior penalty (`penalize_role` must be `none`).
    - **`penalize_role`** — **who is penalized:** when `decision` is `upheld` or `partial`, set to **`coach`** or **`student`** to select **which user’s** reliability score is updated and which party’s metrics include the incident. The API **does not** infer this from who opened the dispute or the narrative of the claim—admins must set `penalize_role` deliberately. Hybrid validation warnings are **advisory only** and preserve moderator override flexibility; they do not auto-correct or block submission.
  - **`other`** (catch-all support cases): admin reads create-time **`notes`** and optional resolve **`resolution_notes`**. Does **not** redefine attendance (**`outcome`** forbidden), does **not** affect reliability (**`penalize_role`** must be **`none`** / omitted). Any **`financial_action`** is allowed when **`decision`** is **`upheld`** or **`partial`**; **`rejected`** requires **`no_change`**. Use **`notes`** for refund rationale.
    - **Booking status:** **`other`** disputes preserve the lesson outcome — they do not redefine attendance. The only exception is when the booking is temporarily parked in the special **`disputed`** state by the Stripe dispute workflow; resolving an **`other`** dispute releases that temporary parking state and returns the booking to **`completed`**. All other statuses (`completed`, `awaiting_verification`, `student_no_show`, `coach_no_show`, etc.) remain unchanged on resolve.

  **Attendance vs behavior:** Attendance penalties use **`bookings.status`** (`coach_no_show`, `student_no_show`, …) only—attendance disputes do **not** add a parallel reliability bucket; resolving **`coach_no_show_claim` / `student_no_show_claim`** with **`outcome`** updates **`bookings.status`** and scoring reads that row.

  If a refund cannot be **planned** (no charge, nothing left to refund, bad partial amount), the enqueue step fails **before** the resolve transaction — the API returns **400** / **502** and the dispute **stays open**. If enqueue succeeds but the **later** Stripe call fails or is delayed, the dispute is already **resolved**; **`payment_actions.status`** advances to **`succeeded`** or **`failed`** and operators can reconcile via Dashboard / support. **`no_change`** does not enqueue a **`payment_actions`** row.

  **System boundaries (which layer rejects what):** this endpoint composes four layers; failure modes are intentionally split across them so each layer stays focused. Treat alignment as logical-consistency only — it is **not** the place for auth, state, or Stripe checks.

  - **Layer 1 — Authorization (pre-alignment)**
    Owners: auth middleware + role checks in `disputeController.resolveDispute`.
    Responsibility: *Can this user even attempt this action?*
    Examples: non-admin → **403** `"Only admins can resolve disputes"`; missing/invalid JWT → **401**.
  - **Layer 2 — State + domain guards (pre-alignment)**
    Owners: `loadResolveDisputeTypeForValidation` middleware, controller lookups, `bookingAttendanceStatus.js`, `paymentService.getLatestBookingRefundState`.
    Responsibility: *Is this action valid given current system state?*
    Examples: dispute not found → **404**; dispute already `resolved`/`rejected` → **400**; invalid attendance status transition → **400** `invalid_attendance_status_transition`; refund already used on booking → **409** `refund_path_already_used`.
  - **Layer 3 — Alignment (this section)**
    Owners: `backend/utils/disputeResolutionAlignment.js` (hard **400**s) and `backend/utils/disputeResolutionWarnings.js` (advisory `warnings[]`).
    Responsibility: *Is the resolution logically consistent with itself?*
    Examples (block): `attendance_rejected_outcome_aligns_with_claim`, `attendance_outcome_required`, `attendance_financial_mismatch`, `behavior_rejected_financial`, `behavior_rejected_penalize`, `behavior_penalize_required`, `behavior_financial_penalize_mismatch`, `unsupported_dispute_alignment_type`.
    Examples (warn, non-blocking): `attendance_claim_reversal`, `behavior_claim_reversal`, `behavior_resolution_direction_ambiguous`.
  - **Layer 4 — Side-effect execution (post-alignment)**
    Owners: `paymentService`, `stripeService`, payout/refund/reconciliation workers, `updateUserReliability`, booking row updates inside the resolve transaction.
    Responsibility: *Actually move money + update system state.*
    Examples: Stripe refund execution (succeeded/failed/retried via `payment_actions`); payout worker decisions; reliability recomputation; booking status persist.

- **Request body**:
  ```json
  {
    "decision": "upheld | rejected | partial",
    "outcome": "student_no_show | coach_no_show (required for attendance claims; rejected uses contradicting outcome per claim type; financial_action must match outcome — coach_no_show → refund_student|refund_student_partial, student_no_show → no_change)",
    "penalize_role": "coach | student | none (behavior disputes only)",
    "financial_action": "no_change | refund_student | refund_student_partial",
    "resolution_notes": "string (optional, max 1000)",
    "refund_amount": "number (optional) — required when financial_action is refund_student_partial; US dollars, min 0.01"
  }
  ```

- **Errors**:
  - **401** missing/invalid JWT (auth middleware).
  - **403** `"Only admins can resolve disputes"` for non-admin callers.
  - **404** dispute not found.
  - **400** dispute not in a resolvable status (already `resolved` or `rejected`); response includes `current_status`.
  - **400** with one of the Layer 3 alignment codes listed in **Alignment (Layer 3)** above (`attendance_rejected_outcome_aligns_with_claim`, `attendance_outcome_required`, `attendance_financial_mismatch`, `behavior_rejected_financial`, `behavior_rejected_penalize`, `behavior_penalize_required`, `behavior_financial_penalize_mismatch`, `unsupported_dispute_alignment_type`).
  - **400** Joi structural error (missing required `decision`/`financial_action`, forbidden fields for the dispute type, missing `refund_amount` for `refund_student_partial`, legacy `resolution_action_id` supplied).
  - **400** `invalid_attendance_status_transition` when the booking is not in an allowed source status for the chosen attendance outcome (see `backend/utils/bookingAttendanceStatus.js`).
  - **400** / **502** when a refund cannot be planned (no charge, nothing left to refund, partial amount > remaining balance). The dispute stays open.
  - **409** `refund_path_already_used` when another refund path already exists on the booking.

- **Response** (Status: 200): `data` always includes **`dispute`**. The `dispute` object also persists the resolution on the row itself: **`decision`**, **`outcome`** (attendance only, otherwise `null`), and **`refund_amount`** (partial refunds only — US dollars decimal string; `null` for full refunds and `no_change`). When a Stripe refund applies, **`refund`** is included: it is **`queued`** (see below) unless you use a legacy path elsewhere. `resolution` is included with `{ "decision", "financial_action", "outcome?" , "derived_booking_status?" }` (for attendance claims, **`outcome`** and **`derived_booking_status`** are always included).
  For behavior disputes, `resolution` also includes `penalize_role`. When the resolution is allowed but worth confirming, `data.warnings` is present — advisory only, does not change HTTP status. Possible warning `code` values:
  - `behavior_claim_reversal` — sustained behavior dispute penalizes the very party who opened it (student↔student or coach↔coach).
  - `behavior_resolution_direction_ambiguous` — sustained behavior dispute opened by `admin`; claimant-vs-accused direction is not inferable from `opened_by`.
  - `attendance_claim_reversal` — attendance claim resolved with an `outcome` that contradicts the opener's claim (student-opened `coach_no_show_claim` → `student_no_show`, or coach-opened `student_no_show_claim` → `coach_no_show`). Applies to **`upheld`** / **`partial`**, or **`rejected`** (attendance resolves always include **`outcome`**).

  Each warning object has the shape: `{ code, severity: "warning", advisory: true, message, dispute_type_code, decision, ...context }`.
  ```json
  {
    "success": true,
    "message": "Dispute resolved successfully",
    "data": {
      "dispute": {
        "id": 1,
        "booking_id": 1,
        "dispute_type_id": 1,
        "status": "resolved",
        "decision": "upheld",
        "outcome": "coach_no_show",
        "refund_amount": null,
        "resolution_notes": "Approved refund due to service issue",
        "resolved_by_admin": {
          "id": 10,
          "full_name": "Admin User"
        },
        "opened_at": "2026-01-01T00:00:00.000Z",
        "resolved_at": "2026-01-02T00:00:00.000Z"
      },
      "resolution": {
        "decision": "upheld",
        "outcome": "coach_no_show",
        "financial_action": "refund_student",
        "derived_booking_status": "coach_no_show"
      },
      "refund": {
        "queued": true,
        "payment_action_id": 7,
        "payment_id": 42,
        "refund_amount": "45.00",
        "refund_status": "pending_stripe_execution",
        "stripe_refund_id": null
      },
      "warnings": [
        {
          "code": "behavior_claim_reversal",
          "severity": "warning",
          "advisory": true,
          "message": "Behavior resolution penalizes the dispute claimant (student opened, student penalized). Confirm this reversal matches the evidence.",
          "dispute_type_code": "misconduct",
          "decision": "upheld",
          "opened_by": "student",
          "penalize_role": "student"
        }
      ]
    }
  }
  ```
  `refund` is present when a **`payment_actions`** row was inserted for Stripe execution. **`refund_amount`** may be **`null`** for full refunds until the worker snaps remaining cents from Stripe. After the worker runs, **`stripe_refund_id`** and payment rows update as for other refunds; the worker uses the same idempotency keys as before. `resolution` is present for explicit attendance resolves. `warnings` is omitted entirely when no advisory applies.

---

## Notifications (`/api/notifications`)

**In-app navigation convention:** For the notification bell, filter `channel === 'in_app'`. Render with `payload.headline` / `payload.summary` / optional `payload.preview`; on tap, `if (notification.payload?.route) navigate(notification.payload.route)` — no per-type copy or routing on the client.

**In-app UI contract:** Every in-app notification payload includes **`headline`** and **`summary`** (and usually **`route`**). Optional **`preview`**. Keep **`summary`** to one short sentence for the bell; put reasons, notes, and refunds in structured fields (`reason_line`, `message_to_student`, `refund_line`, etc.). Extra keys (`booking_id`, `coach_name`, …) are metadata only. Types covered: `booking_confirmed`, `booking_request_coach`, `booking_declined`, `booking_cancelled`, `pre_lesson_24h`, `pre_lesson_1h`, `new_message`, `stripe_payouts_disabled`, `stripe_payouts_enabled` (route: `/coach/onboarding`).

**Code layout (MVP):** Orchestration in `services/notificationService.js`. Presentation under `notifications/` — `payloadBuilders.js` (in-app copy), `emailTemplates.js` / `smsTemplates.js` (delivery copy), `notificationRoutes.js` (`payload.route`).

**Backend convention (new types):** Set `headline`, `summary`, and `payload.route` when creating the row unless there is intentionally nowhere to go. Explicit `route` is preferred (`/reviews/15`, `/disputes/21`, etc.). Existing booking and chat types may rely on fallbacks (`booking_id`, `conversation_id`) via `withNotificationRoute`. Email-only auth notifications (password reset, verify email) typically omit the in-app UI fields.

### `GET /api/notifications/unread-count`
- **Auth**: Required
- **Description**: Lightweight **navbar / bell badge** count for the authenticated user. Counts **in-app** notifications where `read_at` is null. Does **not** return notification rows — use `GET /api/notifications` when the panel is opened.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Unread notification count retrieved successfully",
    "data": {
      "count": 3
    }
  }
  ```
- **Frontend pattern**: poll or fetch on navbar mount → show `🔔 count` when `count > 0` → open panel with `GET /api/notifications` → on tap `PUT /api/notifications/:id/read` → refresh unread-count.

### `GET /api/notifications`
- **Auth**: Required
- **Description**: Get user's notifications. Omit `page`/`limit` to return all matching notifications (server-capped). Provide `page` or `limit` to paginate and include `pagination`.
- **DTO contract**: **`payload`** is redacted before returning to clients — tokens and magic-link URLs (`reset_token`, `verify_url`, `reset_url`, `confirm_url`, etc.) are stripped. Business context (booking id, coach name, lesson title) is preserved. **`payload.route`** drives in-app navigation: explicit `route` wins; otherwise derived (`new_message` → `/messages/:conversation_id`, booking events → `/bookings/:booking_id`). Older rows without `route` are enriched on read. Future types (e.g. `review_received` → `/reviews/15`, `dispute_resolved` → `/disputes/21`) only need `route` in the payload — no helper change.
- **Query Parameters**: Optional `status`, optional `page`, optional `limit`
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Notifications retrieved successfully",
    "data": [
      {
        "id": 1,
        "user_id": 1,
        "type": "booking_confirmed",
        "channel": "in_app",
        "payload": {
          "title": "Booking Confirmed",
          "message": "Your booking has been confirmed"
        },
        "read_at": null,
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `POST /api/notifications`
- **Auth**: Required (Admin only)
- **Description**: Create and **send** a notification (admin only). Creates the row then calls `sendNotification()` so `in_app` becomes `sent` immediately; `email`/`sms` attempt delivery via the configured provider (may end `sent` or `failed`).
- **Request Body**:
  ```json
  {
    "user_id": "number (required)",
    "type": "string (required)",
    "channel": "string (required)",
    "payload": "object (optional)",
    "entity_type": "string (optional)",
    "entity_id": "number (optional)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Notification created successfully",
    "data": {
      "id": 1,
      "user_id": 1,
      "type": "system",
      "channel": "in_app",
      "payload": {
        "headline": "System Notification",
        "summary": "This is a system notification"
      },
      "status": "sent",
      "sent_at": "2026-01-01T00:00:00.000Z",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/notifications/:id/read`
- **Auth**: Required
- **Description**: Mark notification as read (own notification or admin). Sets `read_at` if not already set and keeps `status` as `sent`. **Idempotent:** calling again when already read still returns **200** and does **not** change the original `read_at`. Unread for a bell UI ≈ `read_at` is null.
- **Response** (Status: 200): Notification object with updated `read_at` / status.

### `DELETE /api/notifications/:id`
- **Auth**: Required
- **Description**: Delete/dismiss a notification (**hard delete**). Users can only delete their own notifications; admins can delete any. Use to clear read or unwanted in-app notifications.
- **Response** (Status: 200): `{ "success": true, "message": "Notification deleted successfully", "data": null }`
- **Error responses**: `403` (not your notification and not admin), `404` (not found), `500` (server error).

---

## Admin (`/api/admin`)

### `GET /api/admin/dashboard`
- **Auth**: Required (Admin only)
- **Description**: Get admin dashboard statistics
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Dashboard stats retrieved successfully",
    "data": {
      "users": {
        "total_students": 150,
        "total_coaches": 25
      },
      "bookings": {
        "total": 500,
        "active": 45
      },
      "revenue": {
        "total": 25000.00,
        "commissions": 2000.00
      },
      "disputes": {
        "pending": 3
      }
    }
  }
  ```

### `POST /api/admin/users`
- **Auth**: Required (Admin only)
- **Description**: Create an admin user account
- **Request Body**:
  ```json
  {
    "full_name": "string (required)",
    "email": "string (required, valid email)",
    "password": "string (required, min 10 chars, at least one lowercase, one uppercase, one number; symbols optional)",
    "phone": "string (optional)",
    "timezone": "string (optional, defaults to 'UTC')"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Admin account created successfully",
    "data": {
      "id": 10,
      "full_name": "Admin User",
      "email": "admin@example.com",
      "role": "admin",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `GET /api/admin/audit-logs`
- **Auth**: Required (Admin only)
- **Description**: List audit log entries for security, support, and compliance. Each entry records who did what, to which record, and from where.
- **Query Parameters**:
  - `page`: number (optional, default: 1)
  - `limit`: number (optional, default: 10, max: 100)
  - `user_id`: number (optional) – filter by acting user id
  - `action`: string (optional) – filter by action name (e.g. `user_registered`, `password_changed`, `email_change_completed`, `booking_created`)
  - `table_name`: string (optional) – filter by table name (e.g. `users`, `bookings`, `payments`)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Audit logs retrieved successfully",
    "data": [
      {
        "id": 1,
        "user_id": 10,
        "action": "password_changed",
        "table_name": "users",
        "record_id": 42,
        "before_state": { "id": 42, "email": "old@example.com" },
        "after_state": { "password_changed": true, "token_version": 3 },
        "ip_address": "203.0.113.10",
        "user_agent": "PostmanRuntime/7.36.0",
        "created_at": "2026-02-24T12:00:00.000Z"
      }
    ]
  }
  ```
- **Notes**:
  - Results are paginated; see pagination section for format.
  - **`before_state` / `after_state`**: secrets (`password_hash`, reset/verification tokens, etc.) are **redacted** as `"[REDACTED]"` in API responses.
  - Use filters to narrow down to specific users, actions, or tables when investigating issues.
  - **Refund / payout / cancellation (support tooling)** — filter `action` on these names when reconciling money movement:
    | `action` | Typical `table_name` | What to use in `after_state` |
    |----------|----------------------|--------------------------------|
    | `cancellation_financials` | `bookings` | `refund_cents`, `retained_penalty_cents`, `total_charge_cents`, `payment_id`, `cancellation_history_id`, `is_late_cancel`, `cancelled_by`, `penalty_reason` |
    | `refund_initiated` | `payments` | `refund_cents`, `remaining_on_charge_after_refund_cents`, `charge_amount_cents`, `refunded_so_far_before_cents`, `partial_refund`, `stripe_refund_id` |
    | `payout_created` | `payouts` | `payout_amount`, `payout_status`, `booking_id`, `booking_status`, `payment_escrow_status`, `coach_payout_expected`, `transfer_id`, `stripe_connect_used` |
    | `payout_finalized_from_stripe` | `payouts` | `transfer_id`, `escrow_status`, `booking_id`, `payment_id`, `payout_status` |
    Related cancel flow (same booking): `booking_cancelled`, `cancellation_recorded` on `bookings` / `cancellation_history` — pair with `cancellation_financials` for full context.
    Other payment lifecycle entries (optional filters): `payment_created`, `payment_captured`; retries: `payment_retry_attempted`, `payout_retry_attempted`.

### `PUT /api/admin/users/:id/reliability`
- **Auth**: Required (Admin only)
- **Description**: Manually adjust one **`user_reliability`** row for the user in the path. Rows are keyed by **`user_id` + `role`** (`coach` or `student`), so coach and student scores are independent.
  - **`role` defaults to `coach`** when omitted. Use that to adjust **coach** reliability for coach-only users, or for **dual-role** users when you intend to change the coach score.
  - To adjust **student** reliability, send **`"role": "student"`** in the body. Required for **student-only** users (otherwise the default `coach` row does not apply and the API returns 400 with a hint).
  - **Dual-role users** (coach + student): call this endpoint **twice** if you need to set both scores—once with default/`"role": "coach"` and once with `"role": "student"`.
- **Request Body**:
  ```json
  {
    "new_score": "number (required, 0-100)",
    "role": "string (optional: coach | student; default coach)",
    "reason": "string (optional)",
    "explanation": "string (optional)"
  }
  ```
- **Example request body** (change `"role"` to `"student"` or omit it for coach default):
  ```json
  {
    "new_score": 85,
    "role": "coach",
    "reason": "Manual adjustment",
    "explanation": "Support override after review"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Reliability score adjusted successfully",
    "data": {
      "user_id": 1,
      "role": "coach",
      "user_roles": ["coach", "student"],
      "previous_score": 100.00,
      "new_score": 85,
      "adjusted_by": 10,
      "reason": "Manual adjustment",
      "explanation": "Support override after review"
    }
  }
  ```

### `GET /api/admin/users/:id/reliability`
- **Auth**: Required (Admin only)
- **Query parameters**:
  - **`role`** (optional): **`coach`** \| **`student`**. Selects which **`user_reliability`** row to return.
  - **Omitted**: defaults to **`coach`** if the target user has the coach role, otherwise **`student`** if they have the student role. Returns **`400`** if the requested **`role`** does not match the user’s roles, or if **`role`** is invalid.
- **Description**: Full reliability breakdown for support and investigation. This is **not** the same as a coach’s self-service read: authenticated coaches use **`GET /api/coaches/me/reliability`** for a **curated detail DTO** without decay triplets or engine diagnostics. Response is always **`data.reliability`**, with a **`role`** field (**`"coach"`** or **`"student"`**). **`reliability_score`**, canonical **`user_reliability`** metrics (recent / decayed / total per penalty bucket, booking baseline, smoothing metadata), and **`penalties.points`** are all derived from the **same** math as `reliabilityEngine.calculateReliabilityScoreFromPersistenceRow` (see **`docs/reliability-system.md`**). **`legacy_aliases`** mirrors older JSON field names (`total_bookings`, `late_cancels`, …) for backward-compatible clients.
- **Coach (`data.reliability.role` = `"coach"`)** — **`penalties`**:
  - Each scored category is an object **`{ recent, decayed, total }`** matching persisted `user_reliability` columns (`late_cancels_*`, `coach_cancels_non_late_*`, `no_shows_*`, behavior dispute buckets, etc.).
  - **`penalties.points`** lists per-bucket **point deductions** (same weights as the scorer). Coach includes **`late_cancels`**, **`no_shows`**, **`coach_cancels_non_late`**, **`misconduct_penalties`**, **`lesson_not_completed_penalties`**.
  - **`scoring`**: **`denominator`** = `max(1, booking_baseline_total + smoothing_k)` as stored; **`reconstructed_from_metrics`** reproduces the score from persisted columns alone; **`score_matches_recomputed`** is true when **`score_source`** is **`computed`** and the persisted score matches reconstruction (within tolerance).
- **Student (`data.reliability.role` = `"student"`)** — same shape; **`penalties.student_cancels_non_late`** uses **`student_cancels_non_late_*`** columns (no overloaded coach column). Student **`penalties.points`** includes **`late_cancels`**, behavior keys, **`attendance_no_show`**, and **`student_cancels_non_late`**.
- **Response** (Status: 200): **`message`** is **`Reliability retrieved successfully`**. Example (**coach**):
  ```json
  {
    "success": true,
    "message": "Reliability retrieved successfully",
    "data": {
      "reliability": {
        "role": "coach",
        "user_id": 2,
        "reliability_score": "85.50",
        "last_updated": "2026-03-16T18:42:26.000Z",
        "total_bookings": 10,
        "penalties": {
          "late_cancels": 0,
          "misconduct_penalties": 1,
          "lesson_not_completed_penalties": 0,
          "no_shows": 0,
          "coach_cancels_non_late": 1,
          "points": {
            "misconduct": 2.5,
            "lesson_not_completed": 0,
            "attendance_no_show": 0
          }
        },
        "badges": null
      }
    }
  }
  ```

### `GET /api/admin/coaches/:coachId/courts`
- **Auth**: Required (Admin only)
- **Description**: List courts linked to a coach (for support/moderation). Use when an admin needs to view or fix a coach's court list. **Path**: `coachId` = coach's **user id** (`users.id`). Response is an **explicit DTO** (not raw Sequelize); only the fields below are returned — e.g. `rate_modifier` is omitted.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach courts retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 2,
        "court_id": 5,
        "coach_notes": "Optional coach-specific text",
        "created_at": "2026-01-01T12:00:00.000Z",
        "updated_at": "2026-01-01T12:00:00.000Z",
        "court": {
          "id": 5,
          "name": "City Park",
          "address_line1": "123 Main St",
          "city": "New York",
          "state": "NY",
          "postal_code": "10001",
          "country": "US",
          "latitude": 40.7128,
          "longitude": -74.006,
          "is_private": false,
          "created_by": { "id": 2, "full_name": "Coach Name" }
        }
      }
    ]
  }
  ```
- **Error responses**: `403` (not admin), `404` (coach not found), `500` (server error).

### `DELETE /api/admin/coaches/:coachId/courts/:courtId`
- **Auth**: Required (Admin only)
- **Description**: Unlink a court from a coach (e.g. wrong court linked). **Path**: `coachId` = coach's user id, `courtId` = **court** id (`court_locations.id`, same as `court_id` / nested `court.id` from GET /api/admin/coaches/:coachId/courts).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court removed from coach",
    "data": {
      "coach_id": 5,
      "court_id": 12,
      "name": "Central Park Pickleball Court"
    }
  }
  ```
- **Error responses**: `403` (not admin), `404` (coach not found or coach not linked to that court), `500` (server error).

### `DELETE /api/admin/coaches/:coachId/availability/:id`
- **Auth**: Required (Admin only)
- **Description**: Delete a coach's availability slot (e.g. wrong times). **Path**: `coachId` = coach's user id, `id` = availability record id (from `GET /api/coaches/:id/availability` as admin, or `GET /api/coaches/me/availability` for the coach’s own list).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Availability deleted successfully",
    "data": null
  }
  ```
- **Error responses**: `403` (not admin), `404` (coach or availability not found), `500` (server error).

---

## Webhooks (`/api/webhooks`)

### `POST /api/webhooks/stripe`
- **Auth**: None (uses Stripe signature verification)
- **Description**: Stripe webhook endpoint for payment events
- **Headers**: `Stripe-Signature` (required for signature verification)
- **Request Body**: Stripe webhook event JSON
- **Response**: Success acknowledgment

---

## Error Responses

Error responses vary slightly by source:

**From controllers** (e.g. invalid token, not found, conflict):
```json
{
  "success": false,
  "message": "Error message"
}
```

**From validation middleware** (invalid request body or query):
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [ { "field": "fieldName", "message": "Validation message" } ],
  "requestId": "uuid"
}
```

**Status codes**: `400` Bad Request, `401` Unauthorized, `403` Forbidden, `404` Not Found, `409` Conflict, `500` Internal Server Error.

## Success Responses

All endpoints return consistent success responses:

```json
{
  "success": true,
  "data": {},
  "message": "Success message"
}
```

## Notes on Request Bodies

- **Optional Fields**: For update endpoints, omit fields you don't want to update. Setting a field to `null` or `""` will update the database to that value.
- **Validation**: Endpoints with validation schemas will strip unknown fields and validate field types/ranges.
- **Defaults**: Fields marked with defaults will use the default value if not provided.
- **Required vs Optional**: Required fields must be included. Optional fields can be omitted entirely.

## Notes on Responses

- **Consistent Structure**: All successful responses follow the format:
  ```json
  {
    "success": true,
    "message": "Success message",
    "data": { /* response data */ }
  }
  ```

- **Error Responses**: See the "Error Responses" section and per-endpoint "Error responses" lines. Controller errors use `success: false` and `message`; validation errors use `error: "Validation failed"`, `details`, and `requestId`.

- **Pagination**: Paginated endpoints return data in the `data` field as an array, with pagination metadata included.

- **Status Codes**: 
  - `200` - Success (GET, PUT, DELETE)
  - `201` - Created (POST)
  - `400` - Bad Request (validation errors)
  - `401` - Unauthorized (missing/invalid token)
  - `403` - Forbidden (insufficient permissions)
  - `404` - Not Found
  - `409` - Conflict (duplicate resource)
  - `500` - Internal Server Error
