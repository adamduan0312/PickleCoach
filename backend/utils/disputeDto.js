import * as paymentService from '../services/paymentService.js';
import { serializeBookingForDisputes } from './bookingDto.js';
import { serializePaymentSummary } from './paymentDto.js';

export { serializeBookingForDisputes } from './bookingDto.js';

export const DISPUTE_TYPE_SUMMARY_FIELD_NAMES = ['id', 'code', 'name', 'description'];

/** Participant-facing dispute core fields (no Stripe dispute / escalation internals). */
export const DISPUTE_PARTICIPANT_FIELD_NAMES = [
  'id',
  'booking_id',
  'dispute_type_id',
  'notes',
  'opened_by',
  'status',
  'resolution_action_id',
  'resolution_notes',
  'decision',
  'outcome',
  'penalize_role',
  'resolved_at',
  'opened_at',
];

/** Admin-only operational extras on dispute rows. */
export const DISPUTE_ADMIN_FIELD_NAMES = [
  'escalated',
  'escalated_to',
  'escalation_triggered_at',
  'stripe_dispute_id',
  'stripe_dispute_status',
];

/** Dispute type summary for list/detail — no escalation, severity, or audit columns. */
export function serializeDisputeTypeSummary(disputeType) {
  if (!disputeType) return null;
  const plain = disputeType?.toJSON ? disputeType.toJSON() : { ...disputeType };
  const dto = {};
  for (const key of DISPUTE_TYPE_SUMMARY_FIELD_NAMES) {
    if (plain[key] !== undefined) dto[key] = plain[key];
  }
  return dto;
}

export const RESOLUTION_ACTION_FIELD_NAMES = ['id', 'code', 'name', 'description'];

/** Resolution action summary when a dispute is resolved. */
export function serializeResolutionAction(resolutionAction) {
  if (!resolutionAction) return null;
  const plain = resolutionAction?.toJSON ? resolutionAction.toJSON() : { ...resolutionAction };
  const dto = {};
  for (const key of RESOLUTION_ACTION_FIELD_NAMES) {
    if (plain[key] !== undefined) dto[key] = plain[key];
  }
  return dto;
}

/** Admin who resolved the dispute — id and display name only. */
export function serializeResolvedByAdmin(admin) {
  if (!admin) return null;
  const plain = admin?.toJSON ? admin.toJSON() : { ...admin };
  if (plain.id === undefined && plain.full_name === undefined) return null;
  return {
    id: plain.id,
    full_name: plain.full_name,
  };
}

function pickFields(plain, fieldNames) {
  const dto = {};
  for (const key of fieldNames) {
    if (plain[key] !== undefined) dto[key] = plain[key];
  }
  return dto;
}

/**
 * Dispute JSON for dispute endpoints.
 * Nested associations are purpose-built DTOs; payment uses payment DTO (never raw Stripe).
 *
 * @param {object} dispute
 * @param {{ isAdmin?: boolean }} [opts] — admin callers may receive Stripe dispute / escalation fields
 *   and admin payment reconciliation fields when payment is embedded.
 */
export function formatDisputeResponse(dispute, { isAdmin = false } = {}) {
  if (!dispute) return dispute;
  const json = typeof dispute.toJSON === 'function' ? dispute.toJSON() : dispute;
  const {
    admin,
    admin_id,
    refund_cents,
    booking,
    disputeType,
    resolutionAction,
    payment,
  } = json;

  const dto = pickFields(json, DISPUTE_PARTICIPANT_FIELD_NAMES);
  if (isAdmin) {
    Object.assign(dto, pickFields(json, DISPUTE_ADMIN_FIELD_NAMES));
  }

  dto.refund_amount =
    refund_cents != null ? paymentService.centsToDecimalString(refund_cents) : null;
  dto.resolved_by_admin = serializeResolvedByAdmin(admin);

  if (booking !== undefined) {
    dto.booking = serializeBookingForDisputes(booking);
  }
  if (disputeType !== undefined) {
    dto.disputeType = serializeDisputeTypeSummary(disputeType);
  }
  if (resolutionAction !== undefined) {
    dto.resolutionAction = serializeResolutionAction(resolutionAction);
  }
  if (payment !== undefined) {
    dto.payment = serializePaymentSummary(payment, { isAdmin });
  }

  return dto;
}
