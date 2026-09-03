import { isMessagingLocked } from './bookingMessaging.js';
import { serializeCourtLocationForBooking } from './courtAddressVisibility.js';
import { serializeFinancialReview } from './financialReviewWindow.js';
import { getCoachAcceptanceTimeoutHours, getMinBookingLeadHours, getCoachAcceptanceDeadlineAt } from './coachAcceptanceTimeout.js';

function attachPendingAcceptanceFields(dto, plain) {
  if (!dto || dto.status !== 'pending') return dto;
  dto.coach_acceptance_timeout_hours = getCoachAcceptanceTimeoutHours();
  dto.min_booking_lead_hours = getMinBookingLeadHours();
  if (plain?.created_at && plain?.scheduled_at) {
    dto.coach_acceptance_deadline_at = getCoachAcceptanceDeadlineAt({
      requestAt: plain.created_at,
      scheduledAt: plain.scheduled_at,
    }).toISOString();
  }
  return dto;
}

/** Core booking fields for list, disputes, and embedded summaries. */
export const BOOKING_SUMMARY_FIELD_NAMES = [
  'id',
  'lesson_id',
  'coach_id',
  'primary_student_id',
  'scheduled_at',
  'duration_minutes',
  'price',
  'status',
  'court_location_id',
  'created_at',
];

/** Lean booking embed for messaging inbox / thread / start-conversation. */
export const BOOKING_MESSAGING_FIELD_NAMES = [
  'id',
  'lesson_id',
  'scheduled_at',
  'status',
];

/** Additional booking fields for detail views and post-mutation responses. */
export const BOOKING_DETAIL_EXTRA_FIELD_NAMES = [
  'attendance_finalized',
  'cancelled_by',
  'cancelled_at',
  'payout_status',
  'declined_at',
  'decline_message_to_student',
  'decline_reason_code',
  'created_at',
  'updated_at',
];

export const LESSON_SUMMARY_FIELD_NAMES = [
  'id',
  'coach_id',
  'title',
  'description',
  'duration_minutes',
  'price',
  'effective_hourly_rate',
  'max_students',
  'is_active',
];

export const COURT_LOCATION_SUMMARY_FIELD_NAMES = [
  'id',
  'name',
  'address_line1',
  'city',
  'state',
  'postal_code',
  'country',
  'latitude',
  'longitude',
  'is_private',
];

/** Cancellation history on booking detail — no reliability engine internals. */
export const CANCELLATION_HISTORY_FIELD_NAMES = [
  'id',
  'booking_id',
  'cancelled_by',
  'refund_amount',
  'penalty_amount',
  'reason',
  'reason_notes',
  'penalty_reason',
  'cancelled_at',
];

export const USER_PARTY_FIELD_NAMES = ['id', 'full_name', 'avatar_url'];

function toPlain(row) {
  if (!row) return null;
  return row?.toJSON ? row.toJSON() : { ...row };
}

function pickFields(plain, fieldNames) {
  const dto = {};
  for (const key of fieldNames) {
    if (plain[key] !== undefined) dto[key] = plain[key];
  }
  return dto;
}

/**
 * Student reliability score for coach-facing booking embeds only.
 * Reads an existing `user_reliability` row (role=student) when present; never creates rows.
 * Defaults to **100** when missing / unreadable.
 *
 * @param {object|null|undefined} userOrReliability — User with optional `reliabilities`, or a reliability row
 * @returns {number}
 */
export function resolveStudentReliabilityScore(userOrReliability) {
  if (userOrReliability == null) return 100;
  const plain = toPlain(userOrReliability);
  if (!plain) return 100;

  if (plain.role === 'student' && plain.reliability_score != null) {
    const direct = Number(plain.reliability_score);
    return Number.isFinite(direct) ? direct : 100;
  }

  const rows = Array.isArray(plain.reliabilities) ? plain.reliabilities : [];
  const studentRow = rows.find((r) => r && r.role === 'student');
  if (!studentRow || studentRow.reliability_score == null) return 100;
  const n = Number(studentRow.reliability_score);
  return Number.isFinite(n) ? n : 100;
}

/**
 * @param {object|null|undefined} user
 * @param {{ includeStudentReliability?: boolean }} [opts]
 *   Opt-in only. Coach booking routes do not set this for MVP — student reliability
 *   is an internal / self / admin signal, not a coach marketplace field.
 *   When true, adds `reliability_score` only — never event history, penalties, or decay internals.
 */
export function serializeUserPartySummary(user, { includeStudentReliability = false } = {}) {
  if (!user) return null;
  const dto = pickFields(toPlain(user), USER_PARTY_FIELD_NAMES);
  if (includeStudentReliability) {
    dto.reliability_score = resolveStudentReliabilityScore(user);
  }
  return dto;
}

export function serializeLessonSummary(lesson) {
  if (!lesson) return null;
  return pickFields(toPlain(lesson), LESSON_SUMMARY_FIELD_NAMES);
}

/**
 * Booking-embedded court — applies private-court address redaction unless privileged
 * or booking status allows reveal (confirmed+).
 * @param {object|null|undefined} courtLocation
 * @param {{ bookingStatus?: string|null, viewerIsPrivileged?: boolean }} [opts]
 */
export function serializeCourtLocationSummary(courtLocation, opts = {}) {
  return serializeCourtLocationForBooking(courtLocation, opts);
}

/** Booking-detail cancellation history row (omits affects_reliability / refund_payment_id). */
export function serializeCancellationHistoryItem(record) {
  if (!record) return null;
  return pickFields(toPlain(record), CANCELLATION_HISTORY_FIELD_NAMES);
}

/**
 * Canonical trimmed booking for lists, disputes, and embeds.
 * Omits persistence internals (`idempotency_key`, `deleted_at`, etc.).
 */
export function serializeBookingSummary(booking) {
  if (!booking) return null;
  const plain = toPlain(booking);
  const dto = pickFields(plain, BOOKING_SUMMARY_FIELD_NAMES);
  dto.messaging_locked = isMessagingLocked(plain);
  dto.financial_review = serializeFinancialReview(plain);
  // Present when controllers attach open in-app dispute summary (null = none).
  dto.active_issue = plain.active_issue !== undefined ? plain.active_issue : null;
  return dto;
}

/**
 * Messaging-only booking summary — inbox / thread UI fields only.
 * Omits duration, price, court, and party ids (use booking detail for those).
 */
export function serializeBookingForMessaging(booking) {
  if (!booking) return null;
  const plain = toPlain(booking);
  const dto = pickFields(plain, BOOKING_MESSAGING_FIELD_NAMES);
  dto.messaging_locked = isMessagingLocked(plain);
  return dto;
}

/** Alias — dispute endpoints use the summary shape. */
export function serializeBookingForDisputes(booking) {
  return serializeBookingSummary(booking);
}

/**
 * Booking detail core — summary plus lifecycle fields participants need.
 */
export function serializeBookingDetailCore(booking) {
  if (!booking) return null;
  const plain = toPlain(booking);
  const dto = {
    ...serializeBookingSummary(plain),
    ...pickFields(plain, BOOKING_DETAIL_EXTRA_FIELD_NAMES),
    financial_review: serializeFinancialReview(plain),
  };
  return attachPendingAcceptanceFields(dto, plain);
}

/**
 * Booking list row with common nested associations (lesson, parties, court, conversation).
 * @param {{
 *   includeStudentReliability?: boolean,
 *   viewerIsPrivileged?: boolean,
 * }} [opts]
 *   `includeStudentReliability` is opt-in and unused by coach booking routes (MVP).
 *   `viewerIsPrivileged` — coach on booking or admin; sees exact private-court address.
 */
export function serializeBookingListItem(
  bookingRow,
  { includeStudentReliability = false, viewerIsPrivileged = false } = {},
) {
  if (!bookingRow) return null;
  const plain = toPlain(bookingRow);
  const {
    lesson,
    coach,
    primaryStudent,
    courtLocation,
    conversation,
    players: _legacyPlayers,
    ...bookingCore
  } = plain;

  const dto = serializeBookingSummary(bookingCore);
  attachPendingAcceptanceFields(dto, plain);
  if (lesson !== undefined) dto.lesson = serializeLessonSummary(lesson);
  if (coach !== undefined) dto.coach = serializeUserPartySummary(coach);
  if (primaryStudent !== undefined) {
    dto.primaryStudent = serializeUserPartySummary(primaryStudent, { includeStudentReliability });
  }
  if (courtLocation !== undefined) {
    dto.courtLocation = serializeCourtLocationSummary(courtLocation, {
      bookingStatus: dto.status ?? plain.status,
      viewerIsPrivileged,
    });
  }
  if (conversation !== undefined) dto.conversation = conversation;
  return dto;
}

/**
 * Full booking detail payload — core, nested resources, payments via injected serializer.
 * @param {{
 *   serializePayment?: Function,
 *   includeStudentReliability?: boolean,
 *   viewerIsPrivileged?: boolean,
 * }} [opts]
 */
export function serializeBookingDetailPayload(
  bookingJson,
  { serializePayment, includeStudentReliability = false, viewerIsPrivileged = false } = {},
) {
  if (!bookingJson) return null;
  const plain = toPlain(bookingJson);
  const {
    lesson,
    coach,
    primaryStudent,
    courtLocation,
    players: _legacyPlayers,
    payments,
    cancellationHistory,
    conversation,
    ...bookingCore
  } = plain;

  const dto = serializeBookingDetailCore(bookingCore);
  if (lesson !== undefined) dto.lesson = serializeLessonSummary(lesson);
  if (coach !== undefined) dto.coach = serializeUserPartySummary(coach);
  if (primaryStudent !== undefined) {
    dto.primaryStudent = serializeUserPartySummary(primaryStudent, { includeStudentReliability });
  }
  if (courtLocation !== undefined) {
    dto.courtLocation = serializeCourtLocationSummary(courtLocation, {
      bookingStatus: dto.status ?? plain.status,
      viewerIsPrivileged,
    });
  }
  if (conversation !== undefined) dto.conversation = conversation;

  // MVP: one student per booking (`primaryStudent`). Do not emit `players`
  // (booking_players is V2 scaffolding only).

  if (payments !== undefined) {
    dto.payments = Array.isArray(payments)
      ? payments.map((p) => (serializePayment ? serializePayment(p) : p))
      : payments;
  }

  if (cancellationHistory !== undefined) {
    dto.cancellationHistory = Array.isArray(cancellationHistory)
      ? cancellationHistory.map(serializeCancellationHistoryItem)
      : cancellationHistory;
  }

  return dto;
}

/**
 * List/detail/mutation helper — preserves endpoint-specific extra fields.
 * @param {{ includeStudentReliability?: boolean, viewerIsPrivileged?: boolean }} [options]
 */
export function serializeBookingResponse(bookingLike, extras = {}, options = {}) {
  const plain = toPlain(bookingLike);
  if (!plain) return extras;

  const reserved = new Set([
    'lesson',
    'coach',
    'primaryStudent',
    'courtLocation',
    'conversation',
    'payments',
    'cancellationHistory',
  ]);
  const extraKeys = Object.keys(extras);
  const nestedExtras = {};
  const scalarExtras = {};
  for (const key of extraKeys) {
    if (reserved.has(key)) nestedExtras[key] = extras[key];
    else scalarExtras[key] = extras[key];
  }

  const merged = { ...plain, ...nestedExtras };
  const hasListNesting =
    merged.lesson !== undefined ||
    merged.coach !== undefined ||
    merged.primaryStudent !== undefined ||
    merged.courtLocation !== undefined ||
    merged.conversation !== undefined;

  const base = hasListNesting
    ? serializeBookingListItem(merged, options)
    : serializeBookingDetailCore(merged);
  return { ...base, ...scalarExtras };
}
