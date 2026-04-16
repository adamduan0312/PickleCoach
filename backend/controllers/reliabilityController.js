import { Booking, Payment, RescheduleHistory, User, UserRole, UserReliability } from '../models/index.js';
import { Op } from 'sequelize';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../config/logger.js';

const DISPUTE_PENALTY_WEIGHTS = {
  late_arrival: 5,
  lesson_not_completed: 10,
  coach_no_show: 35,
  misconduct: 25,
};

const getDefaultCoachReliability = (userId) => ({
  user_id: userId,
  role: 'coach',
  total_bookings: 0,
  // Penalized reschedules only (affects_reliability = true) comes from reliabilityService.
  reschedules: 0,
  // Penalized paid reschedules only (paid + affects_reliability=true + captured).
  paid_reschedules: 0,
  late_cancels: 0,
  late_arrivals: 0,
  coach_no_show_disputes: 0,
  misconduct_disputes: 0,
  lesson_not_completed_disputes: 0,
  no_shows: 0,
  coach_cancels: 0,
  reliability_score: 100.00,
  badges: null,
  last_updated: null,
});

/**
 * Coach reliability payload (penalized-impact only).
 * - Returns full `UserReliability` row data
 * - Overrides `paid_reschedules` to mean penalized+captured paid reschedules only
 *   (so it can't be used to infer that paid/non-penalized reasons bypass penalties).
 */
const getCoachPenalizedReliabilityPayload = async (coachId) => {
  const reliability = await UserReliability.findOne({ where: { user_id: coachId, role: 'coach' } });
  const payload = reliability ? reliability.toJSON() : getDefaultCoachReliability(coachId);

  // Override `paid_reschedules` to mean:
  // - paid_reschedule = true
  // - affects_reliability = true (penalized)
  // - payment_status = captured (payment confirmed)
  const coachBookings = await Booking.findAll({
    where: { coach_id: coachId },
    attributes: ['id'],
  });
  const coachBookingIds = coachBookings.map((b) => b.id);

  const paidPenalizedCapturedReschedules = coachBookingIds.length
    ? await RescheduleHistory.count({
        where: {
          booking_id: { [Op.in]: coachBookingIds },
          requested_by: 'coach',
          paid_reschedule: true,
          affects_reliability: true,
        },
        include: [{
          model: Payment,
          as: 'transaction',
          where: { payment_status: { [Op.in]: ['captured', 'partially_refunded'] } },
          required: true,
          attributes: [],
        }],
      })
    : 0;

  payload.paid_reschedules = paidPenalizedCapturedReschedules;

  return payload;
};

/**
 * Student/admin: view a coach's reliability with penalized-impact metrics only.
 * Least-privilege: return only score/last_updated, not internal breakdown fields.
 */
export const getCoachReliabilityForStudent = async (req, res) => {
  try {
    const coachId = parseInt(req.params.id, 10);
    if (Number.isNaN(coachId)) {
      return errorResponse(res, 'Invalid coach ID', 400);
    }

    const coach = await User.findByPk(coachId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    if (!coach) {
      return errorResponse(res, 'Coach not found', 404);
    }

    const roles = coach.userRoles?.map((r) => r.role) ?? [];
    if (!roles.includes('coach')) {
      return errorResponse(res, 'User is not a coach', 400);
    }

    const payload = await getCoachPenalizedReliabilityPayload(coachId);
    return successResponse(res, {
      reliability: {
        user_id: payload.user_id,
        reliability_score: payload.reliability_score,
        last_updated: payload.last_updated,
      },
    }, 'Coach reliability retrieved successfully');
  } catch (error) {
    logger.error('Get coach reliability error:', error);
    return errorResponse(res, 'Failed to retrieve coach reliability', 500);
  }
};

/**
 * Coach self: view your own penalized-impact reliability breakdown + score.
 * This endpoint is the "coach UI" endpoint (more detail than student-facing).
 */
export const getCoachReliabilityForMe = async (req, res) => {
  try {
    const coachId = req.user.id;

    const coach = await User.findByPk(coachId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    if (!coach) {
      return errorResponse(res, 'Coach not found', 404);
    }

    const roles = coach.userRoles?.map((r) => r.role) ?? [];
    if (!roles.includes('coach')) {
      return errorResponse(res, 'User is not a coach', 400);
    }

    const payload = await getCoachPenalizedReliabilityPayload(coachId);
    return successResponse(res, { reliability: payload }, 'Coach reliability retrieved successfully');
  } catch (error) {
    logger.error('Get coach self reliability error:', error);
    return errorResponse(res, 'Failed to retrieve coach reliability', 500);
  }
};

/**
 * Admin-only: coach reliability as a single readable object (no duplicate / ambiguous keys).
 * Uses the raw `user_reliability` row for score + penalty snapshot fields; reschedule counts
 * come from `RescheduleHistory` (coach-requested) so totals stay consistent with history.
 */
export const getCoachReliabilityForAdmin = async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return errorResponse(res, 'Invalid user ID', 400);
    }

    const targetUser = await User.findByPk(userId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    if (!targetUser) {
      return errorResponse(res, 'User not found', 404);
    }

    const roles = targetUser.userRoles?.map((r) => r.role) ?? [];
    if (!roles.includes('coach')) {
      return errorResponse(res, 'Can only view reliability for coaches', 400);
    }

    const reliabilityRow = await UserReliability.findOne({ where: { user_id: userId, role: 'coach' } });
    const stored = reliabilityRow ? reliabilityRow.toJSON() : getDefaultCoachReliability(userId);

    const coachBookings = await Booking.findAll({
      where: { coach_id: userId },
      attributes: ['id'],
    });
    const coachBookingIds = coachBookings.map((b) => b.id);

    const roundMoney = (n) => Math.round(n * 100) / 100;

    const emptyRescheduleBlock = () => ({
      total: 0,
      penalized: 0,
      non_penalized: 0,
      paid: {
        count: 0,
        with_captured_payment: {
          total: 0,
          penalized: 0,
          non_penalized: 0,
          amounts: { penalized: 0, non_penalized: 0, total: 0 },
        },
      },
    });

    let reschedulesBlock = emptyRescheduleBlock();

    if (coachBookingIds.length > 0) {
      const totalCoachReschedules = await RescheduleHistory.count({
        where: {
          booking_id: { [Op.in]: coachBookingIds },
          requested_by: 'coach',
        },
      });

      const penalizedCoachReschedules = await RescheduleHistory.count({
        where: {
          booking_id: { [Op.in]: coachBookingIds },
          requested_by: 'coach',
          affects_reliability: true,
        },
      });

      const paidRescheduleCountAll = await RescheduleHistory.count({
        where: {
          booking_id: { [Op.in]: coachBookingIds },
          requested_by: 'coach',
          paid_reschedule: true,
        },
      });

      const nonPenalizedReschedules = await RescheduleHistory.count({
        where: {
          booking_id: { [Op.in]: coachBookingIds },
          requested_by: 'coach',
          affects_reliability: false,
        },
      });

      const paidRescheduleRecords = await RescheduleHistory.findAll({
        where: {
          booking_id: { [Op.in]: coachBookingIds },
          requested_by: 'coach',
          paid_reschedule: true,
        },
        include: [{
          model: Payment,
          as: 'transaction',
          attributes: ['total_charge_to_student'],
          where: { payment_status: { [Op.in]: ['captured', 'partially_refunded'] } },
          required: true,
        }],
        attributes: ['id', 'affects_reliability'],
      });

      let paidAmountPenalized = 0;
      let paidAmountNonPenalized = 0;
      let paidPenalizedCaptured = 0;
      let paidNonPenalizedCaptured = 0;

      for (const r of paidRescheduleRecords) {
        const amount = parseFloat(r?.transaction?.total_charge_to_student ?? 0);
        if (r.affects_reliability) {
          paidPenalizedCaptured += 1;
          paidAmountPenalized += amount;
        } else {
          paidNonPenalizedCaptured += 1;
          paidAmountNonPenalized += amount;
        }
      }

      const capturedTotal = paidRescheduleRecords.length;

      reschedulesBlock = {
        total: totalCoachReschedules,
        penalized: penalizedCoachReschedules,
        non_penalized: nonPenalizedReschedules,
        paid: {
          count: paidRescheduleCountAll,
          with_captured_payment: {
            total: capturedTotal,
            penalized: paidPenalizedCaptured,
            non_penalized: paidNonPenalizedCaptured,
            amounts: {
              penalized: roundMoney(paidAmountPenalized),
              non_penalized: roundMoney(paidAmountNonPenalized),
              total: roundMoney(paidAmountPenalized + paidAmountNonPenalized),
            },
          },
        },
      };
    }

    const payload = {
      user_id: userId,
      reliability_score: stored.reliability_score,
      last_updated: stored.last_updated,
      total_bookings: stored.total_bookings,
      reschedules: reschedulesBlock,
      penalties: {
        late_cancels: stored.late_cancels,
        late_arrivals: stored.late_arrivals || 0,
        coach_no_show_disputes: stored.coach_no_show_disputes || 0,
        misconduct_disputes: stored.misconduct_disputes || 0,
        lesson_not_completed_disputes: stored.lesson_not_completed_disputes || 0,
        no_shows: stored.no_shows,
        // Penalized coach cancellations outside the late window only
        // (not double-counted with late_cancels).
        coach_cancels_non_late: stored.coach_cancels,
        points: {
          late_arrival: ((stored.late_arrivals || 0) / Math.max(1, stored.total_bookings || 0)) * DISPUTE_PENALTY_WEIGHTS.late_arrival,
          coach_no_show: ((stored.coach_no_show_disputes || 0) / Math.max(1, stored.total_bookings || 0)) * DISPUTE_PENALTY_WEIGHTS.coach_no_show,
          misconduct: ((stored.misconduct_disputes || 0) / Math.max(1, stored.total_bookings || 0)) * DISPUTE_PENALTY_WEIGHTS.misconduct,
          lesson_not_completed: ((stored.lesson_not_completed_disputes || 0) / Math.max(1, stored.total_bookings || 0)) * DISPUTE_PENALTY_WEIGHTS.lesson_not_completed,
        },
      },
      badges: stored.badges,
    };

    return successResponse(res, { reliability: payload }, 'Coach reliability retrieved successfully');
  } catch (error) {
    logger.error('Admin get coach reliability error:', error);
    return errorResponse(res, 'Failed to retrieve coach reliability', 500);
  }
};

