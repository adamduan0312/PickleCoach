/**
 * Attach open in-app dispute summary to booking DTOs for UI ("Issue reported").
 * Does not change bookings.status — that remains awaiting_verification / completed / etc.
 * Stripe chargebacks still use bookings.status = disputed separately.
 */
import { Op } from 'sequelize';
import { Dispute, DisputeType, DisputeResolutionAction } from '../models/index.js';
import { ACTIVE_DISPUTE_STATUSES } from '../services/disputeStateMachine.js';
import { centsToDecimalString } from '../services/paymentService.js';
import { financialActionFromResolutionActionCode } from './disputeDto.js';

/**
 * @param {Iterable<number|string>} bookingIds
 * @returns {Promise<Map<number, { id: number, status: string, opened_by: string, opened_at?: string|Date }>>}
 */
export async function loadActiveIssuesByBookingId(bookingIds) {
  const ids = [...new Set(
    [...bookingIds]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  )];
  const map = new Map();
  if (ids.length === 0) return map;

  const rows = await Dispute.findAll({
    where: {
      booking_id: { [Op.in]: ids },
      status: { [Op.in]: [...ACTIVE_DISPUTE_STATUSES] },
    },
    attributes: ['id', 'booking_id', 'status', 'opened_by', 'opened_at'],
    order: [['id', 'DESC']],
  });

  for (const row of rows) {
    const bookingId = Number(row.booking_id);
    if (map.has(bookingId)) continue;
    map.set(bookingId, {
      id: row.id,
      status: row.status,
      opened_by: row.opened_by,
      opened_at: row.opened_at,
    });
  }
  return map;
}

/**
 * Latest resolved in-app issue per booking — for booking detail “View issue resolution”.
 * Customer-safe structured summary (decision / financial_action / outcome / penalize_role).
 *
 * @param {Iterable<number|string>} bookingIds
 * @returns {Promise<Map<number, object>>}
 */
export async function loadResolvedIssuesByBookingId(bookingIds) {
  const ids = [...new Set(
    [...bookingIds]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  )];
  const map = new Map();
  if (ids.length === 0) return map;

  const rows = await Dispute.findAll({
    where: {
      booking_id: { [Op.in]: ids },
      status: 'resolved',
    },
    attributes: [
      'id',
      'booking_id',
      'status',
      'opened_by',
      'opened_at',
      'resolved_at',
      'decision',
      'outcome',
      'penalize_role',
      'refund_cents',
      'resolution_notes',
    ],
    include: [
      {
        model: DisputeType,
        as: 'disputeType',
        attributes: ['id', 'code', 'name'],
        required: false,
      },
      {
        model: DisputeResolutionAction,
        as: 'resolutionAction',
        attributes: ['id', 'code'],
        required: false,
      },
    ],
    order: [['resolved_at', 'DESC'], ['id', 'DESC']],
  });

  for (const row of rows) {
    const bookingId = Number(row.booking_id);
    if (map.has(bookingId)) continue;
    const type = row.disputeType;
    const actionCode = row.resolutionAction?.code ?? null;
    map.set(bookingId, {
      id: row.id,
      status: row.status,
      opened_by: row.opened_by,
      opened_at: row.opened_at,
      resolved_at: row.resolved_at,
      decision: row.decision ?? null,
      outcome: row.outcome ?? null,
      penalize_role: row.penalize_role ?? 'none',
      financial_action: financialActionFromResolutionActionCode(actionCode),
      refund_amount: row.refund_cents != null ? centsToDecimalString(row.refund_cents) : null,
      dispute_type_code: type?.code ?? null,
      dispute_type_name: type?.name ?? null,
      // Notes are for the issue detail page; booking panel does not headline them.
      resolution_notes: row.resolution_notes ?? null,
    });
  }
  return map;
}

/**
 * @template {{ id?: number }} T
 * @param {T} dto
 * @param {Map<number, { id: number, status: string, opened_by: string }>} map
 * @returns {T}
 */
export function attachActiveIssue(dto, map) {
  if (!dto || dto.id == null) return dto;
  dto.active_issue = map.get(Number(dto.id)) ?? null;
  return dto;
}

/**
 * @template {{ id?: number }} T
 * @param {T} dto
 * @param {Map<number, object>} map
 * @returns {T}
 */
export function attachResolvedIssue(dto, map) {
  if (!dto || dto.id == null) return dto;
  dto.resolved_issue = map.get(Number(dto.id)) ?? null;
  return dto;
}

/**
 * @template {{ id?: number }} T
 * @param {T[]} dtos
 * @returns {Promise<T[]>}
 */
export async function attachActiveIssuesToBookingDtos(dtos) {
  const list = Array.isArray(dtos) ? dtos : [];
  const map = await loadActiveIssuesByBookingId(list.map((d) => d?.id));
  for (const dto of list) attachActiveIssue(dto, map);
  return list;
}
