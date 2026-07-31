import { serializeBookingSummary } from './bookingDto.js';

/** Business-facing payment fields for participant-facing endpoints.
 *  `platform_fee_*` is the platform's internal commission from the lesson (not an add-on to the student charge).
 *  `total_charge_to_student` equals the listed lesson price.
 */
export const PAYMENT_SUMMARY_FIELD_NAMES = [
  'id',
  'booking_id',
  'coach_id',
  'student_id',
  'lesson_price',
  'platform_fee_percent',
  'platform_fee_amount',
  'total_charge_to_student',
  'coach_payout_expected',
  'escrow_status',
  'payment_status',
  'payment_method',
  'currency',
  'refunded_amount',
  'refund_status',
  'created_at',
  'updated_at',
];

/** Stripe / reconciliation fields — admin endpoints only. */
export const PAYMENT_ADMIN_FIELD_NAMES = [
  'payment_intent_id',
  'charge_id',
  'transfer_id',
  'payout_id',
  'stripe_refund_id',
  'stripe_dispute_id',
  'stripe_dispute_status',
  'dispute_id',
  'metadata',
];

const USER_PARTY_LIST_FIELDS = ['id', 'full_name'];
const USER_PARTY_DETAIL_FIELDS = ['id', 'full_name', 'email'];

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

export function serializePaymentParty(user, { includeEmail = false } = {}) {
  if (!user) return null;
  const fields = includeEmail ? USER_PARTY_DETAIL_FIELDS : USER_PARTY_LIST_FIELDS;
  return pickFields(toPlain(user), fields);
}

/**
 * Participant-safe payment DTO. Admins may request full Stripe/reconciliation fields.
 */
export function serializePaymentSummary(payment, { isAdmin = false } = {}) {
  if (!payment) return null;
  const plain = toPlain(payment);
  const dto = pickFields(plain, PAYMENT_SUMMARY_FIELD_NAMES);
  if (isAdmin) {
    Object.assign(dto, pickFields(plain, PAYMENT_ADMIN_FIELD_NAMES));
  }
  return dto;
}

/** Payment list/detail row with nested booking and parties. */
export function serializePaymentListItem(paymentRow, { isAdmin = false } = {}) {
  if (!paymentRow) return null;
  const plain = toPlain(paymentRow);
  const { booking, coach, student, ...paymentCore } = plain;

  const dto = serializePaymentSummary(paymentCore, { isAdmin });
  if (booking !== undefined) dto.booking = serializeBookingSummary(booking);
  if (coach !== undefined) dto.coach = serializePaymentParty(coach, { includeEmail: isAdmin });
  if (student !== undefined) dto.student = serializePaymentParty(student, { includeEmail: isAdmin });
  return dto;
}
