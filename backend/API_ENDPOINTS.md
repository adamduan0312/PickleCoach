# API Endpoints Reference

Complete list of all API endpoints with detailed field specifications.

**Base URL**: All endpoints are prefixed with `/api`

**Authentication**: Most endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

**Response convention**: For create/update endpoints, the response body echoes all **safe** request-body fields (same keys, with `null` when optional and unset) so clients see a consistent shape and can easily compare request vs response in Postman. Sensitive fields (e.g. password) are never returned.

**Delete behavior**: **Soft delete** (set `deleted_at` / `is_active: false`, row kept): users (self-delete `DELETE /api/auth/me`, admin `DELETE /api/users/:id`), coach profile (when user is deleted), courts (`DELETE /api/courts/:id`), lessons (`DELETE /api/lessons/:id`). **Hard delete** (row removed): coach availability (`DELETE /api/coaches/availability/:id` coach-only, or `DELETE /api/admin/coaches/:coachId/availability/:id` admin), coach–court link (`DELETE /api/coaches/me/courts/:id` coach-only, or `DELETE /api/admin/coaches/:coachId/courts/:courtId` admin), reviews (`DELETE /api/reviews/:id`). Bookings are cancelled via `POST /api/bookings/:id/cancel`, not deleted.

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
    "password": "string (required, min 8 chars)",
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
        "role": "student",
        "phone": null,
        "timezone": "UTC",
        "avatar_url": null,
        "email_verified_at": null
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Note**: All safe request fields (full_name, email, role, phone, timezone, avatar_url) are echoed in the response; optional ones are `null` when not sent. `email_verified_at` is included so the client can show verification status. Avatar can also be set or changed later via `PUT /api/auth/profile`.
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
        "role": "student",
        "avatar_url": null,
        "email_verified_at": "2026-01-15T10:00:00.000Z"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Note**: The `user` object includes `email_verified_at` (ISO date or `null`) so the client can show verification status and avoid unnecessary verify-email calls.
- **Error responses**: `400` (validation failed – invalid body), `401` (invalid credentials), `403` (account inactive), `500` (server error).

### `POST /api/auth/refresh`
- **Auth**: Bearer token (can be expired)
- **Description**: Refresh an expired JWT token. The submitted token’s `tokenVersion` must match the user’s current `token_version` in the database (otherwise the token was revoked, e.g. after password reset or admin email change).
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
        "role": "student",
        "avatar_url": null,
        "email_verified_at": null
      }
    }
  }
  ```
- **Error responses**: `401` (invalid token, user inactive, or **token revoked** — `tokenVersion` in the JWT no longer matches the user; use login to obtain a new token).

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
    "password": "string (required, min 8 chars)"
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
      "details": [ { "field": "password", "message": "\"password\" length must be at least 8 characters long" } ],
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
    "new_password": "string (required, min 8 chars)"
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
- **Error responses**: `400` (missing fields, new_password too short, or current_password incorrect), `401` (missing or invalid token), `500` (server error).

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
  - Otherwise generates an `email_verification_token` and `email_verification_expires` (24h) and sends an `email_verification` email with a link like:
    `https://frontend/verify-email?token=...`.
- **Error responses**: `401` (missing or invalid token), `500` (server error).

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
  - Sets `email_verified_at` if not already set, and clears the verification token/expiry.
- **Error responses**: `400` (invalid or expired verification token), `500` (server error).

### `GET /api/auth/profile`
- **Auth**: Required
- **Description**: Get current authenticated user's profile.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Profile retrieved successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "roles": ["coach"],
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": "https://example.com/avatar.jpg",
      "coachProfile": { }
    }
  }
  ```
- **Reliability** (optional): When a matching `user_reliability` row exists, the response may also include:
  - **`reliability`** — full **`user_reliability`** object for **`role: "coach"`** (present when the user has the coach role and a coach row exists).
  - **`reliability_student`** — full **`user_reliability`** object for **`role: "student"`** (present when the user has the student role and a student row exists). Dual-role users may receive both.
- **Notes**: The profile includes `email_verified_at` (ISO date or `null`) for verification status. For dedicated breakdowns with paid-reschedule overrides, coaches use **`GET /api/coaches/me/reliability`** and students **`GET /api/students/me/reliability`**.
- **Error responses**: `401` (missing or invalid token), `500` (server error).

### `PUT /api/auth/profile`
- **Auth**: Required
- **Description**: Update current authenticated user's profile
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "full_name": "string (optional)",
    "phone": "string (optional, max 30 chars)",
    "timezone": "string (optional)",
    "avatar_url": "string (optional, max 255 chars)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Profile updated successfully",
    "data": {
      "id": 1,
      "full_name": "John Updated",
      "email": "john@example.com",
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": "https://example.com/avatar.jpg"
    }
  }
  ```
- **Error responses**: `400` (validation failed – invalid body), `401` (missing or invalid token), `500` (server error).

### `PUT /api/auth/me/role`
- **Auth**: Required
- **Description**: Switch your account between **student** and **coach** without deleting the account. Admins cannot use this (use admin user management). If you switch to coach and don't have a coach profile yet, create one with `POST /api/coaches/profile`. If you had a coach profile before switching to student, it is kept so switching back to coach restores your listing.
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
    "message": "Role updated successfully. Use the new token for subsequent requests.",
    "data": {
      "user": {
        "id": 1,
        "full_name": "Jane Doe",
        "email": "jane@example.com",
        "role": "coach",
        "phone": "+1234567890",
        "timezone": "America/New_York",
        "avatar_url": null
      },
      "token": "eyJhbGciOiJIUzI1NiIs..."
    }
  }
  ```
- **Error responses**: `400` (invalid role), `403` (admin cannot use this endpoint), `401` (missing or invalid token), `500` (server error).

### `DELETE /api/auth/me`
- **Auth**: Required
- **Description**: Delete the current user's account (**soft delete**). Sets `deleted_at` and `is_active: false` on the user; if the user has a coach profile, it is also soft-deleted. The user can no longer log in. **Not available to admins** (admins must use admin user management).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Account deleted successfully",
    "data": null
  }
  ```
- **Error responses**: `403` (admin cannot use this endpoint), `401` (missing or invalid token), `500` (server error).

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
  - `POST /api/bookings` (create booking)
  - `POST /api/disputes` (create dispute)
  - `POST /api/reviews` (create review)
  - `POST /api/messages/conversations` and `POST /api/messages/send` (booking-scoped messaging)
  - The frontend should:
    - Show a non-blocking banner after signup/first login prompting verification.
    - Automatically call `POST /api/auth/verify-email/request` when the user asks to resend.

---

## Users (`/api/users`)


**User lifecycle (best practice):**
- **`deleted_at`**: Soft-delete. When set, the account is treated as deleted (data kept for audit). Login and list endpoints exclude deleted users unless otherwise specified.
- **`is_active`**: Whether the account can log in and appear in “active” lists (e.g. coach directory). When an admin or user deletes an account, the code sets both `deleted_at` and `is_active: false`, so **deleted ⇒ inactive**. The reverse is not required: an admin can set `is_active: false` without deleting (e.g. suspend). So **inactive does not imply deleted**.
- **List behavior**: `GET /api/users` filters only by **deletion** (use `include_deleted=true` to include soft-deleted). Each user in the response includes `is_active`; filter or display active/inactive on the client if needed.

### `GET /api/users`
- **Auth**: Required (Admin only)
- **Description**: Get all users (admin only). By default returns only non–soft-deleted users. If `limit` is omitted, returns all matching users in `data`. If `limit` is provided (with optional `page`), response includes `pagination`.
- **Query Parameters**:
  - `page`: number (optional; used when `limit` is provided, default 1)
  - `limit`: number (optional; provide to paginate. Omit to return all matching users)
  - `role`: string (optional, filter by role: 'student' | 'coach' | 'admin')
  - `include_deleted`: string `'true'` | `'false'` (optional). If `'true'`, includes soft-deleted users; default is non-deleted only.
  - `search`: string (optional). Filters users by **full name** or **email** (case-insensitive, partial match). Use for admin "find user" without scrolling the full list.
- **Note**: Response items include `is_active`; use client-side filtering or display by active/inactive as needed.
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
        "roles": ["student"],
        "is_active": true,
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```
  Each user includes a `roles` array (from the `user_roles` table); a user may have multiple roles (e.g. `["coach", "admin"]`). Note: Pagination info is included in the response structure (see pagination section).

### `GET /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Get user by ID (admin only). Non-admins should use `GET /api/auth/profile` for their own profile.
- **Reliability**: Users with the **coach** role may include **`reliability`** (the `user_reliability` row with `role: "coach"`). Users with the **student** role may include **`reliability_student`** (row with `role: "student"`). Dual-role users can have both.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "User retrieved successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "roles": ["coach"],
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": null,
      "is_active": true,
      "coachProfile": {
        "id": 1,
        "user_id": 1,
        "bio": "Experienced coach",
        "hourly_rate": 50.00,
        "skill_rating": 4.5,
        "rating_system": "self"
      },
      "reliability": {
        "user_id": 1,
        "role": "coach",
        "reliability_score": 95.5
      }
    }
  }
  ```

### `PUT /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Update user (admin only - can update role, is_active, email, avatar_url, etc.). If **`email`** is changed to a new value, **`token_version`** is incremented so **all** of that user’s sessions (every device) are invalidated — the user must log in again.
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "full_name": "string (optional)",
    "email": "string (optional, must be unique; 400 if already in use)",
    "phone": "string (optional, max 30 chars)",
    "timezone": "string (optional)",
    "avatar_url": "string (optional, URI or empty string to clear)",
    "is_active": "boolean (optional, admin only)",
    "role": "string (optional, admin only, 'student' | 'coach' | 'admin')"
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
      "role": "coach",
      "is_active": true,
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": null
    }
  }
  ```

### `DELETE /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: **Soft delete** user (admin only). Sets `deleted_at` and `is_active: false` on the user; if the user has a coach profile, it is also soft-deleted. Deleted users are excluded from list/get and cannot log in.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "User deleted successfully",
    "data": null
  }
  ```
- **Error responses**: `400` (user already deleted), `404` (user not found), `500` (server error).

---

## Coaches (`/api/coaches`)

### `GET /api/coaches` (List / search coaches)
- **Auth**: Required (student or admin only). Coaches cannot use this endpoint (403).
- **Description**: List/search coaches with optional filters. Use **lat**, **lng**, and **radius** to find coaches who have courts within that distance (e.g. "coaches near me"). If `page`/`limit` are omitted, returns all matching coaches in `data` (server-capped). If `page` or `limit` is provided, response includes `pagination`. **Each coach includes `reliability`**: `{ "reliability_score", "last_updated" }` for marketplace display. If there is no coach `user_reliability` row yet, **`reliability_score`** defaults to **100** and **`last_updated`** is **`null`**.
- **Query Parameters**:
  - `lat` (optional) – latitude in degrees (center point for distance filter)
  - `lng` (optional) – longitude in degrees (center point for distance filter)
  - `radius` (optional) – miles from (lat, lng); default 10, max 500
  - `min_skill_rating` (optional) – numeric **self-reported** playing level **≥** this value (**2.0–6.0**, **0.5** steps). Excludes coaches with **`skill_rating`** unset (`null`).
  - `max_skill_rating` (optional) – **≤** this value; same rules. Cannot be less than `min_skill_rating` when both are sent.
  - `min_rating` (optional) – minimum **review** `rating_average` (0–5), distinct from skill
  - `page` (optional) – page number (used when paginating)
  - `limit` (optional) – items per page; provide to paginate (omit for all results)
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coaches retrieved successfully",
    "data": [
      {
        "id": 2,
        "full_name": "Jane Coach",
        "email": "jane@example.com",
        "coachProfile": {
          "headline": "CPR certified",
          "hourly_rate": 50.00,
          "skill_rating": 4.5,
          "rating_system": "self",
          "rating_average": 4.8
        },
        "reliability": {
          "reliability_score": 85.5,
          "last_updated": "2026-03-16T18:42:26.000Z"
        }
      }
    ]
  }
  ```
  (Actual objects include other user/profile/join fields; **`reliability`** is always present on each item as above.)

### `GET /api/coaches/:id`
- **Auth**: Required. **Roles**: Student, Admin only (coaches get 403).
- **Description**: Get coach details by ID (for students viewing a coach profile, or admins). Includes the same **`reliability`** summary as list search: **`reliability_score`** and **`last_updated`** (defaults **100** / **`null`** when no row).
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
- **Auth**: Required. **Roles**: Student, Admin only.
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
- **Description**: Get the authenticated coach's reliability breakdown + score (raw `user_reliability` coach row). Includes penalized-impact counters: **`no_shows`** from **`bookings.status`**, and behavior penalty counts from sustained behavior disputes (**`late_arrival_penalties`**, **`misconduct_penalties`**, **`lesson_not_completed_penalties`**).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach reliability retrieved successfully",
    "data": {
      "reliability": {
        "user_id": 2,
        "total_bookings": 10,
        "reschedules": 2,
        "paid_reschedules": 1,
        "late_cancels": 0,
        "late_arrival_penalties": 1,
        "misconduct_penalties": 1,
        "lesson_not_completed_penalties": 0,
        "no_shows": 0,
        "coach_cancels": 1,
        "reliability_score": 85.5,
        "badges": null,
        "last_updated": "2026-03-16T18:42:26.000Z"
      }
    }
  }
  ```

### `POST /api/coaches/profile`
- **Auth**: Required (coach role only)
- **Description**: Create your own coach profile. Coach-only: only the authenticated coach can create a profile; profile is always for the logged-in user. Admins cannot use this endpoint.
- **Skill rating**: Self-reported pickleball level on a **2.0–6.0** scale, **half-point** steps only (e.g. 3.0, 3.5, 4.0). Optional; leave unset until the coach enters it. **`rating_system`** defaults to **`"self"`** (MVP; not verified / not DUPR).
- **Request Body**:
  ```json
  {
    "headline": "string (optional)",
    "bio": "string (optional)",
    "hourly_rate": "number (optional, defaults to 0)",
    "experience_years": "number (optional, defaults to 0)",
    "skill_rating": "number | null (optional, 2.0–6.0 in 0.5 steps)",
    "rating_system": "string (optional, default: self)",
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
      "hourly_rate": 50.00,
      "experience_years": 10,
      "skill_rating": 4.5,
      "rating_system": "self",
      "certifications": "USAPA Certified",
      "location": "New York, NY",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/coaches/profile/:id`
- **Auth**: Required
- **Description**: Update coach profile. Path parameter `:id` is the coach's **user id** (same as GET /api/coaches/:id).
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "headline": "string (optional)",
    "bio": "string (optional)",
    "hourly_rate": "number (optional)",
    "experience_years": "number (optional)",
    "skill_rating": "number | null (optional, clear with null)",
    "rating_system": "string (optional)",
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
      "hourly_rate": 60.00,
      "experience_years": 12,
      "skill_rating": 4.5,
      "rating_system": "self"
    }
  }
  ```

### Availability vs lessons
- **Lessons** = *what* the coach offers (e.g. "1hr private", "90min clinic"). Created via `POST /api/lessons`.
- **Availability** = *when* the coach is free (e.g. "Mondays 9am–5pm"). Created via `POST /api/coaches/availability`.
- Both are required for booking: the student picks a lesson and a time; the time must fall within the coach's availability and the lesson's constraints.

### `POST /api/coaches/availability`
- **Auth**: Required
- **Description**: Create coach availability slot. Defines *when* the coach can be booked (by weekday and optional date/time window).
- **Request Body**:
  - **Recommended for recurring weekly slots** (e.g. "Mondays 9am–5pm"): use `weekday` + `start_date` / `end_date` + **`start_time`** / **`end_time`** (time-of-day only, e.g. `"09:00"`, `"17:00"`). No need to send full `start_datetime`/`end_datetime`. Times are interpreted in the **coach's timezone**.
  - `start_date` / `end_date`: Optional **date range** when this slot is valid (e.g. "2026-01-31" to "2026-12-30").
  - `start_time` / `end_time`: Optional **time-of-day only** (e.g. `"09:00"` or `"17:00:00"`). Use for recurring weekly windows; interpreted in coach timezone.
  - `start_datetime` / `end_datetime`: Optional **full timestamps** for one continuous window (alternate input format). If you use `start_time`/`end_time`, you do not need these.
  - `weekday`: 0–6 (Sunday–Saturday) or name (e.g. `"monday"`). Evaluated in the **coach's timezone** when checking bookings.
  ```json
  {
    "coach_id": "number (required for coach; optional for admin - defaults to authenticated user's ID)",
    "weekday": "number 0-6 or string (e.g. 'monday')",
    "start_time": "string (optional, e.g. '09:00' or '09:00:00')",
    "end_time": "string (optional, e.g. '17:00' or '17:00:00')",
    "start_datetime": "string (optional, ISO 8601 date-time)",
    "end_datetime": "string (optional, ISO 8601 date-time)",
    "start_date": "string (optional, ISO 8601 date)",
    "end_date": "string (optional, ISO 8601 date)",
    "recurrence_rule": "string (optional)",
    "is_available": "boolean (optional, defaults to true)"
  }
  ```
- **Example – Mondays 9am–5pm from Feb 1 to Dec 1**: `{ "coach_id": 2, "weekday": "monday", "start_date": "2026-02-01", "end_date": "2026-12-01", "start_time": "09:00", "end_time": "17:00" }`
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
      "is_available": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `GET /api/coaches/:id/availability`
- **Auth**: None required
- **Description**: Get coach availability (public). Each item may include `start_time`/`end_time` (time-of-day), and/or `start_datetime`/`end_datetime`, and/or `start_date`/`end_date`. Omit `page`/`limit` to return all matching rows (server-capped). Provide `page` or `limit` for paged mode.
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
        "is_available": true
      }
    ]
  }
  ```

### `DELETE /api/coaches/availability/:id`
- **Auth**: Required (Coach only)
- **Description**: Delete a coach availability slot (**hard delete**). Coaches can only delete their own availability. `:id` is the availability record id (from GET coach availability or POST create response).
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
- **Create courts** (public or private): Use **`POST /api/courts`** only. Body: `name` (required), optional `address`, `latitude`, `longitude`, `is_private` (default false), `notes`. If a **coach** creates the court, they are **automatically linked** to it. **Distance rule:** If the coach already has other courts, the new court must be within **100 miles** of one of them (prevents listing courts they can't coach at).
- **Add an existing court to your list**: Use **`POST /api/coaches/me/courts`** when the court already exists. Body: `court_id` (required), optional `rate_modifier`, `preferred`, `notes`. **Distance rule:** If the coach already has other courts, the new court must be within **100 miles** of one of them.
- **Remove a court** (e.g. when moving): Use **`DELETE /api/coaches/me/courts/:id`** where `:id` is the coach_court_location id (from GET /api/coaches/me/courts). After removing old courts, add courts in the new city and update profile **location**.
- **List your courts**: **`GET /api/coaches/me/courts`** returns all courts linked to the authenticated coach (each item has `id` for use with DELETE).
- **List a coach's courts (for students)**: **`GET /api/coaches/:id/courts`** returns courts where a coach teaches. Public; no auth required. Use when a student views a coach's profile to show locations. In the By Flow Postman collection this is **3 – Flow: Student** → **Get Coach Courts**.

### `GET /api/coaches/:id/courts`
- **Auth**: None required
- **Description**: List courts where the given coach teaches. For students viewing a coach's profile before booking. Omit `page`/`limit` to return all matching rows (server-capped). Provide `page` or `limit` for paged mode. Available in Postman under **3 – Flow: Student** (Get Coach Courts).
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
        "address": "123 Park Ave",
        "city": null,
        "lat": 25.78,
        "lng": -80.19
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
        "rate_modifier": "1.00",
        "preferred": true,
        "notes": "My preferred court",
        "created_at": "...",
        "updated_at": "...",
        "court": {
          "id": 1,
          "name": "Central Park Pickleball Court",
          "address": "123 Main St",
          "latitude": 40.7,
          "longitude": -74.0,
          "is_private": false,
          "is_verified": true,
          "createdBy": { "id": 1, "full_name": "Admin User" }
        }
      }
    ]
  }
  ```

### `GET /api/coaches/me/lessons`
- **Auth**: Required (coach only)
- **Description**: List lessons created by the authenticated coach. Omit `page`/`limit` to return all matching rows (server-capped). Provide `page` or `limit` for paged mode.
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
        "duration_minutes": 60,
        "price": 50.00,
        "is_active": true
      }
    ]
  }
  ```

### `GET /api/coaches/me/courts`
- **Auth**: Required (coach only)
- **Description**: List courts associated with the authenticated coach
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
        "rate_modifier": "1.00",
        "preferred": true,
        "notes": "My preferred court",
        "created_at": "...",
        "updated_at": "...",
        "court": {
          "id": 1,
          "name": "Central Park Pickleball Court",
          "address": "123 Main St",
          "latitude": 40.7,
          "longitude": -74.0,
          "is_private": false,
          "is_verified": true,
          "createdBy": { "id": 1, "full_name": "Admin User" }
        }
      }
    ]
  }
  ```

### `POST /api/coaches/me/courts`
- **Auth**: Required (coach only; admins cannot add courts to their profile)
- **Description**: Link an **existing** court to the coach's available courts. Does not create a new court; use `POST /api/courts` to create courts (coaches are auto-linked when they create).
- **Request Body**:
  ```json
  {
    "court_id": "number (required)",
    "rate_modifier": "number (optional)",
    "preferred": "boolean (optional, defaults to false)",
    "notes": "string (optional)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Court added successfully",
    "data": {
      "coachCourt": {
        "id": 1,
        "coach_id": 2,
        "court_id": 1,
        "rate_modifier": "1.00",
        "preferred": true,
        "notes": "My preferred court",
        "created_at": "...",
        "updated_at": "..."
      },
      "court": {
        "id": 1,
        "name": "Central Park Pickleball Court",
        "address": "123 Main St",
        "latitude": 40.7128,
        "longitude": -74.006,
        "is_private": false,
        "is_verified": true,
        "createdBy": { "id": 1, "full_name": "Admin User" }
      }
    }
  }
  ```
- **Error responses**: `400` (court_id missing or invalid; or court more than 100 miles from your existing courts), `404` (court not found), `409` (coach already linked to this court).

### `DELETE /api/coaches/me/courts/:id`
- **Auth**: Required (coach only)
- **Description**: Unlink a court from the coach's profile. Use when moving or when you no longer coach at that court. `:id` is the **coach_court_location** id (the `id` of each item in GET /api/coaches/me/courts), not the court_id.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court removed from your profile",
    "data": null
  }
  ```
- **Error responses**: `400` (invalid id), `403` (not a coach), `404` (link not found or not yours).

### `POST /api/coaches/me/stripe-connect/onboard`
- **Auth**: Required
- **Description**: Initiate Stripe Connect onboarding for coach payouts
- **Request Body**:
  ```json
  {
    "coach_id": "number (optional, admin only - defaults to authenticated user's ID)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Stripe Connect onboarding initiated",
    "data": {
      "onboarding_url": "https://connect.stripe.com/setup/c/..."
    }
  }
  ```

### `GET /api/coaches/me/stripe-connect/status`
- **Auth**: Required
- **Description**: Check Stripe Connect onboarding status
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Stripe Connect status retrieved",
    "data": {
      "stripe_account_id": "acct_...",
      "charges_enabled": true,
      "payouts_enabled": true,
      "details_submitted": true
    }
  }
  ```

---

## Students (`/api/students`)

### `GET /api/students/me/reliability`
- **Auth**: Required (**student** role only).
- **Description**: Same purpose as **`GET /api/coaches/me/reliability`**, for the authenticated **student**: full penalized-impact reliability breakdown + score (`user_reliability` row with `role: student`). **`paid_reschedules`** is overridden to count **student-requested**, **penalized**, **paid** reschedules whose linked payment is **captured** or **partially_refunded** (parity with coach endpoint semantics).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Student reliability retrieved successfully",
    "data": {
      "reliability": {
        "user_id": 3,
        "role": "student",
        "total_bookings": 8,
        "reschedules": 1,
        "paid_reschedules": 0,
        "late_cancels": 0,
        "late_arrival_penalties": 0,
        "misconduct_penalties": 0,
        "lesson_not_completed_penalties": 0,
        "no_shows": 0,
        "coach_cancels": 0,
        "reliability_score": 96.0,
        "badges": null,
        "last_updated": "2026-03-16T18:42:26.000Z"
      }
    }
  }
  ```
- **Error responses**: `400` (user is not a student), `401`, `500`.

---

## Courts (`/api/courts`)

### `GET /api/courts`
- **Auth**: None required
- **Description**: **List all courts** when **lat** and **lng** are omitted. **No `page` and no `limit`** → return **all** courts in `data` (server-capped at **10,000** for safety). **Either `page` or `limit`** (or both) → **paginated** list (`data` + `pagination`); per-page max **100**. **Search near a point** when both **lat** and **lng** are provided (bounding box + **radius** in miles, default 10); results are ordered **closest to the search point first** (Haversine). If no courts match, may **lazy-import** from OpenStreetMap and re-query (still distance-ordered, up to 100 rows).
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
    "data": [ { "id": 1, "name": "...", "address": "...", "latitude": 40.7128, "longitude": -74.006, "is_private": false } ],
    "pagination": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 }
  }
  ```
  - **Geo search** (`lat` + `lng`): non-paginated array in `data` (up to 100 courts), **closest first**, same court shape as above.

### `GET /api/courts/:id`
- **Auth**: None required
- **Description**: Get court details by ID (public)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court retrieved successfully",
    "data": {
      "id": 1,
      "name": "Central Park Pickleball Court",
      "address": "123 Main St",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "is_private": false,
      "is_verified": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/courts`
- **Auth**: Required (Coach or Admin only)
- **Description**: Create a new court location. **Coaches:** If you already have other courts, the new court must be within **100 miles** of one of them (prevents listing courts you can't coach at). Admins are not subject to this rule.
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "address": "string (optional)",
    "latitude": "number (optional)",
    "longitude": "number (optional)",
    "is_private": "boolean (optional, defaults to false)",
    "notes": "string (optional)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Court created successfully",
    "data": {
      "id": 1,
      "name": "Central Park Pickleball Court",
      "address": "123 Main St",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "is_private": false,
      "is_verified": false,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```
- **Error responses**: For coaches with existing courts, `400` if the new court is more than 100 miles from all of your existing courts.

### `DELETE /api/courts/:id`
- **Auth**: Required (Admin, or coach who created the court)
- **Description**: **Soft delete** a court. Sets `deleted_at`; court no longer appears in search or GET. **Admins** can delete any court. **Coaches** can delete only courts they created (where they are `created_by_user_id`). Use when a coach stops using a court they added or an admin is closing/merging courts.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court deleted successfully",
    "data": null
  }
  ```
- **Error responses**: `403` (not admin and not the creator of this court), `404` (court not found or already deleted), `500` (server error).

---

## Lessons (`/api/lessons`)

### `GET /api/lessons`
- **Auth**: None required
- **Description**: Get lessons (public). If `page` and `limit` are omitted, returns all matching lessons in `data` (server-capped at 10,000). If `page` or `limit` is provided, returns the requested page size (max 100 per page).
- **Query Parameters**: Optional filters: `coach_id`, `min_price`, `max_price`; optional pagination: `page`, `limit`.
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Lessons retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 2,
        "title": "Beginner Pickleball Lesson",
        "description": "Learn the basics",
        "duration_minutes": 60,
        "price": 50.00,
        "max_students": 4,
        "is_active": true
      }
    ]
  }
  ```

### `GET /api/lessons/:id`
- **Auth**: None required
- **Description**: Get lesson by ID (public)
- **Response** (Status: 200):
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
      "price": 50.00,
      "max_students": 4,
      "is_active": true,
      "coach": {
        "id": 2,
        "full_name": "Jane Coach"
      }
    }
  }
  ```

### `POST /api/lessons`
- **Auth**: Required (Coach only)
- **Description**: Create a new lesson
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
      "price": 50.00,
      "max_students": 4,
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/lessons/:id`
- **Auth**: Required
- **Description**: Update lesson
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
      "title": "Updated Lesson Title",
      "description": "Updated description",
      "duration_minutes": 90,
      "price": 55.00,
      "max_students": 6,
      "is_active": true
    }
  }
  ```

### `DELETE /api/lessons/:id`
- **Auth**: Required
- **Description**: Delete lesson (soft delete)
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

**Best design for your MVP — keep it simple**

| Step | Method | Path | Who |
|------|--------|------|-----|
| 1 | `POST` | `/api/bookings` | **Student** creates a booking (status `pending`). |
| 2 | `PUT` | `/api/bookings/:id/accept` | **Coach only** — `coach_id` on the booking must match the authenticated user. |
| 3 | `PUT` | `/api/bookings/:id/decline` | **Coach only** — same rule as accept. |

Admins and students get **403** on accept/decline. Use action endpoints only (`accept`, `decline`, `complete`, `student-no-show`, `cancel`)—there is no generic booking status endpoint.

**Auto-expiry:** A background worker cancels **pending** bookings that are still unaccepted after **`PENDING_BOOKING_EXPIRY_HOURS`** (default **24**) from `created_at`: status → `cancelled`, `cancelled_by` → `system`, uncaptured Stripe PaymentIntents are cancelled (slot freed). Runs every 15 minutes when workers are enabled.

**Coach heads-up:** On successful create, the API logs `new_booking_request_for_coach`, creates an **in-app** notification for the coach, and sends **email** when SendGrid is configured.

### Booking Status Reference (Meaning + Cancellation Rules)

Use this table as the source of truth for practical status meaning and whether **cancellation via the shared cancel API** is allowed. **Cancellation** means `POST /api/bookings/:id/cancel` or `POST /api/admin/bookings/:id/cancel` — same rules; admin cancel sets `cancelled_by: admin` and does not apply reliability penalties.

Only **`pending`** and **`confirmed`** are cancellable through these endpoints. All other statuses receive **400** with a status-specific or generic `code` (e.g. `cancel_pre_lesson_only`, `awaiting_verification_use_dispute`, `disputed_use_dispute_flow`). Post-lesson money or outcomes use **other** routes (`PUT /api/disputes/:id/resolve`, `POST /api/admin/bookings/:id/refund`, coach complete / no-show / coach-no-show, auto-complete worker, etc.).

| Status | Practical meaning | Typically set by | Cancellable via cancel API? | Why / guardrail |
|--------|-------------------|------------------|----------------------------|-----------------|
| `pending` | Student created booking; waiting for coach decision | `POST /api/bookings` | **Yes** (student, coach on booking, or admin) | Pre-lesson; cancel enqueues **`booking_cancel_refund`** on **`payment_actions`** when policy refunds a captured charge |
| `confirmed` | Coach accepted; lesson not yet ended (or still in coach-action window before worker moves it) | `PUT /api/bookings/:id/accept` | **Yes** (same callers) | Pre-lesson; same **`payment_actions`**-backed cancel refund path as **`pending`** |
| `awaiting_verification` | Lesson **end** time has passed while still `confirmed`; worker moved booking here until coach marks complete / no-show or **auto-complete** runs | Background worker (`autoConfirmWorker`, ~every 5 min): `confirmed` → `awaiting_verification` when `scheduled_at + duration` ≤ now (typically 0-5 minutes after lesson end when workers are healthy) | **No** | Cancel endpoint is pre-lesson only; use complete / no-show / disputes / admin refund as appropriate |
| `completed` | Lesson treated as completed (coach `POST .../complete`, or auto worker **24h after lesson end** if still `awaiting_verification` and no open dispute) | Coach or `autoConfirmWorker` | **No** | Terminal |
| `cancelled` | Booking cancelled | `POST .../cancel`, coach decline, pending expiry worker, etc. | **No** | Terminal |
| `disputed` | Chargeback / dispute workflow tied to payment (e.g. Stripe dispute sync may set this on the booking) | `stripeDisputeSyncService` (webhook path); seeds/tests | **No** | Cancel endpoint rejects; resolve dispute and handle funds via documented dispute/refund flows |
| `student_no_show` | Primary **student** did not attend | `POST .../student-no-show` (coach or admin) | **No** | Terminal attendance outcome; **not** reversible via cancel (no `reason_notes` token path). Coach payout is eligible; adjust with dispute/admin override if contested |
| `coach_no_show` | **Coach** did not attend | `POST /api/admin/bookings/:id/coach-no-show` | **No** | Terminal attendance outcome; cancel endpoint does not apply |

The sections below document the **MVP write flow** first, then **beyond MVP** (list, detail, cancel, reschedule).

### `POST /api/bookings` (MVP — student)
- **Auth**: Required (email must be verified)
- **Description**: Student creates a booking (`pending`). **Only non-admin students** may call this (403 for others).
- **Request Body**:
  ```json
  {
    "lesson_id": "number (required, positive integer)",
    "scheduled_at": "string (required, ISO 8601 date-time, must be in future)",
    "duration_minutes": "number (optional, min 15)",
    "player_ids": "array (optional, array of user IDs)",
    "court_location_id": "number (optional, positive integer)",
    "payment_method": "string (optional, 'stripe' | 'apple_pay' | 'google_pay' | 'card', defaults to 'stripe')"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Booking created successfully",
    "data": {
      "booking": {
        "id": 1,
        "lesson_id": 1,
        "coach_id": 2,
        "primary_student_id": 1,
        "scheduled_at": "2026-02-01T10:00:00.000Z",
        "duration_minutes": 60,
        "price": 50.00,
        "status": "pending",
        "created_at": "2026-01-01T00:00:00.000Z"
      },
      "payment_intent_client_secret": "pi_..._secret_...",
      "payment_intent_id": "pi_..."
    }
  }
  ```

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
    "message_to_student": "string (required, 10–500 chars)",
    "decline_reason_code": "string (optional, e.g. availability_wrong, sick, other)"
  }
  ```
- **Response** (Status: 200): Payload includes `booking`, `message_to_student`, and a short `system_note` for the client.

---

### Beyond MVP

### `GET /api/bookings`
- **Auth**: Required
- **Description**: List your own bookings (student/coach only). Admin must use `GET /api/admin/bookings`.
- **Query Parameters**: status, coach_id (admin only), student_id (admin only), optional `page`, optional `limit` (omit both for all matching rows; provide either to paginate)
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Bookings retrieved successfully",
    "data": [
      {
        "id": 1,
        "lesson_id": 1,
        "coach_id": 2,
        "primary_student_id": 1,
        "scheduled_at": "2026-02-01T10:00:00.000Z",
        "duration_minutes": 60,
        "price": 50.00,
        "status": "pending",
        "lesson": {
          "title": "Beginner Pickleball Lesson"
        }
      }
    ]
  }
  ```

### `GET /api/bookings/:id`
- **Auth**: Required
- **Description**: Get booking details by ID (participant access). Admin must use `GET /api/admin/bookings/:id`.
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
- **Description**: Cancel a **pre-lesson** booking only (`pending` or `confirmed`). Persists **`cancellation_history`** and sets booking → **`cancelled`**. Money movement:
  - **Captured / partially refunded / pending_capture charges**: enqueues a **`payment_actions`** row (`action_type` **`booking_cancel_refund`**) with the policy-derived **`refund_cents`**; Stripe execution runs asynchronously via **`processPendingRefundPaymentActions`** (~every **2 minutes**), same pipeline as dispute/admin refunds (**idempotency, metadata, reconciliation**).
  - **Uncaptured authorize-only PaymentIntent** (`pending`): cancels the PaymentIntent in Stripe inside the cancel transaction (**synchronous**) and marks the payment **`pending_void`**.
  For `awaiting_verification`, `disputed`, or other post-lesson states, use **`PUT /api/disputes/:id/resolve`**, **`POST /api/admin/bookings/:id/refund`**, or other documented flows instead of this endpoint.
- **Request Body**:
  ```json
  {
    "reason": "string (required, valid cancellation reason)",
    "reason_notes": "string (optional, max 255 chars)"
  }
  ```
- **Response** (Status: 200): `data` includes **`booking`** (full cancelled row), **`cancellation`** (sanitized **`cancellation_history`**), and when a Stripe refund was enqueued **`refund`** (omit when no refundable charge/refund cents was **0**):
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
        "reason": "...",
        "refund_amount": "40.50",
        "penalty_amount": "10.50",
        "...": "other cancellation_history fields"
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
- **Description**: Admin override for **student** no-show. Lesson must have ended; allowed source statuses are `confirmed`, `awaiting_verification`, `student_no_show`, or `coach_no_show` **when there is no active dispute**. This endpoint sets `bookings.status` → `student_no_show` and can be used to correct an earlier admin attendance mark (including `coach_no_show` → `student_no_show`) while the booking is still financially mutable. If disputed (or any open/under_review dispute exists), this endpoint returns conflict and you should resolve through **`PUT /api/disputes/:id/resolve`** so final status + financial outcome are decided in one path. Coach payout is handled by the payout worker as a payable attendance outcome: once eligible (no open dispute, no pending refund, escrow still `held`), payout proceeds on the next worker cycle (`~10 minutes`); the 24-hour hold applies to `awaiting_verification`, not `student_no_show`.

- **Side effects — reliability & payments (read this carefully)**:
  - **Reliability — YES, student only.** After the status flip, the controller calls `updateUserReliability(primary_student_id, 'student')`. The new `student_no_show` row is picked up by `calculateStudentMetrics` → `calculateStudentReliabilityScore`, so the **student's** score recomputes (a no-show is a negative signal). **Coach reliability is not touched** by this endpoint. Recalculation is skipped only when the student user also has the `admin` role.
  - **Refund — NO, no automatic refund.** The student is **not** refunded by this endpoint. The booking is treated as a payable attendance outcome: coach payout proceeds via the normal payout worker once the booking is eligible (escrow still `held`, no open dispute, no pending refund). The 24-hour payout hold applies to `awaiting_verification`, not to `student_no_show` set here.
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
- **Description**: Sets `bookings.status` → **`coach_no_show`** (coach did not attend). Allowed source statuses are `confirmed`, `awaiting_verification`, `student_no_show`, or `coach_no_show`, and the lesson end time has passed, **with no active dispute**. This endpoint can be used to correct an earlier admin attendance mark (including `student_no_show` → `coach_no_show`) while the booking is still financially mutable. If disputed (or any open/under_review dispute exists), this endpoint returns conflict and you should resolve through **`PUT /api/disputes/:id/resolve`** as the final authority path. **`409`** with **`booking_concurrent_update`** if another process changed the booking between read and transactional update. Coach attendance penalties in reliability come from **`bookings.status` only** (see dispute resolve **Reliability** notes).

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

### `GET /api/admin/bookings`
- **Auth**: Required (`admin`)
- **Description**: Admin list bookings (all bookings, optional filters like status/coach_id/student_id).

### `GET /api/admin/bookings/:id`
- **Auth**: Required (`admin`)
- **Description**: Admin get any booking by ID.

### `GET /api/coaches/bookings`
- **Auth**: Required (`coach`)
- **Description**: Coach-only booking inbox/list (bookings where `coach_id` is the authenticated coach).

### `POST /api/bookings/:id/reschedule`
- **Auth**: Required
- **Description**: Request a reschedule for a booking
- **Request Body**:
  ```json
  {
    "new_scheduled_at": "string (required, ISO 8601 date-time, must be in future)",
    "reason": "string (required, valid reschedule reason)",
    "reason_notes": "string (optional, max 255 chars)",
    "paid_reschedule": "boolean (optional, defaults to false)"
  }
  ```
- **Response**: Reschedule request created

---

## Payments (`/api/payments`)

### `GET /api/payments`
- **Auth**: Required
- **Description**: Get user's payments (filtered by role)
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
        "total_charge_to_student": 50.00,
        "platform_fee_amount": 4.00,
        "coach_payout_amount": 46.00,
        "payment_status": "captured",
        "escrow_status": "released"
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

**MVP note:** Payment rows are created when a student books a lesson (`POST /api/bookings`) and updated via Stripe webhooks and booking flows. There are no admin HTTP endpoints to create payments or tweak rows in isolation without a booking/dispute route—use Stripe Dashboard when appropriate. Money-back flows enqueue **`payment_actions`** (cancel / coach-no-show auto / manual admin refund / dispute resolve); **`paymentService.processPendingRefundPaymentActions`** issues **`stripe.refunds.create`** with idempotent keys and attaches refund metadata (**`booking_id`**, **`payment_action_id`**) used by **`reconcileRefundPaymentActionsWithStripe`**.

---

## Reschedules (`/api/reschedules`)

### `GET /api/reschedules`
- **Auth**: Required
- **Description**: Get reschedule history for user's bookings
- **Query Parameters**: Filters (booking_id, status, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Reschedule history retrieved successfully",
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "new_scheduled_at": "2026-02-02T14:00:00.000Z",
        "reason": "schedule_conflict",
        "status": "approved",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

---

## Reviews (`/api/reviews`)

### `GET /api/reviews`
- **Auth**: Required
- **Description**: List reviews with optional filters (target_user_id, reviewer_id, etc.). If `page` and `limit` are omitted, returns all matching reviews in `data` (server-capped at 10,000). If `page` or `limit` is provided, returns the requested page size.
- **Query Parameters**: `target_user_id`, `reviewer_id`, optional `page`, optional `limit`
- **Pagination contract**: Paged mode includes `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Reviews retrieved successfully",
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "reviewer_id": 1,
        "target_user_id": 2,
        "rating": 5,
        "comment": "Great lesson!",
        "visibility": "public",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `POST /api/reviews`
- **Auth**: Required (email must be verified)
- **Description**: Create a review
- **Request Body**:
  ```json
  {
    "booking_id": "number (required, positive integer)",
    "target_user_id": "number (optional, positive integer)",
    "rating": "number (required, 1-5 integer)",
    "comment": "string (optional, max 1000 chars)",
    "attendance_badges": "array (optional, array of strings)",
    "visibility": "string (optional, 'public' | 'private' | 'semi_public', defaults to 'public')"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Review created successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "reviewer_id": 1,
      "target_user_id": 2,
      "rating": 5,
      "comment": "Great lesson!",
      "visibility": "public",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/reviews/:id`
- **Auth**: Required
- **Description**: Update review (only by reviewer)
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "rating": "number (optional, 1-5 integer)",
    "comment": "string (optional, max 1000 chars)",
    "attendance_badges": "array (optional, array of strings)",
    "visibility": "string (optional, 'public' | 'private' | 'semi_public')"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Review updated successfully",
    "data": {
      "id": 1,
      "rating": 4,
      "comment": "Updated review comment",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `DELETE /api/reviews/:id`
- **Auth**: Required
- **Description**: Delete review (only by reviewer)
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

### `GET /api/messages/conversations`
- **Auth**: Required
- **Description**: Get conversations for the authenticated user. Omit `page`/`limit` to return all matching rows (server-capped). Provide `page` or `limit` for paged mode.
- **Query Parameters**: `booking_id` (optional filter), optional `page`, optional `limit`
- **Pagination contract**: Paged mode includes top-level `pagination` (`page`, `limit`, `total`, `totalPages`). All-results mode returns only `data`.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Conversations retrieved successfully",
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "latest_message": {
          "id": 5,
          "content": "See you there!",
          "created_at": "2026-01-01T12:00:00.000Z"
        },
        "unread_count": 2
      }
    ]
  }
  ```

### `GET /api/messages/conversations/:id`
- **Auth**: Required
- **Description**: Get conversation by ID with messages. Omit `page`/`limit` to return all messages (server-capped). Provide `page` or `limit` to paginate messages.
- **Query Parameters**: Optional `page`, optional `limit` (for messages)
- **Pagination contract**: In paged mode, `data.messages_pagination` is returned (`page`, `limit`, `total`, `totalPages` semantics via current pagination shape). In all-results mode, `messages_pagination` is omitted.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Conversation retrieved successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "messages": [
        {
          "id": 1,
          "sender_id": 1,
          "content": "Hello, I have a question",
          "read_at": null,
          "created_at": "2026-01-01T10:00:00.000Z"
        }
      ],
      "pagination": {
        "totalItems": 10,
        "totalPages": 1,
        "currentPage": 1,
        "pageSize": 10
      }
    }
  }
  ```

### `POST /api/messages/conversations`
- **Auth**: Required (email must be verified)
- **Description**: Create a new conversation for a booking
- **Request Body**:
  ```json
  {
    "booking_id": "number (required, positive integer)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Conversation created successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/messages/send`
- **Auth**: Required (email must be verified)
- **Description**: Send a message in a conversation
- **Request Body**:
  ```json
  {
    "conversation_id": "number (required, positive integer)",
    "content": "string (required, 1-5000 chars)",
    "attachments": "array (optional, array of objects)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Message sent successfully",
    "data": {
      "id": 1,
      "conversation_id": 1,
      "sender_id": 1,
      "content": "Hello, I have a question about the lesson",
      "read_at": null,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/messages/:id/read`
- **Auth**: Required
- **Description**: Mark a message as read
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Message marked as read",
    "data": {
      "id": 1,
      "read_at": "2026-01-01T12:00:00.000Z"
    }
  }
  ```

---

## Disputes (`/api/disputes`)

**Dispute types (`dispute_types` table)** — use `dispute_type_id` when creating a dispute. Canonical **MVP set** (after migrations `20260408120000-canonical-dispute-types-mvp` and `20260421120000-dispute-types-attendance-claims`):

| `id` | `code` | Meaning |
|------|--------|---------|
| 1 | `coach_no_show_claim` | **Claim:** student alleges the coach did not attend (final outcome is `bookings.status`, set on `PUT /api/disputes/:id/resolve`) |
| 2 | `late_arrival` | Coach late or lesson started late |
| 3 | `misconduct` | Conduct / safety issue |
| 4 | `lesson_not_completed` | Lesson did not complete as expected (other than simple no-show) |
| 5 | `refund_request` | Refund or compensation request (non–chargeback) |
| 6 | `billing_issue` | Charge amount, double charge, payment processing |
| 7 | `other` | Catch-all |
| 8 | `student_no_show_claim` | **Claim:** coach alleges the primary student did not attend (final outcome is `bookings.status`, set on dispute resolve) |

**Booking outcomes** (`student_no_show`, `coach_no_show`) are **not** dispute type codes — they are set from resolution + claim type. Older docs referring to `dispute_type_id` **1** as “coach did not attend” meant the same **claim** row after rename.

Older `service_issue` / `billing` labels are replaced in place by this migration (same numeric ids; existing `disputes` rows keep their `dispute_type_id` but the type **meaning** changes — acceptable for pre-launch MVP).

### `GET /api/disputes`
- **Auth**: Required
- **Description**: Get disputes (filtered by user role). If `page` and `limit` are omitted, returns all matching disputes in `data` (server-capped at 10,000). If `page` or `limit` is provided, returns the requested page size.
- **Query Parameters**: Filters such as `status`, `booking_id`; optional `page`, optional `limit`.
- **Resolver field**: `resolved_by_admin` only (`{ id, full_name }` or `null`). No separate `admin_id` / `resolved_by_admin_id` in JSON (use `resolved_by_admin.id` when present).
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
        "resolved_by_admin": null,
        "opened_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

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
      "booking": {
        "id": 1,
        "scheduled_at": "2026-02-01T10:00:00.000Z"
      },
      "resolved_by_admin": {
        "id": 10,
        "full_name": "Admin User"
      },
      "opened_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/disputes`
- **Auth**: Required. **Students and coaches** must have **verified email**. **Admins** may create disputes without email verification; the row is stored with **`opened_by` → `admin`** (same as **`POST /api/admin/disputes`**).
- **Description**: Create a dispute. **Student/coach** callers get **`opened_by` → `student`** or **`coach`** as appropriate. **Admin** callers get **`opened_by` → `admin`** — use this when support opens a case the user never filed in-app. Does **not** change `bookings.status` by itself; admin resolves via **`PUT /api/disputes/:id/resolve`** using **`decision` + `financial_action`** for all dispute types, and **`outcome`** only for attendance claims (`coach_no_show_claim`, `student_no_show_claim`).
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
      "resolved_by_admin": null,
      "opened_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/disputes/:id/resolve`
- **Auth**: Required (Admin only)
- **Description**: Resolve a dispute (admin only). Sets `status` → `resolved`, records resolver and `resolved_at`.

  Canonical resolve contract:
  - **`decision`** (**required**, all dispute types): **`upheld`** | **`rejected`** | **`partial`**. This is the admin ruling and does not need to be inferred from attendance outcome.
  - **`financial_action`** (money on resolve): **`no_change`** (no Stripe refund enqueued by this request), **`refund_student`** (full remaining on the booking’s latest captured charge), **`refund_student_partial`** (**`refund_amount`** required, US dollars). For **attendance** disputes, which values are valid is determined jointly with **`outcome`** (see alignment): e.g. **`coach_no_show`** requires a refund path; **`student_no_show`** requires **`no_change`**. For **behavior** disputes, **`rejected`** still requires **`no_change`**.
  - **`outcome`** (attendance claims only — dispute types **`coach_no_show_claim`**, **`student_no_show_claim`**): **`student_no_show`** | **`coach_no_show`**. **Always required** for attendance disputes (factual determination on every resolve). Non-attendance disputes must omit **`outcome`**.
    - **`decision`** **`upheld`** or **`partial`**: **`outcome`** may be either value; it is validated against **`financial_action`** per the alignment matrix below, then mapped **one-to-one** onto **`bookings.status`**.
    - **`decision`** **`rejected`**: **`outcome`** must be the **contradicting** factual result — **`coach_no_show_claim`** → **`student_no_show`** only; **`student_no_show_claim`** → **`coach_no_show`** only. Any other **`outcome`** for **`rejected`** is **`400`** with **`attendance_rejected_outcome_aligns_with_claim`**. **`financial_action`** follows the same **outcome ↔ money** rules as **`upheld`**/**`partial`** (see **Attendance outcome ↔ financial_action** below): **`coach_no_show`** requires a student refund; **`student_no_show`** requires **`no_change`** (no refund on resolve).
  - **`penalize_role`** (behavior disputes only): **`coach`** | **`student`** | **`none`** for `late_arrival`, `misconduct`, `lesson_not_completed`.
    - `decision = upheld|partial` -> must be `coach` or `student`
    - `decision = rejected` -> must be `none`
    - attendance claims must omit `penalize_role`
    - **Reversible philosophy**: a behavior dispute claimant may end up being the penalized party (e.g. a student-opened misconduct claim is concluded against the student because the student was actually at fault). This is **allowed**, not blocked, and produces an advisory entry in `data.warnings[]`:
      - `penalize_role` equals the `opened_by` side (student-opened + `penalize_role=student`, or coach-opened + `penalize_role=coach`) → `behavior_claim_reversal` so moderators confirm the reversal matches the evidence.
      - Admin-opened sustained behavior disputes (`opened_by=admin`) → `behavior_resolution_direction_ambiguous`, because claimant-vs-accused is not inferable from `opened_by`; the admin must consciously pick a side.

  **Alignment (Layer 3) — strict consistency rules (returned as `400` with `code`):**
  - **Unsupported / unknown `dispute_type_code`** → `unsupported_dispute_alignment_type`. Alignment is only defined for `coach_no_show_claim`, `student_no_show_claim`, `late_arrival`, `misconduct`, `lesson_not_completed`.
  - **Attendance claims (`coach_no_show_claim`, `student_no_show_claim`):**
    - Missing **`outcome`** (any **`decision`**) → **`attendance_outcome_required`**.
    - `decision = rejected` + **`outcome`** that is not the required contradicting fact (`coach_no_show_claim` requires `student_no_show`; `student_no_show_claim` requires `coach_no_show`) → **`attendance_rejected_outcome_aligns_with_claim`**.
    - **Attendance outcome ↔ financial_action** (all of **`upheld`**, **`partial`**, **`rejected`** after the rejected-outcome check above): **`outcome = coach_no_show`** requires **`financial_action`** of **`refund_student`** or **`refund_student_partial`** (student must be compensated). **`outcome = student_no_show`** requires **`financial_action = no_change`** (no refund on resolve; coach payout follows normal booking rules). Any other pairing → **`attendance_financial_mismatch`**.
    - When **`outcome`** contradicts the opener's claim (student-opened `coach_no_show_claim` resolved as `student_no_show`, or coach-opened `student_no_show_claim` resolved as `coach_no_show`), including **`decision = rejected`** with that **`outcome`**: allowed, but adds advisory **`attendance_claim_reversal`** to `data.warnings[]` when the opener is student/coach (not admin).
  - **Behavior disputes (`late_arrival`, `misconduct`, `lesson_not_completed`):**
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
  - Behavior disputes (`late_arrival`, `misconduct`, `lesson_not_completed`): two fields work together; **`financial_action` does not** decide whether reliability is penalized.
    - **`decision`** — **eligibility:** only **`upheld`** and **`partial`** apply behavior penalty metrics (**`late_arrival_penalties`**, **`misconduct_penalties`**, **`lesson_not_completed_penalties`**). **`rejected`** applies **no** behavior penalty (`penalize_role` must be `none`).
    - **`penalize_role`** — **who is penalized:** when `decision` is `upheld` or `partial`, set to **`coach`** or **`student`** to select **which user’s** reliability score is updated and which party’s metrics include the incident. The API **does not** infer this from who opened the dispute or the narrative of the claim—admins must set `penalize_role` deliberately. Hybrid validation warnings are **advisory only** and preserve moderator override flexibility; they do not auto-correct or block submission.

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

- **Response** (Status: 200): `data` always includes **`dispute`**. When a Stripe refund applies, **`refund`** is included: it is **`queued`** (see below) unless you use a legacy path elsewhere. `resolution` is included with `{ "decision", "financial_action", "outcome?" , "derived_booking_status?" }` (for attendance claims, **`outcome`** and **`derived_booking_status`** are always included).
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
        "resolution_notes": "Approved refund due to service issue",
        "resolved_by_admin": {
          "id": 10,
          "full_name": "Admin User"
        },
        "opened_at": "2026-01-01T00:00:00.000Z",
        "resolved_at": "2026-01-02T00:00:00.000Z"
      },
      "resolution": {
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

### `GET /api/notifications`
- **Auth**: Required
- **Description**: Get user's notifications. Omit `page`/`limit` to return all matching notifications (server-capped). Provide `page` or `limit` to paginate and include `pagination`.
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
- **Description**: Create a notification (admin only)
- **Request Body**:
  ```json
  {
    "user_id": "number (required)",
    "type": "string (required)",
    "channel": "string (required)",
    "payload": "object (required)"
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
        "title": "System Notification",
        "message": "This is a system notification"
      },
      "status": "pending",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/notifications/:id/read`
- **Auth**: Required
- **Description**: Mark notification as read (own notification or admin)
- **Response** (Status: 200): Notification object with updated status.

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
    "password": "string (required, min 8 chars)",
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
  - Use filters to narrow down to specific users, actions, or tables when investigating issues.
  - **Refund / payout / cancellation (support tooling)** — filter `action` on these names when reconciling money movement:
    | `action` | Typical `table_name` | What to use in `after_state` |
    |----------|----------------------|--------------------------------|
    | `cancellation_financials` | `bookings` | `refund_cents`, `retained_penalty_cents`, `total_charge_cents`, `payment_id`, `cancellation_history_id`, `is_late_cancel`, `cancelled_by`, `penalty_reason` |
    | `refund_initiated` | `payments` | `refund_cents`, `remaining_on_charge_after_refund_cents`, `charge_amount_cents`, `refunded_so_far_before_cents`, `partial_refund`, `stripe_refund_id` |
    | `payout_created` | `payouts` | `payout_amount`, `payout_status`, `booking_id`, `booking_status`, `payment_escrow_status`, `coach_payout_expected`, `transfer_id`, `stripe_connect_used` |
    | `payout_finalized_from_stripe` | `payouts` | `transfer_id`, `escrow_status`, `booking_id`, `payment_id`, `payout_status` |
    Related cancel flow (same booking): `booking_cancelled`, `cancellation_recorded` on `bookings` / `cancellation_history` — pair with `cancellation_financials` for full context.
    Other payment lifecycle entries (optional filters): `payment_created`, `payment_captured`, `paid_reschedule_payment_created`; retries: `payment_retry_attempted`, `payout_retry_attempted`.

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
- **Description**: Full reliability breakdown for support. Response is always **`data.reliability`**, with a **`role`** field inside that object (**`"coach"`** or **`"student"`**) so clients know which dimension was returned. **`reliability_score`**, **`total_bookings`**, and stored penalty counts come from the corresponding **`user_reliability`** row; **`reschedules.*`** blocks are computed live from **`RescheduleHistory`** (**coach-requested** vs **student-requested** depending on **`role`**).
- **Coach (`data.reliability.role` = `"coach"`)** — **`penalties`**:
  - `late_cancels` = coach cancellations in the late window (within 24 hours before `scheduled_at`, with `affects_reliability`).
  - `coach_cancels_non_late` = remaining penalized coach cancellations (same rules as `reliabilityService`: excludes the late-window bucket so each cancel is counted once).
  - `no_shows` = coach no-show count used in scoring (from **`bookings.status` = `coach_no_show` only**—not from disputes).
  - Behavior penalty buckets (resolved + behavior type + `affects_reliability_score` + sustained **`upheld`/`partial`** + **`penalize_role`**): **`late_arrival_penalties`**, **`misconduct_penalties`**, **`lesson_not_completed_penalties`** (stored on `user_reliability`; **no** attendance-claim dispute counters).
  - `penalties.points` (coach): rough per-bucket contributions vs `total_bookings` denominator (the live scorer also uses `_booking_baseline` + smoothing — see **`reliabilityService`**): behavior: `late_arrival`, `misconduct`, `lesson_not_completed`; attendance: **`attendance_no_show`** from **`no_shows`** × coach attendance weight (**`35`**).
  - **`reschedules`**: `total` = all **coach-requested** reschedules on that coach’s bookings; `penalized` / `non_penalized` split by `affects_reliability`. **`reschedules.paid`**: `count` = rows with `paid_reschedule` set; `with_captured_payment` uses captured / partially_refunded payments (per-type counts and dollar amounts).
- **Student (`data.reliability.role` = `"student"`)** — same overall JSON shape; **`reschedules`** counts are **student-requested** reschedules on bookings where the user is **`primary_student`**. **`penalties.student_cancels_non_late`** uses the schema field persisted for the student row (**`user_reliability.coach_cancels`** when `role = student` — same column name as the coach row, different semantics). **`penalties.points`** includes **`attendance_no_show`** (student no-show weight **`12`**), **`student_cancels_non_late`** (weight **`12`**), and the behavior keys aligned with **`calculateStudentReliabilityScore`**.
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
        "reschedules": {
          "total": 5,
          "penalized": 2,
          "non_penalized": 3,
          "paid": {
            "count": 4,
            "with_captured_payment": {
              "total": 2,
              "penalized": 1,
              "non_penalized": 1,
              "amounts": {
                "penalized": 3.0,
                "non_penalized": 3.0,
                "total": 6.0
              }
            }
          }
        },
        "penalties": {
          "late_cancels": 0,
          "late_arrival_penalties": 1,
          "misconduct_penalties": 1,
          "lesson_not_completed_penalties": 0,
          "no_shows": 0,
          "coach_cancels_non_late": 1,
          "points": {
            "late_arrival": 0.5,
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
- **Description**: List courts linked to a coach (for support/moderation). Use when an admin needs to view or fix a coach's court list. **Path**: `coachId` = coach's **user id** (users.id).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach courts retrieved successfully",
    "data": [
      {
        "id": 1,
        "court_id": 5,
        "rate_modifier": null,
        "preferred": false,
        "notes": null,
        "court": { "id": 5, "name": "City Park", "address": "...", ... }
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
    "data": null
  }
  ```
- **Error responses**: `403` (not admin), `404` (coach not found or coach not linked to that court), `500` (server error).

### `DELETE /api/admin/coaches/:coachId/availability/:id`
- **Auth**: Required (Admin only)
- **Description**: Delete a coach's availability slot (e.g. wrong times). **Path**: `coachId` = coach's user id, `id` = availability record id (from GET /coaches/:id/availability or coach's own availability list).
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
