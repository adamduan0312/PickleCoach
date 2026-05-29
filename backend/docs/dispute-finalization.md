# Dispute finalization and attendance locks

This document describes how **`bookings.attendance_finalized`** interacts with dispute resolution and admin/coach attendance endpoints. Runtime behavior lives in **`disputeController.resolveDispute`**, **`bookingController.adminMarkBookingNoShow`**, **`bookingController.adminMarkCoachNoShow`**, and **`utils/bookingAttendanceStatus.js`**.

## What `attendance_finalized` means

| It does **not** mean | It **does** mean |
|----------------------|------------------|
| The booking row can never change again in any column | Attendance **outcome** cannot be mutated **outside** dispute adjudication (admin no-show routes are blocked) |
| The booking is deleted or invalidated | The booking incident has passed an authoritative resolve boundary |
| Only attendance disputes set the flag | **Every** successful resolve sets the flag (attendance + behavior types) |

**Behavior disputes** (`misconduct`, `late_arrival`, `lesson_not_completed`) intentionally set **`attendance_finalized = true`** as well: any dispute resolution is treated as the adjudication boundary for the incident, not only attendance claims. **`lesson_not_completed`** does not imply booking deletion or that attendance stays editable via admin shortcuts after resolve.

## Precedence: who may change attendance outcome

| Lifecycle stage | Allowed writers for attendance outcome (`bookings.status` when moving to/from `student_no_show` / `coach_no_show`, or attendance-driven transitions) |
|-----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Pre-dispute (no active dispute, not finalized) | Coach **`POST /api/bookings/:id/student-no-show`** (narrow sources), admin **`POST /api/admin/bookings/:id/student-no-show`**, admin **`POST /api/admin/bookings/:id/coach-no-show`** (subject to existing guards: lesson ended, active dispute, payment locks, etc.) |
| Active dispute (`open` / `under_review`, or booking `disputed` where applicable) | **`PUT /api/disputes/:id/resolve`** only — mark-no-show endpoints return **`409`** `disputed_use_resolve_dispute` |
| Finalized (`attendance_finalized === true`) | **Only** a **new** dispute + **`PUT /api/disputes/:id/resolve`** — admin no-show endpoints return **`409`** `attendance_finalized_locked` |

**`PUT /api/disputes/:id/resolve`** is the authoritative attendance adjudication boundary: it is the only path that sets **`attendance_finalized`**, and it may still update **`bookings.status`** when resolving a **subsequent** attendance dispute (allowed source statuses include terminal attendance and `completed`; see **`DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES`**).

## Data truth model

| Field | Role |
|-------|------|
| **`bookings.status`** | Operational final state for product/UI (e.g. `completed`, `student_no_show`, `coach_no_show`) |
| **`disputes.outcome`** | Canonical historical attendance determination **for that dispute row** (attendance dispute types only; immutable after resolve) |
| **`bookings.attendance_finalized`** | Guardrail: blocks direct admin attendance mutations after any resolve |

## Related docs

- **`docs/dispute-state-machine.md`** — `disputes.status` lifecycle and `ACTIVE_DISPUTE_STATUSES`.
- **`docs/booking-state-machine.md`** — `bookings.status` lifecycle and dispute coupling.
- **`API_ENDPOINTS.md`** — section **Attendance finalization** under **`PUT /api/disputes/:id/resolve`**, and admin no-show routes.
- **`models/Booking.js`** — field-level comment on **`attendance_finalized`**.
- **`migrations/20260514150000-add-booking-attendance-finalized.cjs`** — column addition and backfill notes.
