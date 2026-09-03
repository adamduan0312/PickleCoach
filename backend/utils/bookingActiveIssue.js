/**
 * Attach open in-app dispute summary to booking DTOs for UI ("Issue reported").
 * Does not change bookings.status — that remains awaiting_verification / completed / etc.
 * Stripe chargebacks still use bookings.status = disputed separately.
 */
import { Op } from 'sequelize';
import { Dispute } from '../models/index.js';
import { ACTIVE_DISPUTE_STATUSES } from '../services/disputeStateMachine.js';

/**
 * @param {Iterable<number|string>} bookingIds
 * @returns {Promise<Map<number, { id: number, status: string, opened_by: string }>>}
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
    attributes: ['id', 'booking_id', 'status', 'opened_by'],
    order: [['id', 'DESC']],
  });

  for (const row of rows) {
    const bookingId = Number(row.booking_id);
    if (map.has(bookingId)) continue;
    map.set(bookingId, {
      id: row.id,
      status: row.status,
      opened_by: row.opened_by,
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
 * @param {T[]} dtos
 * @returns {Promise<T[]>}
 */
export async function attachActiveIssuesToBookingDtos(dtos) {
  const list = Array.isArray(dtos) ? dtos : [];
  const map = await loadActiveIssuesByBookingId(list.map((d) => d?.id));
  for (const dto of list) attachActiveIssue(dto, map);
  return list;
}
