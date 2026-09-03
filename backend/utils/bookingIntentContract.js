/**
 * Authorize-first booking flow: PaymentIntent before any booking row exists.
 *
 * MVP marketplace package:
 * - One coach + one student (JWT → primary_student_id); no `player_ids`
 * - Lesson owns `price` and `duration_minutes` (students do not override duration)
 * - `court_location_id` required — one of the coach's linked courts
 */
export const BOOKING_INTENT_FLOW_METADATA = 'authorize_then_book';

export const SLOT_NO_LONGER_AVAILABLE_CODE = 'slot_no_longer_available';

/** Student already has a pending/confirmed lesson overlapping this time (any coach). */
export const STUDENT_SCHEDULE_CONFLICT_CODE = 'student_schedule_conflict';

/**
 * @param {import('stripe').Stripe.PaymentIntent} paymentIntent
 */
export function isPaymentIntentAuthorizedForBookingConfirm(paymentIntent) {
  if (!paymentIntent?.id) return false;
  if (paymentIntent.status !== 'requires_capture') return false;
  return Number(paymentIntent.amount_capturable ?? 0) > 0;
}

/**
 * @param {Record<string, string> | null | undefined} metadata
 */
export function isAuthorizeThenBookIntent(metadata) {
  return metadata?.flow === BOOKING_INTENT_FLOW_METADATA;
}

/**
 * @param {Record<string, string> | null | undefined} metadata
 * @param {number} studentId
 */
export function parseBookingIntentMetadata(metadata, studentId) {
  if (!isAuthorizeThenBookIntent(metadata)) {
    return { ok: false, code: 'payment_intent_invalid_flow', message: 'PaymentIntent is not a booking authorization.' };
  }
  const metaStudentId = Number.parseInt(String(metadata.student_id ?? ''), 10);
  if (!Number.isFinite(metaStudentId) || metaStudentId !== studentId) {
    return { ok: false, code: 'payment_intent_not_owned', message: 'PaymentIntent does not belong to this student.' };
  }
  const lessonId = Number.parseInt(String(metadata.lesson_id ?? ''), 10);
  if (!Number.isFinite(lessonId) || lessonId < 1) {
    return { ok: false, code: 'payment_intent_invalid_metadata', message: 'PaymentIntent is missing lesson_id.' };
  }
  const scheduledAtRaw = metadata.scheduled_at;
  if (!scheduledAtRaw) {
    return { ok: false, code: 'payment_intent_invalid_metadata', message: 'PaymentIntent is missing scheduled_at.' };
  }
  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, code: 'payment_intent_invalid_metadata', message: 'PaymentIntent scheduled_at is invalid.' };
  }
  const durationMinutes = metadata.duration_minutes
    ? Number.parseInt(String(metadata.duration_minutes), 10)
    : null;
  const courtLocationId = metadata.court_location_id
    ? Number.parseInt(String(metadata.court_location_id), 10)
    : null;
  if (!Number.isFinite(courtLocationId) || courtLocationId < 1) {
    return {
      ok: false,
      code: 'payment_intent_invalid_metadata',
      message: 'PaymentIntent is missing court_location_id.',
    };
  }
  return {
    ok: true,
    lessonId,
    scheduledAt,
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
    courtLocationId,
    idempotencyKey: metadata.idempotency_key || null,
    paymentMethod: metadata.payment_method || 'stripe',
  };
}

/**
 * Build Stripe metadata for a booking intent (all values must be strings).
 * `durationMinutes` must be the lesson package duration; `courtLocationId` required.
 */
export function buildBookingIntentStripeMetadata({
  studentId,
  lessonId,
  coachId,
  scheduledAt,
  durationMinutes,
  courtLocationId,
  idempotencyKey,
  paymentMethod,
}) {
  return {
    flow: BOOKING_INTENT_FLOW_METADATA,
    student_id: String(studentId),
    lesson_id: String(lessonId),
    coach_id: String(coachId),
    scheduled_at: scheduledAt instanceof Date ? scheduledAt.toISOString() : String(scheduledAt),
    duration_minutes: String(durationMinutes),
    court_location_id: String(courtLocationId),
    payment_method: paymentMethod || 'stripe',
    idempotency_key: idempotencyKey,
  };
}
