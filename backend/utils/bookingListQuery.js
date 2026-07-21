/**
 * Shared WHERE builders for role-specific and admin booking list endpoints.
 */
import { Op } from 'sequelize';
import { sequelize } from '../models/index.js';

/** Latest payment row for the booking is `authorized` (coach inbox pending filter). */
function latestAuthorizedPaymentExistsLiteral() {
  return sequelize.literal(`EXISTS (
      SELECT 1 FROM payments p
      WHERE p.booking_id = bookings.id
        AND p.payment_status = 'authorized'
        AND p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = bookings.id)
    )`);
}

/**
 * Coach dashboard inbox: only rows where the user is the coach.
 * Preserves pending/authorized payment visibility rules.
 */
export function buildCoachInboxBookingsWhere({ userId, status }) {
  const where = { coach_id: userId };
  if (status) where.status = status;

  const latestAuthorizedPaymentExists = latestAuthorizedPaymentExistsLiteral();

  if (status === 'pending') {
    where[Op.and] = [latestAuthorizedPaymentExists];
  } else if (!status) {
    where[Op.and] = [
      sequelize.literal(`(
          bookings.status != 'pending'
          OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = bookings.id)
          OR EXISTS (
            SELECT 1 FROM payments p
            WHERE p.booking_id = bookings.id
              AND p.payment_status = 'authorized'
              AND p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = bookings.id)
          )
        )`),
    ];
  }

  return where;
}

/** Student dashboard: only rows where the user is the primary student. */
export function buildStudentBookingsWhere({ userId, status }) {
  const where = { primary_student_id: userId };
  if (status) where.status = status;
  return where;
}

/** Admin list: optional status / coach / student filters; no self-scoping. */
export function buildAdminBookingsWhere({ status, coach_id, student_id }) {
  const where = {};
  if (status) where.status = status;
  if (coach_id) where.coach_id = coach_id;
  if (student_id) where.primary_student_id = student_id;
  return where;
}
