# API Endpoints Reference

Complete list of all API endpoints with detailed field specifications.

**Base URL**: All endpoints are prefixed with `/api`

**Authentication**: Most endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

**Response convention**: For create/update endpoints, the response body echoes all **safe** request-body fields (same keys, with `null` when optional and unset) so clients see a consistent shape and can easily compare request vs response in Postman. Sensitive fields (e.g. password) are never returned.

**Delete behavior**: **Soft delete** (set `deleted_at` / `is_active: false`, row kept): users (self-delete `DELETE /api/auth/me`, admin `DELETE /api/users/:id`), coach profile (when user is deleted), courts (`DELETE /api/courts/:id`), lessons (`DELETE /api/lessons/:id`). **Hard delete** (row removed): coach availability (`DELETE /api/coaches/availability/:id` coach-only, or `DELETE /api/admin/coaches/:coachId/availability/:id` admin), coach–court link (`DELETE /api/coaches/me/courts/:id` coach-only, or `DELETE /api/admin/coaches/:coachId/courts/:linkId` admin), reviews (`DELETE /api/reviews/:id`). Bookings are cancelled via `POST /api/bookings/:id/cancel`, not deleted.

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
        "avatar_url": null
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Note**: All safe request fields (full_name, email, role, phone, timezone, avatar_url) are echoed in the response; optional ones are `null` when not sent. Avatar can also be set or changed later via `PUT /api/auth/profile`.
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
        "avatar_url": null
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Error responses**: `400` (validation failed – invalid body), `401` (invalid credentials), `403` (account inactive), `500` (server error).

### `POST /api/auth/refresh`
- **Auth**: Bearer token (can be expired)
- **Description**: Refresh an expired JWT token
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
        "avatar_url": null
      }
    }
  }
  ```

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
- **Description**: Change the current authenticated user's password using their existing password. **All existing sessions/tokens are revoked** via token versioning; clients should prompt the user to log in again if necessary.
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
    "data": null
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
    "data": null
  }
  ```
- **Behavior**:
  - Validates the token (`email_change_token`) and ensures `email_change_expires` is in the future.
  - Updates `user.email` to the pending `email_change_new_email`.
  - Clears `email_change_token`, `email_change_expires`, and `email_change_new_email`.
  - Sets `email_verified_at` to now (the new email is considered verified).
  - Increments `token_version` for the user, revoking all existing JWTs.
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
- **Description**: Get current authenticated user's profile
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Profile retrieved successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "role": "student",
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": "https://example.com/avatar.jpg",
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```
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

### Email verification & "serious actions"

- **Token versioning**: All JWTs include a `tokenVersion` claim. The backend stores `token_version` per user and rejects tokens where the claim does not match, allowing **global session revocation** when passwords/emails are changed.
- **Email verification**:
  - Many endpoints only require a valid JWT.
  - **High-impact endpoints** additionally require `email_verified_at` to be set (see notes below).
  - Unverified users receive `403` with a message instructing them to verify their email.
- **Endpoints requiring verified email**:
  - `POST /api/bookings` (create booking)
  - `POST /api/payments` (create payment)
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
- **Description**: Get all users (admin only). By default returns only non–soft-deleted users.
- **Query Parameters**:
  - `page`: number (optional, default: 1)
  - `limit`: number (optional, default: 10)
  - `role`: string (optional, filter by role: 'student' | 'coach' | 'admin')
  - `include_deleted`: string `'true'` | `'false'` (optional). If `'true'`, includes soft-deleted users; default is non-deleted only.
  - `search`: string (optional). Filters users by **full name** or **email** (case-insensitive, partial match). Use for admin "find user" without scrolling the full list.
- **Note**: Response items include `is_active`; use client-side filtering or display by active/inactive as needed.
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
        "role": "student",
        "is_active": true,
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```
  Note: Pagination info is included in the response structure (see pagination section)

### `GET /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Get user by ID (admin only). Non-admins should use `GET /api/auth/profile` for their own profile.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "User retrieved successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "role": "coach",
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
        "reliability_score": 95.5
      }
    }
  }
  ```

### `PUT /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Update user (admin only - can update role, is_active, email, avatar_url, etc.)
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
- **Description**: List coaches with optional filters. Use **lat**, **lng**, and **radius** to find coaches who have courts within that distance (e.g. "coaches near me"). Other filters: skill level, minimum rating, pagination.
- **Query Parameters**:
  - `lat` (optional) – latitude in degrees (center point for distance filter)
  - `lng` (optional) – longitude in degrees (center point for distance filter)
  - `radius` (optional) – miles from (lat, lng); default 10, max 500
  - `skill_level` (optional) – `beginner` | `intermediate` | `advanced` | `pro`
  - `min_rating` (optional) – minimum coach rating (0–5)
  - `page` (optional) – page number; default 1
  - `limit` (optional) – items per page; default 10
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
- **Auth**: None required
- **Description**: Get coach details by ID (public)
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

### `POST /api/coaches/profile`
- **Auth**: Required
- **Description**: Create coach profile (for users with coach role)
- **Request Body**:
  ```json
  {
    "user_id": "number (optional, admin only - defaults to authenticated user's ID)",
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

### `POST /api/coaches/availability`
- **Auth**: Required
- **Description**: Create coach availability slot
- **Request Body**:
  ```json
  {
    "coach_id": "number (optional, admin only - defaults to authenticated user's ID)",
    "weekday": "string (optional)",
    "start_datetime": "string (optional, ISO 8601 date-time)",
    "end_datetime": "string (optional, ISO 8601 date-time)",
    "start_date": "string (optional, ISO 8601 date)",
    "end_date": "string (optional, ISO 8601 date)",
    "recurrence_rule": "string (optional)",
    "is_available": "boolean (optional, defaults to true)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Availability created successfully",
    "data": {
      "id": 1,
      "coach_id": 1,
      "weekday": "monday",
      "start_datetime": "2026-02-01T09:00:00.000Z",
      "end_datetime": "2026-02-01T17:00:00.000Z",
      "is_available": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `GET /api/coaches/:id/availability`
- **Auth**: None required
- **Description**: Get coach availability (public)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Availability retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 1,
        "weekday": "monday",
        "start_datetime": "2026-02-01T09:00:00.000Z",
        "end_datetime": "2026-02-01T17:00:00.000Z",
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
- **Description**: Search courts (with lazy import from OpenStreetMap if no results)
- **Query Parameters**: Search filters (location, name, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Courts retrieved successfully",
    "data": [
      {
        "id": 1,
        "name": "Central Park Pickleball Court",
        "address": "123 Main St",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "is_private": false,
        "is_verified": true
      }
    ]
  }
  ```

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
- **Description**: Get all lessons (public)
- **Query Parameters**: Filters (coach_id, is_active, etc.)
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


### `GET /api/bookings`
- **Auth**: Required
- **Description**: List bookings. **Non-admin**: only your own (as coach or student). **Admin**: can filter by coach_id, student_id, status.
- **Query Parameters**: status, coach_id (admin only), student_id (admin only), page, limit
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
- **Description**: Get booking details by ID
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

### `POST /api/bookings`
- **Auth**: Required (email must be verified)
- **Description**: Create a new booking
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

### `PUT /api/bookings/:id/status`
- **Auth**: Required
- **Description**: Update booking status (e.g., confirm, complete)
- **Request Body**:
  ```json
  {
    "status": "string (required, booking status)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Booking status updated successfully",
    "data": {
      "id": 1,
      "status": "confirmed",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/bookings/:id/cancel`
- **Auth**: Required
- **Description**: Cancel a booking (triggers refund if applicable)
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
- **Query Parameters**: Filters (status, escrow_status, student_id, coach_id, etc.)
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

### `POST /api/payments`
- **Auth**: Required (email must be verified)
- **Description**: Create a payment (usually created automatically with booking)
- **Request Body**:
  ```json
  {
    "booking_id": "number (required, positive integer)",
    "payment_method": "string (optional, 'stripe' | 'apple_pay' | 'google_pay' | 'card', defaults to 'stripe')",
    "payment_intent_id": "string (optional)",
    "charge_id": "string (optional)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Payment created successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "student_id": 1,
      "coach_id": 2,
      "total_charge_to_student": 50.00,
      "platform_fee_amount": 4.00,
      "coach_payout_amount": 46.00,
      "payment_status": "pending",
      "escrow_status": "held",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/payments/:id/status`
- **Auth**: Required (Admin only)
- **Description**: Update payment status (admin only)
- **Request Body**:
  ```json
  {
    "payment_status": "string (optional)",
    "escrow_status": "string (optional)",
    "charge_id": "string (optional)",
    "transfer_id": "string (optional)",
    "payout_id": "string (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Payment status updated successfully",
    "data": {
      "id": 1,
      "payment_status": "captured",
      "escrow_status": "released",
      "charge_id": "ch_...",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/payments/:id/refund`
- **Auth**: Required (Admin only)
- **Description**: Process a refund for a payment (admin only)
- **Request Body**:
  ```json
  {
    "refund_amount": "number (optional)",
    "reason": "string (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Refund processed successfully",
    "data": {
      "id": 1,
      "refund_amount": 50.00,
      "refund_status": "processed",
      "refund_id": "re_...",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

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
- **Description**: List reviews with optional filters (target_user_id, reviewer_id, etc.)
- **Query Parameters**: target_user_id, reviewer_id, page, limit
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
- **Description**: Get all conversations for the authenticated user
- **Query Parameters**: `booking_id` (optional filter)
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
- **Description**: Get conversation by ID with paginated messages
- **Query Parameters**: `page`, `limit` (for message pagination)
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

### `GET /api/disputes`
- **Auth**: Required
- **Description**: Get disputes (filtered by user role)
- **Query Parameters**: Filters (status, type, booking_id, etc.)
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
        "opened_by": "student",
        "status": "open",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `GET /api/disputes/:id`
- **Auth**: Required
- **Description**: Get dispute details by ID
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Dispute retrieved successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "dispute_type_id": 1,
      "opened_by": "student",
      "status": "open",
      "booking": {
        "id": 1,
        "scheduled_at": "2026-02-01T10:00:00.000Z"
      },
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/disputes`
- **Auth**: Required (email must be verified)
- **Description**: Create a dispute
- **Request Body**:
  ```json
  {
    "booking_id": "number (required)",
    "dispute_type_id": "number (required)",
    "notes": "string (optional)"
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
      "opened_by": "student",
      "status": "open",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/disputes/:id/resolve`
- **Auth**: Required (Admin only)
- **Description**: Resolve a dispute (admin only)
- **Request Body**:
  ```json
  {
    "resolution_action_id": "number (required)",
    "resolution_notes": "string (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Dispute resolved successfully",
    "data": {
      "id": 1,
      "status": "resolved",
      "resolution_action_id": 1,
      "resolution_notes": "Approved refund due to service issue",
      "resolved_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

---

## Notifications (`/api/notifications`)

### `GET /api/notifications`
- **Auth**: Required
- **Description**: Get user's notifications
- **Query Parameters**: Filters (status, type, unread_only, etc.)
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
      },
      "alerts": {
        "unresolved": 5
      }
    }
  }
  ```

### `GET /api/admin/alerts`
- **Auth**: Required (Admin only)
- **Description**: Get system alerts
- **Query Parameters**: `resolved` (boolean, optional, defaults to false)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Alerts retrieved successfully",
    "data": [
      {
        "id": 1,
        "alert_type": "payment_failed",
        "severity": "high",
        "resolved": false,
        "relatedUser": {
          "id": 1,
          "full_name": "John Doe"
        },
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `PUT /api/admin/alerts/:id/resolve`
- **Auth**: Required (Admin only)
- **Description**: Resolve an alert
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Alert resolved successfully",
    "data": {
      "id": 1,
      "resolved": true,
      "resolved_at": "2026-01-01T12:00:00.000Z"
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

### `PUT /api/admin/users/:id/reliability`
- **Auth**: Required (Admin only)
- **Description**: Manually adjust user reliability score
- **Request Body**:
  ```json
  {
    "new_score": "number (required, 0-100)",
    "reason": "string (optional)",
    "explanation": "string (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Reliability score adjusted successfully",
    "data": {
      "user_id": 1,
      "user_role": "coach",
      "previous_score": 100.00,
      "new_score": 85.5,
      "adjusted_by": 10,
      "reason": "Manual adjustment",
      "explanation": "Adjusted due to dispute resolution"
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

### `DELETE /api/admin/coaches/:coachId/courts/:linkId`
- **Auth**: Required (Admin only)
- **Description**: Unlink a court from a coach (e.g. wrong court linked). **Path**: `coachId` = coach's user id, `linkId` = coach_court_location id (from GET /api/admin/coaches/:coachId/courts `data[].id`).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court unlinked from coach successfully",
    "data": null
  }
  ```
- **Error responses**: `403` (not admin), `404` (coach or link not found), `500` (server error).

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
