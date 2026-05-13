import { Booking, Payment, RescheduleHistory, User, UserRole, UserReliability } from '../models/index.js';
import { Op } from 'sequelize';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../config/logger.js';
import {
  BEHAVIOR_DISPUTE_PENALTY_WEIGHTS,
  COACH_ATTENDANCE_NO_SHOW_WEIGHT,
  STUDENT_ATTENDANCE_NO_SHOW_WEIGHT,
} from '../services/reliabilityScoring.js';

const getDefaultCoachReliability = (userId) => ({
  user_id: userId,
  role: 'coach',
  total_bookings: 0,
  // Penalized reschedules only (affects_reliability = true) comes from reliabilityService.
  reschedules: 0,
  // Penalized paid reschedules only (paid + affects_reliability=true + captured).
  paid_reschedules: 0,
  late_cancels: 0,
  late_arrival_penalties: 0,
  misconduct_penalties: 0,
  lesson_not_completed_penalties: 0,
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

const getDefaultStudentReliability = (userId) => ({
  user_id: userId,
  role: 'student',
  total_bookings: 0,
  reschedules: 0,
  paid_reschedules: 0,
  late_cancels: 0,
  late_arrival_penalties: 0,
  misconduct_penalties: 0,
  lesson_not_completed_penalties: 0,
  no_shows: 0,
  coach_cancels: 0,
  reliability_score: 100.0,
  badges: null,
  last_updated: null,
});

/**
 * Student self / admin: full student reliability row + paid penalized reschedule override (student-requested).
 */
const getStudentPenalizedReliabilityPayload = async (studentId) => {
  const reliability = await UserReliability.findOne({ where: { user_id: studentId, role: 'student' } });
  const payload = reliability ? reliability.toJSON() : getDefaultStudentReliability(studentId);

  const studentBookings = await Booking.findAll({
    where: { primary_student_id: studentId },
    attributes: ['id'],
  });
  const bookingIds = studentBookings.map((b) => b.id);

  const paidPenalizedCapturedReschedules = bookingIds.length
    ? await RescheduleHistory.count({
        where: {
          booking_id: { [Op.in]: bookingIds },
          requested_by: 'student',
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
 * Student: view your own penalized-impact reliability breakdown + score (mirror of coach `/me/reliability`).
 */
export const getStudentReliabilityForMe = async (req, res) => {
  try {
    const studentId = req.user.id;

    const user = await User.findByPk(studentId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const roles = user.userRoles?.map((r) => r.role) ?? [];
    if (!roles.includes('student')) {
      return errorResponse(res, 'User is not a student', 400);
    }

    const payload = await getStudentPenalizedReliabilityPayload(studentId);
    return successResponse(res, { reliability: payload }, 'Student reliability retrieved successfully');
  } catch (error) {
    logger.error('Get student self reliability error:', error);
    return errorResponse(res, 'Failed to retrieve student reliability', 500);
  }
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

/**
 * @param {number[]} bookingIds
 * @param {'coach'|'student'} requestedBy
 */
const buildAdminRescheduleBlock = async (bookingIds, requestedBy) => {
  if (bookingIds.length === 0) return emptyRescheduleBlock();

  const totalReschedules = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: bookingIds },
      requested_by: requestedBy,
    },
  });

  const penalized = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: bookingIds },
      requested_by: requestedBy,
      affects_reliability: true,
    },
  });

  const paidRescheduleCountAll = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: bookingIds },
      requested_by: requestedBy,
      paid_reschedule: true,
    },
  });

  const nonPenalized = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: bookingIds },
      requested_by: requestedBy,
      affects_reliability: false,
    },
  });

  const paidRescheduleRecords = await RescheduleHistory.findAll({
    where: {
      booking_id: { [Op.in]: bookingIds },
      requested_by: requestedBy,
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

  return {
    total: totalReschedules,
    penalized,
    non_penalized: nonPenalized,
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
};

const denomForPoints = (stored) => Math.max(1, stored.total_bookings || 0);

/**
 * Admin: full reliability read for coach or student row (`?role=coach`|`?role=student`).
 * Defaults to coach when the user coaches, else student when they only study.
 */
export const getUserReliabilityForAdmin = async (req, res) => {
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
    const q = req.query.role;
    let effectiveRole;
    if (q === 'coach' || q === 'student') {
      if (!roles.includes(q)) {
        return errorResponse(res, `User does not have ${q} role`, 400);
      }
      effectiveRole = q;
    } else if (q == null || q === '') {
      if (roles.includes('coach')) effectiveRole = 'coach';
      else if (roles.includes('student')) effectiveRole = 'student';
      else return errorResponse(res, 'User has no coach or student role', 400);
    } else {
      return errorResponse(res, 'Invalid role query (use coach or student)', 400);
    }

    if (effectiveRole === 'coach') {
      const reliabilityRow = await UserReliability.findOne({ where: { user_id: userId, role: 'coach' } });
      const stored = reliabilityRow ? reliabilityRow.toJSON() : getDefaultCoachReliability(userId);

      const coachBookings = await Booking.findAll({
        where: { coach_id: userId },
        attributes: ['id'],
      });
      const coachBookingIds = coachBookings.map((b) => b.id);
      const reschedulesBlock = await buildAdminRescheduleBlock(coachBookingIds, 'coach');

      const d = denomForPoints(stored);
      const payload = {
        role: 'coach',
        user_id: userId,
        reliability_score: stored.reliability_score,
        last_updated: stored.last_updated,
        total_bookings: stored.total_bookings,
        reschedules: reschedulesBlock,
        penalties: {
          late_cancels: stored.late_cancels,
          late_arrival_penalties: stored.late_arrival_penalties || 0,
          misconduct_penalties: stored.misconduct_penalties || 0,
          lesson_not_completed_penalties: stored.lesson_not_completed_penalties || 0,
          no_shows: stored.no_shows,
          coach_cancels_non_late: stored.coach_cancels,
          points: {
            late_arrival:
              ((stored.late_arrival_penalties || 0) / d) *
              BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.late_arrival,
            misconduct:
              ((stored.misconduct_penalties || 0) / d) *
              BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.misconduct,
            lesson_not_completed:
              ((stored.lesson_not_completed_penalties || 0) / d) *
              BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.lesson_not_completed,
            attendance_no_show:
              ((stored.no_shows || 0) / d) *
              COACH_ATTENDANCE_NO_SHOW_WEIGHT,
          },
        },
        badges: stored.badges,
      };

      return successResponse(res, { reliability: payload }, 'Reliability retrieved successfully');
    }

    const reliabilityRow = await UserReliability.findOne({ where: { user_id: userId, role: 'student' } });
    const stored = reliabilityRow ? reliabilityRow.toJSON() : getDefaultStudentReliability(userId);

    const studentBookings = await Booking.findAll({
      where: { primary_student_id: userId },
      attributes: ['id'],
    });
    const studentBookingIds = studentBookings.map((b) => b.id);
    const reschedulesBlock = await buildAdminRescheduleBlock(studentBookingIds, 'student');

    const d = denomForPoints(stored);
    const payload = {
      role: 'student',
      user_id: userId,
      reliability_score: stored.reliability_score,
      last_updated: stored.last_updated,
      total_bookings: stored.total_bookings,
      reschedules: reschedulesBlock,
      penalties: {
        late_cancels: stored.late_cancels,
        late_arrival_penalties: stored.late_arrival_penalties || 0,
        misconduct_penalties: stored.misconduct_penalties || 0,
        lesson_not_completed_penalties: stored.lesson_not_completed_penalties || 0,
        no_shows: stored.no_shows,
        /** Non-late student cancels: stored in `user_reliability.coach_cancels` for role=student rows. */
        student_cancels_non_late: stored.coach_cancels,
        points: {
          late_arrival:
            ((stored.late_arrival_penalties || 0) / d) *
            BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.late_arrival,
          misconduct:
            ((stored.misconduct_penalties || 0) / d) *
            BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.misconduct,
          lesson_not_completed:
            ((stored.lesson_not_completed_penalties || 0) / d) *
            BEHAVIOR_DISPUTE_PENALTY_WEIGHTS.lesson_not_completed,
          attendance_no_show:
            ((stored.no_shows || 0) / d) *
            STUDENT_ATTENDANCE_NO_SHOW_WEIGHT,
          student_cancels_non_late:
            ((stored.coach_cancels || 0) / d) * 12,
        },
      },
      badges: stored.badges,
    };

    return successResponse(res, { reliability: payload }, 'Reliability retrieved successfully');
  } catch (error) {
    logger.error('Admin get user reliability error:', error);
    return errorResponse(res, 'Failed to retrieve reliability', 500);
  }
};

