import { User, UserRole, UserReliability } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { serializeCoachReliabilityDetail, serializeStudentReliabilityDetail } from '../utils/userDto.js';
import { logger } from '../config/logger.js';
import {
  attachLegacyReliabilityAliases,
  calculatePenaltyBreakdown,
  calculateReliabilityScoreFromPersistenceRow,
  defaultCanonicalReliabilityRow,
  persistenceRowToCanonical,
} from '../services/reliabilityEngine.js';
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';
import { COACH_LATE_STUDENT_CANCEL_HELP_TEXT } from '../utils/lateCancelPayout.js';
import { isPubliclyActiveUser } from '../utils/userLifecycle.js';

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
 * Student self / admin: full student reliability row.
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
    return successResponse(
      res,
      { reliability: serializeStudentReliabilityDetail(payload) },
      'Student reliability retrieved successfully',
    );
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

    if (!isPubliclyActiveUser(coach)) {
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
      {
        reliability: serializeCoachReliabilityDetail(payload),
        policy_notes: {
          late_student_cancel: COACH_LATE_STUDENT_CANCEL_HELP_TEXT,
        },
      },
      'Coach reliability retrieved successfully',
    );
  } catch (error) {
    logger.error('Get coach self reliability error:', error);
    return errorResponse(res, 'Failed to retrieve coach reliability', 500);
  }
};

const round6 = (x) => Math.round(Number(x) * 1e6) / 1e6;

const penaltyTriplet = (stored, recentKey, decayedKey, totalKey) => ({
  recent: Number(stored[recentKey]) || 0,
  decayed: Number(stored[decayedKey]) || 0,
  total: Number(stored[totalKey]) || 0,
});

const buildAdminReliabilityPayload = (role, userId, stored) => {
  const canonical = persistenceRowToCanonical(role, stored);
  const breakdown = calculatePenaltyBreakdown(role, canonical);
  const reconstructed = calculateReliabilityScoreFromPersistenceRow(role, stored);
  const persisted = Number(stored.reliability_score);

  const penalties = {
    late_cancels: penaltyTriplet(stored, 'late_cancels_recent', 'late_cancels_decayed', 'late_cancels_total'),
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

    const reliabilityRow = await UserReliability.findOne({ where: { user_id: userId, role: resolvedRole } });
    const stored = reliabilityRow
      ? reliabilityRow.toJSON()
      : defaultCanonicalReliabilityRow(userId, resolvedRole);

    const payload = buildAdminReliabilityPayload(resolvedRole, userId, stored);
    return successResponse(res, { reliability: payload }, 'Reliability retrieved successfully');
  } catch (error) {
    logger.error('Admin get user reliability error:', error);
    return errorResponse(res, 'Failed to retrieve reliability', 500);
  }
};

