# API Endpoints Reference

Complete list of all API endpoints with brief explanations.

**Base URL**: All endpoints are prefixed with `/api`

**Authentication**: Most endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## Health Check

### `GET /health`
- **Auth**: None required
- **Description**: Health check endpoint to verify server and database connectivity
- **Response**: Server status, database connection, uptime

---

## Authentication (`/api/auth`)

### `POST /api/auth/register`
- **Auth**: None required
- **Description**: Register a new user account
- **Body**: `{ full_name, email, password, role: 'student' | 'coach' }`
- **Response**: User data and JWT token

### `POST /api/auth/login`
- **Auth**: None required
- **Description**: Login and receive JWT token
- **Body**: `{ email, password }`
- **Response**: User data and JWT token

### `POST /api/auth/refresh`
- **Auth**: Bearer token (can be expired)
- **Description**: Refresh an expired JWT token
- **Body**: `{ token }`
- **Response**: New JWT token

### `GET /api/auth/profile`
- **Auth**: Required
- **Description**: Get current authenticated user's profile
- **Response**: User profile data

### `PUT /api/auth/profile`
- **Auth**: Required
- **Description**: Update current authenticated user's profile
- **Body**: User profile fields to update
- **Response**: Updated user profile

---

## Users (`/api/users`)

### `GET /api/users`
- **Auth**: Required (Admin only)
- **Description**: Get all users (admin only)
- **Response**: List of all users

### `GET /api/users/:id`
- **Auth**: Required
- **Description**: Get user by ID
- **Response**: User data

### `PUT /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Update user (admin only)
- **Body**: User fields to update
- **Response**: Updated user data

### `DELETE /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Delete user (admin only)
- **Response**: Success message

---

## Coaches (`/api/coaches`)

### `GET /api/coaches`
- **Auth**: None required
- **Description**: Search and get all coaches (public)
- **Query Params**: Search filters (location, skill level, etc.)
- **Response**: List of coaches

### `GET /api/coaches/:id`
- **Auth**: None required
- **Description**: Get coach details by ID (public)
- **Response**: Coach profile with ratings and availability

### `POST /api/coaches/profile`
- **Auth**: Required
- **Description**: Create coach profile (for users with coach role)
- **Body**: Coach profile data
- **Response**: Created coach profile

### `PUT /api/coaches/profile/:id`
- **Auth**: Required
- **Description**: Update coach profile
- **Body**: Coach profile fields to update
- **Response**: Updated coach profile

### `POST /api/coaches/availability`
- **Auth**: Required
- **Description**: Create coach availability slot
- **Body**: Availability data (weekday, start_datetime, end_datetime, etc.)
- **Response**: Created availability

### `GET /api/coaches/:id/availability`
- **Auth**: None required
- **Description**: Get coach availability (public)
- **Response**: List of availability slots

### `POST /api/coaches/me/courts`
- **Auth**: Required
- **Description**: Add a court location to coach's available courts
- **Body**: `{ court_location_id }`
- **Response**: Added court location

### `POST /api/coaches/me/stripe-connect/onboard`
- **Auth**: Required
- **Description**: Initiate Stripe Connect onboarding for coach
- **Response**: Stripe onboarding link

### `GET /api/coaches/me/stripe-connect/status`
- **Auth**: Required
- **Description**: Check Stripe Connect onboarding status
- **Response**: Stripe account status (charges_enabled, payouts_enabled)

---

## Courts (`/api/courts`)

### `GET /api/courts`
- **Auth**: None required
- **Description**: Search courts (with lazy import from OpenStreetMap if no results)
- **Query Params**: Search filters (location, name, etc.)
- **Response**: List of courts

### `GET /api/courts/:id`
- **Auth**: None required
- **Description**: Get court details by ID (public)
- **Response**: Court location data

### `POST /api/courts`
- **Auth**: Required
- **Description**: Create a new court location
- **Body**: Court location data
- **Response**: Created court location

---

## Lessons (`/api/lessons`)

### `GET /api/lessons`
- **Auth**: None required
- **Description**: Get all lessons (public)
- **Query Params**: Filters (coach_id, is_active, etc.)
- **Response**: List of lessons

### `GET /api/lessons/:id`
- **Auth**: None required
- **Description**: Get lesson by ID (public)
- **Response**: Lesson details

### `POST /api/lessons`
- **Auth**: Required (Coach only)
- **Description**: Create a new lesson
- **Body**: Lesson data (title, description, price, duration, etc.)
- **Response**: Created lesson

### `PUT /api/lessons/:id`
- **Auth**: Required
- **Description**: Update lesson
- **Body**: Lesson fields to update
- **Response**: Updated lesson

### `DELETE /api/lessons/:id`
- **Auth**: Required
- **Description**: Delete lesson
- **Response**: Success message

---

## Bookings (`/api/bookings`)

### `GET /api/bookings`
- **Auth**: Required
- **Description**: Get user's bookings (filtered by role - coach sees coach bookings, student sees student bookings)
- **Query Params**: Filters (status, date range, etc.)
- **Response**: List of bookings

### `GET /api/bookings/:id`
- **Auth**: Required
- **Description**: Get booking details by ID
- **Response**: Booking data with related lesson, coach, student info

### `POST /api/bookings`
- **Auth**: Required
- **Description**: Create a new booking
- **Body**: `{ lesson_id, scheduled_at, duration_minutes, court_location_id }`
- **Response**: Created booking with payment intent

### `PUT /api/bookings/:id/status`
- **Auth**: Required
- **Description**: Update booking status (e.g., confirm, complete)
- **Body**: `{ status }`
- **Response**: Updated booking

### `POST /api/bookings/:id/cancel`
- **Auth**: Required
- **Description**: Cancel a booking (triggers refund if applicable)
- **Body**: `{ reason, affects_reliability }`
- **Response**: Cancelled booking

### `POST /api/bookings/:id/reschedule`
- **Auth**: Required
- **Description**: Request a reschedule for a booking
- **Body**: `{ new_scheduled_at, reason, paid_reschedule }`
- **Response**: Reschedule request created

---

## Payments (`/api/payments`)

### `GET /api/payments`
- **Auth**: Required
- **Description**: Get user's payments
- **Query Params**: Filters (status, booking_id, etc.)
- **Response**: List of payments

### `GET /api/payments/:id`
- **Auth**: Required
- **Description**: Get payment details by ID
- **Response**: Payment data

### `POST /api/payments`
- **Auth**: Required
- **Description**: Create a payment (usually created automatically with booking)
- **Body**: Payment data
- **Response**: Created payment

### `PUT /api/payments/:id/status`
- **Auth**: Required (Admin only)
- **Description**: Update payment status (admin only)
- **Body**: `{ status }`
- **Response**: Updated payment

### `POST /api/payments/:id/refund`
- **Auth**: Required (Admin only)
- **Description**: Process a refund for a payment (admin only)
- **Body**: Refund data
- **Response**: Refund processed

---

## Reschedules (`/api/reschedules`)

### `GET /api/reschedules`
- **Auth**: Required
- **Description**: Get reschedule history for user's bookings
- **Query Params**: Filters (booking_id, status, etc.)
- **Response**: List of reschedule records

### `POST /api/reschedules/request`
- **Auth**: Required
- **Description**: Request a reschedule (alternative to `/api/bookings/:id/reschedule`)
- **Body**: `{ booking_id, new_scheduled_at, reason, paid_reschedule }`
- **Response**: Reschedule request created

---

## Reviews (`/api/reviews`)

### `GET /api/reviews`
- **Auth**: None required
- **Description**: Get reviews (public)
- **Query Params**: Filters (coach_id, student_id, rating, etc.)
- **Response**: List of reviews

### `POST /api/reviews`
- **Auth**: Required
- **Description**: Create a review
- **Body**: `{ booking_id, rating, comment, target_user_id }`
- **Response**: Created review

### `PUT /api/reviews/:id`
- **Auth**: Required
- **Description**: Update review (only by reviewer)
- **Body**: Review fields to update
- **Response**: Updated review

### `DELETE /api/reviews/:id`
- **Auth**: Required
- **Description**: Delete review (only by reviewer)
- **Response**: Success message

---

## Messages (`/api/messages`)

### `GET /api/messages/conversations`
- **Auth**: Required
- **Description**: Get all conversations for the authenticated user
- **Query Params**: `booking_id` (optional filter)
- **Response**: List of conversations with latest message

### `GET /api/messages/conversations/:id`
- **Auth**: Required
- **Description**: Get conversation by ID with paginated messages
- **Query Params**: `page`, `limit` (for message pagination)
- **Response**: Conversation with messages

### `POST /api/messages/conversations`
- **Auth**: Required
- **Description**: Create a new conversation for a booking
- **Body**: `{ booking_id }`
- **Response**: Created conversation

### `POST /api/messages/send`
- **Auth**: Required
- **Description**: Send a message in a conversation
- **Body**: `{ conversation_id, content, attachments }`
- **Response**: Created message

### `PUT /api/messages/:id/read`
- **Auth**: Required
- **Description**: Mark a message as read
- **Response**: Updated message with read_at timestamp

---

## Disputes (`/api/disputes`)

### `GET /api/disputes`
- **Auth**: Required
- **Description**: Get disputes (filtered by user role)
- **Query Params**: Filters (status, type, booking_id, etc.)
- **Response**: List of disputes

### `GET /api/disputes/:id`
- **Auth**: Required
- **Description**: Get dispute details by ID
- **Response**: Dispute data

### `POST /api/disputes`
- **Auth**: Required
- **Description**: Create a dispute
- **Body**: `{ booking_id, dispute_type_id, description }`
- **Response**: Created dispute

### `PUT /api/disputes/:id/resolve`
- **Auth**: Required (Admin only)
- **Description**: Resolve a dispute (admin only)
- **Body**: `{ resolution_action_id, resolution_notes }`
- **Response**: Resolved dispute

---

## Notifications (`/api/notifications`)

### `GET /api/notifications`
- **Auth**: Required
- **Description**: Get user's notifications
- **Query Params**: Filters (status, type, unread_only, etc.)
- **Response**: List of notifications

### `POST /api/notifications`
- **Auth**: Required (Admin only)
- **Description**: Create a notification (admin only)
- **Body**: Notification data
- **Response**: Created notification

### `PUT /api/notifications/:id/read`
- **Auth**: Required
- **Description**: Mark notification as read
- **Response**: Updated notification

---

## Admin (`/api/admin`)

### `GET /api/admin/dashboard`
- **Auth**: Required (Admin only)
- **Description**: Get admin dashboard statistics
- **Response**: Dashboard stats (users, bookings, revenue, etc.)

### `GET /api/admin/alerts`
- **Auth**: Required (Admin only)
- **Description**: Get system alerts
- **Response**: List of alerts

### `PUT /api/admin/alerts/:id/resolve`
- **Auth**: Required (Admin only)
- **Description**: Resolve an alert
- **Response**: Resolved alert

### `POST /api/admin/users`
- **Auth**: Required (Admin only)
- **Description**: Create an admin user account
- **Body**: `{ full_name, email, password, phone, timezone }`
- **Response**: Created admin user

### `PUT /api/admin/users/:id/reliability`
- **Auth**: Required (Admin only)
- **Description**: Manually adjust user reliability score
- **Body**: `{ reliability_score, reason }`
- **Response**: Updated user reliability

---

## Webhooks (`/api/webhooks`)

### `POST /api/webhooks/stripe`
- **Auth**: None (uses Stripe signature verification)
- **Description**: Stripe webhook endpoint for payment events
- **Body**: Stripe webhook event
- **Response**: Success acknowledgment

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

## Success Responses

All endpoints return consistent success responses:

```json
{
  "success": true,
  "data": {},
  "message": "Success message"
}
```

