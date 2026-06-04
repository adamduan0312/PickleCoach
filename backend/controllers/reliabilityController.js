import { Booking, Payment, RescheduleHistory, User, UserRole, UserReliability } from '../models/index.js';
import { Op } from 'sequelize';
import { successResponse, errorResponse } from '../utils/response.js';
import { serializeCoachReliabilityDetail } from '../utils/userDto.js';
import { logger } from '../config/logger.js';
import {
  attachLegacyReliabilityAliases,
  calculatePenaltyBreakdown,
  calculateReliabilityScoreFromPersistenceRow,
  defaultCanonicalReliabilityRow,
  persistenceRowToCanonical,
} from '../services/reliabilityEngine.js';
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';

/**
 * Coach reliability payload (penalized-impact metrics + score).
 * Internal helper: full `UserReliability` row JSON plus `attachLegacyReliabilityAliases`.
 * HTTP responses for **`GET /api/coaches/me/reliability`** use **`serializeCoachReliabilityDetail`** on this object.
 */
const getCoachPenalizedReliabilityPayload = async (coachId) => {
  const reliability = await UserReliability.findOne({ where: { user_id: coachId, role: 'coach' } });
  const base = reliability ? reliability.toJSON() : defaultCanonicalReliabilityRow(coachId, 'coach');
  return attachLegacyReliabilityAliases(base);
};

/**
 * Student self / admin: full student reliability row (same `paid_reschedules` persistence as coach).
 */
const getStudentPenalizedReliabilityPayload = async (studentId) => {
  const reliability = await UserReliability.findOne({ where: { user_id: studentId, role: 'student' } });
  const base = reliability ? reliability.toJSON() : defaultCanonicalReliabilityRow(studentId, 'student');
  return attachLegacyReliabilityAliases(base);
};

/**
 * Student: view your own penalized-impact reliability breakdown + score (mirror of coach `/me/reliability`).
 */
export const getStudentReliabilityForMe = async (req, res) => {
  try {
    const studentId = req.user.id;

    const roles = req.user.roles || [];
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

    const roles = getEffectiveRolesForUserRecord(coach);
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
 * Coach self: coach-facing reliability detail (curated counters + score; not a raw persistence row).
 * For session-level summary see GET /api/auth/profile; for admin audit see GET /api/admin/users/:id/reliability.
 */
export const getCoachReliabilityForMe = async (req, res) => {
  try {
    const coachId = req.user.id;

    const roles = req.user.roles || [];
    if (!roles.includes('coach')) {
      return errorResponse(res, 'User is not a coach', 400);
    }

    const payload = await getCoachPenalizedReliabilityPayload(coachId);
    return successResponse(
      res,
      { reliability: serializeCoachReliabilityDetail(payload) },
      'Coach reliability retrieved successfully',
    );
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

const round6 = (x) => Math.round(Number(x) * 1e6) / 1e6;

const penaltyTriplet = (stored, recentKey, decayedKey, totalKey) => ({
  recent: Number(stored[recentKey]) || 0,
  decayed: Number(stored[decayedKey]) || 0,
  total: Number(stored[totalKey]) || 0,
});

const buildAdminReliabilityPayload = (role, userId, stored, reschedulesBlock) => {
  const canonical = persistenceRowToCanonical(role, stored);
  const breakdown = calculatePenaltyBreakdown(role, canonical);
  const reconstructed = calculateReliabilityScoreFromPersistenceRow(role, stored);
  const persisted = Number(stored.reliability_score);

  const penalties = {
    penalized_reschedules: penaltyTriplet(
      stored,
      'penalized_reschedules_recent',
      'penalized_reschedules_decayed',
      'penalized_reschedules_total',
    ),
    late_cancels: penaltyTriplet(stored, 'late_cancels_recent', 'late_cancels_decayed', 'late_cancels_total'),
    late_arrival_penalties: penaltyTriplet(
      stored,
      'late_arrival_penalties_recent',
      'late_arrival_penalties_decayed',
      'late_arrival_penalties_total',
    ),
    misconduct_penalties: penaltyTriplet(
      stored,
      'misconduct_penalties_recent',
      'misconduct_penalties_decayed',
      'misconduct_penalties_total',
    ),
    lesson_not_completed_penalties: penaltyTriplet(
      stored,
      'lesson_not_completed_penalties_recent',
      'lesson_not_completed_penalties_decayed',
      'lesson_not_completed_penalties_total',
    ),
    no_shows: penaltyTriplet(stored, 'no_shows_recent', 'no_shows_decayed', 'no_shows_total'),
    coach_cancels_non_late: penaltyTriplet(
      stored,
      'coach_cancels_non_late_recent',
      'coach_cancels_non_late_decayed',
      'coach_cancels_non_late_total',
    ),
    student_cancels_non_late: penaltyTriplet(
      stored,
      'student_cancels_non_late_recent',
      'student_cancels_non_late_decayed',
      'student_cancels_non_late_total',
    ),
    points: Object.fromEntries(
      Object.entries(breakdown.deductions).map(([k, v]) => [k, round6(v)]),
    ),
    total_deduction_points: round6(breakdown.total_deduction),
  };

  return {
    role,
    user_id: userId,
    reliability_score: round6(persisted),
    last_updated: stored.last_updated,
    last_recomputed_at: stored.last_recomputed_at,
    total_bookings_recent: stored.total_bookings_recent,
    scoring: {
      denominator: round6(breakdown.denominator),
      booking_baseline_total: round6(Number(canonical.booking_baseline_total)),
      smoothing_k: round6(Number(stored.smoothing_k)),
      decay_lambda: round6(Number(stored.decay_lambda)),
      scoring_window_days: Number(stored.scoring_window_days) || 90,
      reconstructed_from_metrics: round6(reconstructed),
      score_source: stored.score_source || 'computed',
      score_matches_recomputed:
        (stored.score_source || 'computed') === 'computed' &&
        Math.abs((Number.isFinite(persisted) ? persisted : 0) - reconstructed) < 0.02,
    },
    reschedules: reschedulesBlock,
    penalties,
    badges: stored.badges,
    legacy_aliases: attachLegacyReliabilityAliases(stored),
  };
};

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

    const effectivePerms = getEffectiveRolesForUserRecord(targetUser);
    const q = req.query.role;
    let resolvedRole;
    if (q === 'coach' || q === 'student') {
      if (!effectivePerms.includes(q)) {
        return errorResponse(res, `User does not have ${q} role`, 400);
      }
      resolvedRole = q;
    } else if (q == null || q === '') {
      if (effectivePerms.includes('coach')) resolvedRole = 'coach';
      else if (effectivePerms.includes('student')) resolvedRole = 'student';
      else return errorResponse(res, 'User has no coach or student role', 400);
    } else {
      return errorResponse(res, 'Invalid role query (use coach or student)', 400);
    }

    if (resolvedRole === 'coach') {
      const reliabilityRow = await UserReliability.findOne({ where: { user_id: userId, role: 'coach' } });
      const stored = reliabilityRow ? reliabilityRow.toJSON() : defaultCanonicalReliabilityRow(userId, 'coach');

      const coachBookings = await Booking.findAll({
        where: { coach_id: userId },
        attributes: ['id'],
      });
      const coachBookingIds = coachBookings.map((b) => b.id);
      const reschedulesBlock = await buildAdminRescheduleBlock(coachBookingIds, 'coach');

      const payload = buildAdminReliabilityPayload('coach', userId, stored, reschedulesBlock);
      return successResponse(res, { reliability: payload }, 'Reliability retrieved successfully');
    }

    const reliabilityRow = await UserReliability.findOne({ where: { user_id: userId, role: 'student' } });
    const stored = reliabilityRow ? reliabilityRow.toJSON() : defaultCanonicalReliabilityRow(userId, 'student');

    const studentBookings = await Booking.findAll({
      where: { primary_student_id: userId },
      attributes: ['id'],
    });
    const studentBookingIds = studentBookings.map((b) => b.id);
    const reschedulesBlock = await buildAdminRescheduleBlock(studentBookingIds, 'student');

    const payload = buildAdminReliabilityPayload('student', userId, stored, reschedulesBlock);
    return successResponse(res, { reliability: payload }, 'Reliability retrieved successfully');
  } catch (error) {
    logger.error('Admin get user reliability error:', error);
    return errorResponse(res, 'Failed to retrieve reliability', 500);
  }
};

