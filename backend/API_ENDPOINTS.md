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
      "coachProfile": { ... }
    }
  }
  ```
- **Notes**: The profile includes `email_verified_at` (ISO date or `null`) for verification status.
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
        "skill_level": "advanced"
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
- **Description**: List/search coaches with optional filters. Use **lat**, **lng**, and **radius** to find coaches who have courts within that distance (e.g. "coaches near me"). If `page`/`limit` are omitted, returns all matching coaches in `data` (server-capped). If `page` or `limit` is provided, response includes `pagination`.
- **Query Parameters**:
  - `lat` (optional) – latitude in degrees (center point for distance filter)
  - `lng` (optional) – longitude in degrees (center point for distance filter)
  - `radius` (optional) – miles from (lat, lng); default 10, max 500
  - `skill_level` (optional) – `beginner` | `intermediate` | `advanced` | `pro`
  - `min_rating` (optional) – minimum coach rating (0–5)
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
        "id": 1,
        "user_id": 2,
        "full_name": "Jane Coach",
        "bio": "Experienced pickleball coach",
        "hourly_rate": 50.00,
        "skill_level": "advanced",
        "average_rating": 4.8
      }
    ]
  }
  ```

### `GET /api/coaches/:id`
- **Auth**: Required. **Roles**: Student, Admin only (coaches get 403).
- **Description**: Get coach details by ID (for students viewing a coach profile, or admins).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach retrieved successfully",
    "data": {
      "id": 1,
      "user_id": 2,
      "full_name": "Jane Coach",
      "bio": "Experienced pickleball coach",
      "hourly_rate": 50.00,
      "skill_level": "advanced",
      "average_rating": 4.8,
      "total_reviews": 25,
      "availability": [],
      "lessons": []
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
- **Description**: Get the authenticated coach's reliability breakdown + score (raw `user_reliability` coach row). Includes penalized-impact counters, including dispute penalty buckets used by scoring.
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
        "late_arrival_disputes": 1,
        "coach_no_show_disputes": 0,
        "misconduct_disputes": 1,
        "lesson_not_completed_disputes": 0,
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
- **Request Body**:
  ```json
  {
    "headline": "string (optional)",
    "bio": "string (optional)",
    "hourly_rate": "number (optional, defaults to 0)",
    "experience_years": "number (optional, defaults to 0)",
    "skill_level": "string (optional, defaults to 'intermediate')",
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
      "headline": "Professional Pickleball Coach",
      "bio": "Experienced pickleball coach with 10 years of teaching",
      "hourly_rate": 50.00,
      "experience_years": 10,
      "skill_level": "advanced",
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
    "skill_level": "string (optional)",
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
      "skill_level": "advanced"
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
| `pending` | Student created booking; waiting for coach decision | `POST /api/bookings` | **Yes** (student, coach on booking, or admin) | Pre-lesson; refund/void rules in `cancelBooking` |
| `confirmed` | Coach accepted; lesson not yet ended (or still in coach-action window before worker moves it) | `PUT /api/bookings/:id/accept` | **Yes** (same callers) | Pre-lesson; same refund/void policy |
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
- **Description**: Cancel a **pre-lesson** booking only (`pending` or `confirmed`). Refunds or voids uncaptured authorization per policy when a payment row exists. For `awaiting_verification`, `disputed`, or other post-lesson states, use **`PUT /api/disputes/:id/resolve`**, **`POST /api/admin/bookings/:id/refund`**, or other documented flows instead of this endpoint.
- **Request Body**:
  ```json
  {
    "reason": "string (required, valid cancellation reason)",
    "reason_notes": "string (optional, max 255 chars)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Booking cancelled successfully",
    "data": {
      "id": 1,
      "status": "cancelled",
      "cancelled_at": "2026-01-01T00:00:00.000Z",
      "cancelled_by": "student"
    }
  }
  ```

### `POST /api/admin/bookings/:id/cancel`
- **Auth**: Required (`admin`)
- **Description**: Same rules as **`POST /api/bookings/:id/cancel`**: only **`pending`** or **`confirmed`** bookings; `cancelled_by` is set to **`admin`**. Post-lesson issues are not cancelled here — use dispute resolution (**`PUT /api/disputes/:id/resolve`**), refunds, or other documented admin actions.

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
- **Description**: Sets `bookings.status` → **`coach_no_show`** (coach did not attend). Allowed source statuses are `confirmed`, `awaiting_verification`, `student_no_show`, or `coach_no_show`, and the lesson end time has passed, **with no active dispute**. This endpoint can be used to correct an earlier admin attendance mark (including `student_no_show` → `coach_no_show`) while the booking is still financially mutable. If disputed (or any open/under_review dispute exists), this endpoint returns conflict and you should resolve through **`PUT /api/disputes/:id/resolve`** as the final authority path. Triggers coach reliability recalculation. Attempts automatic student refund for the latest refundable captured payment (`auto_refund` field in response reports `initiated` vs `skipped` reason). Reliability scoring deduplicates this outcome against a resolved **`coach_no_show`** dispute on the same booking (see dispute resolve **Reliability** notes).
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

### `POST /api/admin/bookings/:id/refund`
- **Auth**: Required (`admin`)
- **Description**: Admin override refund for a booking's latest payment.
  - **Single-settlement guardrail**: if the booking already has **any refund activity** (pending refund or any amount already refunded), this endpoint returns **409** with `code: refund_path_already_used` — including cases where the first refund was partial.
  - **Dispute-first guardrail**: if the booking has an **open** or **under_review** dispute, this endpoint returns **409** with `code: refund_requires_dispute_resolution`. Resolve the dispute (`PUT /api/disputes/:id/resolve`) for financial decisions.
- **Request Body**:
  ```json
  {
    "refund_amount": "number (optional, USD; if omitted refunds full remaining Stripe balance)",
    "reason": "string (optional; requested_by_customer | duplicate | fraudulent)",
    "reason_notes": "string (optional, max 255 chars)"
  }
  ```
- **Response**: Refund initiation payload (`booking_id`, `payment_id`, `refund_amount`, `refund_status`, `stripe_refund_id`)

### `POST /api/admin/disputes`
- **Auth**: Required (`admin`)
- **Description**: Same behavior as **`POST /api/disputes`**: creates a dispute row with **`opened_by` → `admin`**. Use when support records an issue (e.g. user contacted support instead of the app). Does **not** change `bookings.status` by itself — combine with **`PUT /api/disputes/:id/resolve`**, **`POST /api/admin/bookings/:id/refund`**, **`POST /api/admin/bookings/:id/cancel`** (pre-lesson only), or **`POST /api/admin/bookings/:id/coach-no-show`** as appropriate. For **coach did not attend** after lesson end, prefer **`POST /api/admin/bookings/:id/coach-no-show`** (reliability) and/or this endpoint + resolve for the audit trail and refunds.
- **Request Body**: Same as **`POST /api/disputes`** (`booking_id`, `dispute_type_id`, optional `notes`).

### Admin Incident Playbook (What To Use, When)

Use this section as the admin decision guide for incidents, payouts/refunds, disputes, and reliability.

- **Booking status endpoints** (`cancel`, `student-no-show`, `coach-no-show`) set the canonical booking outcome.
- **Dispute endpoints** (`create`, `resolve`) manage case workflow and optional dispute-driven refunds.
- **Refund endpoint** (`POST /api/admin/bookings/:id/refund`) moves money without requiring a dispute.
- **Reliability adjust endpoint** (`PUT /api/admin/users/:id/reliability`) is a manual support override, not the normal path.

| Situation | Primary endpoint | Add these if needed | Important notes |
|---|---|---|---|
| Lesson has **not** happened yet (`pending` / `confirmed`) and needs cancellation | `POST /api/admin/bookings/:id/cancel` | `POST /api/admin/bookings/:id/refund` only for rare/manual follow-up adjustments after the automatic cancel-policy refund/void flow (not the default path) | Cancel is pre-lesson only; sets `cancelled_by: admin`; automatically runs cancel-policy refund/void when applicable; does not apply reliability penalty to admin |
| Lesson ended and **student** did not attend | `POST /api/admin/bookings/:id/student-no-show` | If disputed/active case: `PUT /api/disputes/:id/resolve` | Sets `bookings.status -> student_no_show`; updates student reliability; coach payout follows normal payout flow. Admin may also use this to correct `coach_no_show -> student_no_show` before financial settlement lock |
| Lesson ended and **coach** did not attend | `POST /api/admin/bookings/:id/coach-no-show` | If disputed/active case: `PUT /api/disputes/:id/resolve`; fallback manual refund endpoint if auto-refund is skipped | Sets `bookings.status -> coach_no_show`; updates coach reliability; attempts automatic student refund. Admin may also use this to correct `student_no_show -> coach_no_show` before financial settlement lock |
| Quality/conduct/billing issue needs case tracking (user contacted support, evidence review, etc.) | `POST /api/admin/disputes` | `PUT /api/disputes/:id/resolve` (+ optional refund via resolution action) | Creating a dispute does not change booking status by itself |
| Existing dispute is ready for outcome | `PUT /api/disputes/:id/resolve` | Send `decision` + `financial_action` for all disputes; include `outcome` only for attendance claims | Resolve is the final authority; decision is explicit, booking status comes from `outcome` (attendance only), money comes from `financial_action` |
| Need money returned and **no active dispute** | `POST /api/admin/bookings/:id/refund` | N/A | Refund goes back to original charge/payment method; booking status unchanged unless changed separately |
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
- **Refunds and status are separate actions.** Most status endpoints do not automatically refund; call refund flow explicitly when needed.
- **Refund is a single settlement per booking incident.** Once any refund starts (partial or full), additional refund attempts are blocked with `409 refund_path_already_used`.
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

**MVP note:** Payment rows are created when a student books a lesson (`POST /api/bookings`) and updated via Stripe webhooks and booking flows. There are no admin HTTP endpoints to create payments, adjust status, or mark refunds in isolation—use Stripe Dashboard and webhook replay; refunds that move money go through **`paymentService.processRefund`** (e.g. booking cancellation).

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
  - **`financial_action`** (money only): **`no_change`** (no Stripe refund on resolve; no financial or payout changes are made as part of dispute resolution. The booking continues under standard payout rules, which typically result in coach payout if the lesson is validly completed and not refunded), **`refund_student`** (full remaining on the booking’s latest captured charge), **`refund_student_partial`** (**`refund_amount`** required, US dollars).  
  - **`outcome`** (attendance claims only): **`student_no_show`** | **`coach_no_show`** — required for attendance claims when `decision` is `upheld` or `partial`; must be omitted when `decision` is `rejected` (neutral rejected path). When provided/applied, this sets **`bookings.status`** to the same value. Non-attendance disputes must omit `outcome`.
  - **`penalize_role`** (behavior disputes only): **`coach`** | **`student`** | **`none`** for `late_arrival`, `misconduct`, `lesson_not_completed`.
    - `decision = upheld|partial` -> must be `coach` or `student`
    - `decision = rejected` -> must be `none`
    - attendance claims must omit `penalize_role`
  - **Strict consistency rules (attendance claims):**
    - if `decision = rejected`, `outcome` must be omitted and `financial_action` must be `no_change`
    - if `decision = upheld` or `partial`, `outcome` is required
  The API still stores internal `resolution_action_id` mappings on the dispute row for audit/FKs.

  **Refunds (money path):** Automatic refunds use the booking’s **latest** payment’s Stripe **charge**. Money returns to the **original payment method** on that charge (typically the **student** who paid). Coaches and admins do not receive these funds via this endpoint.
  - **Single-path guardrail**: when a refund would run (`refund_student` / `refund_student_partial`), if the booking already has any refund activity (pending or already refunded amount), the API returns **409** with `code: refund_path_already_used`. Resolve with `financial_action: no_change` instead, or finish refunds through a single path.

  **Decimal amounts:** `refund_amount` is US dollars. The server converts to **integer cents** with `Math.round(dollars * 100)` before calling Stripe (avoids float drift such as `12.34 * 100`).

  **Idempotency:** Keys are `dispute-resolve-{disputeId}-payment-{paymentId}-full-{refundCents}` for full refunds and `…-partial-{refundCents}` for partials (`refund_student_partial`). Retries with the same inputs reuse the same key.

  **Payouts vs refunds:** Automatic refunds here only hit the **charge** on the booking payment. Coach **payout** timing is handled elsewhere (payout workers, Connect, webhooks). If no payout has been sent, a refund reduces what can be transferred; if a payout **already** completed, recovering funds may require Stripe/support flows—verify in your environment rather than assuming this endpoint reverses transfers.

  **Reliability:**  
  - Attendance claims: reliability follows **`bookings.status`** after resolve (driven by explicit **`outcome`**). Rejected attendance claims without `outcome` keep booking status unchanged and do not apply attendance no-show reliability penalties.  
  - Behavior disputes (`late_arrival`, `misconduct`, `lesson_not_completed`): reliability impact is based on a **sustained** ruling (`decision` = `upheld` or `partial`) and the explicit **`penalize_role`**; `financial_action` does not decide whether reliability is penalized.

  **Coach no-show — one incident, one penalty:** If a booking is already **`coach_no_show`**, reliability does **not** also count a resolved **`coach_no_show_claim`** dispute for that booking (the outcome is reflected via the booking-status path). The same idea applies to **student** **`student_no_show`** vs a resolved **`student_no_show_claim`**. Operationally you can still resolve disputes for audit/refunds; scores stay consistent.

  If a refund is required and Stripe fails (no charge, nothing left to refund, etc.), the dispute **stays open** — the API returns **400** (validation / no refundable balance) or **502** (other refund failure). `no_change` does not trigger a refund.

- **Request body**:
  ```json
  {
    "decision": "upheld | rejected | partial",
    "outcome": "student_no_show | coach_no_show (attendance claims only; required when decision is upheld/partial, omitted when rejected)",
    "penalize_role": "coach | student | none (behavior disputes only)",
    "financial_action": "no_change | refund_student | refund_student_partial",
    "resolution_notes": "string (optional, max 1000)",
    "refund_amount": "number (optional) — required when financial_action is refund_student_partial; US dollars, min 0.01"
  }
  ```

- **Errors**: **400** validation for invalid payloads (missing required `decision`/`financial_action`, missing `outcome` for attendance claims when `decision` is `upheld`/`partial`, `outcome` supplied for non-attendance type, non-null `outcome` on rejected attendance claims, non-`no_change` financial action on rejected attendance claims, invalid/missing `penalize_role` for behavior disputes, missing `refund_amount` for partial path, etc.). **400** / **502** if a refund was required but could not be completed. **409** `refund_path_already_used` when a refund path already exists.

- **Response** (Status: 200): `data` always includes **`dispute`**. When a refund was initiated, **`refund`** is included. `resolution` is included with `{ "decision", "financial_action", "outcome?" , "derived_booking_status?" }` (`outcome` fields only for attendance claims).
  For behavior disputes, `resolution` also includes `penalize_role`.
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
        "payment_id": 42,
        "refund_amount": "45.00",
        "refund_status": "pending",
        "stripe_refund_id": "re_xxxxxxxxxxxxxx"
      }
    }
  }
  ```
  `refund` is present only when a Stripe refund was started. `resolution` is present for explicit attendance resolves. Final payment state is still updated by webhooks / reconciliation as for other refunds.

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
- **Description**: **Coach** reliability in one structured object (reads `user_reliability` where `role = coach`). `reliability_score`, `total_bookings`, and `penalties.*` come from that row (last recompute). `reschedules.*` counts are live from `RescheduleHistory` (coach-requested only). For student-only metrics, use the student row in DB or recompute via internal tooling (student GET endpoint not exposed here yet).
- **`penalties`**:
  - `late_cancels` = coach cancellations in the late window (within 24 hours before `scheduled_at`, with `affects_reliability`).
  - `coach_cancels_non_late` = remaining penalized coach cancellations (same rules as `reliabilityService`: excludes the late-window bucket so each cancel is counted once).
  - `no_shows` = no-show count used in scoring.
  - Dispute buckets (resolved + reliability-eligible type + sustained decision `upheld|partial`): `late_arrival_disputes`, `coach_no_show_disputes`, `student_no_show_disputes`, `misconduct_disputes`, `lesson_not_completed_disputes`.
  - `penalties.points` provides score-impact contributions for dispute buckets using current formula:
    - `late_arrival`: `(late_arrival_disputes / total_bookings) * 5`
    - `lesson_not_completed`: `(lesson_not_completed_disputes / total_bookings) * 10`
    - `coach_no_show`: `(coach_no_show_disputes / total_bookings) * 35`
    - `misconduct`: `(misconduct_disputes / total_bookings) * 25`
- **`reschedules`**: `total` = all coach reschedules; `penalized` / `non_penalized` split by `affects_reliability`. Reliability score uses the **penalized** bucket only. **`reschedules.paid`**: `count` = rows with `paid_reschedule` set; `with_captured_payment` restricts to payments with `payment_status: captured` (includes per-type counts and dollar amounts).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach reliability retrieved successfully",
    "data": {
      "reliability": {
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
          "late_arrival_disputes": 1,
          "coach_no_show_disputes": 0,
          "student_no_show_disputes": 0,
          "misconduct_disputes": 1,
          "lesson_not_completed_disputes": 0,
          "no_shows": 0,
          "coach_cancels_non_late": 1,
          "points": {
            "late_arrival": 0.5,
            "coach_no_show": 0,
            "misconduct": 2.5,
            "lesson_not_completed": 0
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
