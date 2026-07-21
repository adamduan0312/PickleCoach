import * as paymentService from '../services/paymentService.js';
import { serializeBookingForDisputes } from './bookingDto.js';

export { serializeBookingForDisputes } from './bookingDto.js';

export const DISPUTE_TYPE_SUMMARY_FIELD_NAMES = ['id', 'code', 'name', 'description'];

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

/**
 * Public dispute JSON for all dispute endpoints.
 * Nested associations are purpose-built DTOs; resolver is `resolved_by_admin` only.
 */
export function formatDisputeResponse(dispute) {
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
    ...core
  } = json;

  return {
    ...core,
    refund_amount:
      refund_cents != null ? paymentService.centsToDecimalString(refund_cents) : null,
    resolved_by_admin: serializeResolvedByAdmin(admin),
    ...(booking !== undefined && { booking: serializeBookingForDisputes(booking) }),
    ...(disputeType !== undefined && { disputeType: serializeDisputeTypeSummary(disputeType) }),
    ...(resolutionAction !== undefined && {
      resolutionAction: serializeResolutionAction(resolutionAction),
    }),
    ...(payment !== undefined && { payment }),
  };
}
