import bcrypt from 'bcryptjs';
import { User, UserRole, Booking, Payment, Dispute, UserReliability, CoachCourtLocation, CourtLocation, CoachAvailability, AuditLog } from '../models/index.js';
import { SCORE_FORMULA_VERSION } from '../services/reliabilityConstants.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { getDbRoleAssignments, getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';

export const getDashboardStats = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const totalStudents = await UserRole.count({ where: { role: 'student' } });
    const totalCoaches = await UserRole.count({ where: { role: 'coach' } });
    const totalBookings = await Booking.count();
    const activeBookings = await Booking.count({ where: { status: { [Op.in]: ['pending', 'confirmed'] } } });
    
    const revenueStatuses = { [Op.in]: ['captured', 'partially_refunded', 'refunded'] };
    const totalCaptured = await Payment.sum('total_charge_to_student', {
      where: { payment_status: revenueStatuses },
    }) || 0;
    const totalRefunded = await Payment.sum('refunded_amount', {
      where: { payment_status: revenueStatuses },
    }) || 0;
    const totalRevenue = Number(totalCaptured) - Number(totalRefunded);

    const totalCommissions = await Payment.sum('platform_fee_amount', {
      where: { payment_status: revenueStatuses },
    }) || 0;

    const pendingDisputes = await Dispute.count({ where: { status: { [Op.in]: ['open', 'under_review'] } } });

    return successResponse(res, {
      users: {
        total_students: totalStudents,
        total_coaches: totalCoaches,
      },
      bookings: {
        total: totalBookings,
        active: activeBookings,
      },
      revenue: {
        total: parseFloat(totalRevenue),
        commissions: parseFloat(totalCommissions),
      },
      disputes: {
        pending: pendingDisputes,
      },
    }, 'Dashboard stats retrieved successfully');
  } catch (error) {
    logger.error('Get dashboard stats error:', error);
    return errorResponse(res, 'Failed to retrieve dashboard stats', 500);
  }
};

/**
 * Create an admin account
 * Only existing admins can create new admin accounts
 * Note: The first admin account must be created manually via database
 */
export const createAdmin = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized: Only admins can create admin accounts', 403);
    }

    const { full_name, email, password, phone, timezone } = req.body;

    if (!full_name || !email || !password) {
      return errorResponse(res, 'full_name, email, and password are required', 400);
    }

    // Check if email already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return errorResponse(res, 'Email already registered', 409);
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    const adminUser = await User.create({
      full_name,
      email,
      password_hash,
      phone,
      timezone: timezone || 'UTC',
      is_active: true,
    });

    await UserRole.create({ user_id: adminUser.id, role: 'admin' });

    await logAudit(req.user.id, 'admin_created', 'users', adminUser.id, null, { email: adminUser.email, role: 'admin' }, req);

    return successResponse(res, {
      id: adminUser.id,
      full_name: adminUser.full_name,
      email: adminUser.email,
      roles: ['admin'],
      created_at: adminUser.created_at,
    }, 'Admin account created successfully', 201);
  } catch (error) {
    logger.error('Create admin error:', error);
    return errorResponse(res, 'Failed to create admin account', 500);
  }
};

/**
 * Manually adjust a user's reliability score (separate from dispute resolution).
 * Sets `score_source` to **admin_override**; the next `updateUserReliability` run resets it to **computed**
 * and realigns counters with the recomputed score.
 *
 * Reliability is stored per role (`user_reliability`: one row per user_id + role).
 * Request body `role` defaults to **coach** — send `"role": "student"` to adjust the student row.
 * Users with both coach and student roles: call once per row you want to change (same path, different `role`).
 */
export const adjustUserReliability = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized: Only admins can adjust reliability scores', 403);
    }

    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return errorResponse(res, 'Invalid user ID', 400);
    }

    const { new_score, role: reliabilityRole, reason, explanation } = req.validated;
    const scoreValue = parseFloat(new_score);

    const targetUser = await User.findByPk(userId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    if (!targetUser) {
      return errorResponse(res, 'User not found', 404);
    }

    const dbAssignments = getDbRoleAssignments(targetUser);
    const effectivePerms = getEffectiveRolesForUserRecord(targetUser);
    if (effectivePerms.includes('admin')) {
      return errorResponse(res, 'Cannot adjust reliability for admin users', 400);
    }

    if (reliabilityRole === 'coach' && !effectivePerms.includes('coach')) {
      const hint =
        effectivePerms.includes('student')
          ? ' Omitting role defaults to coach; send "role": "student" to adjust student reliability.'
          : '';
      return errorResponse(res, `Target user does not have coach role.${hint}`, 400);
    }
    if (reliabilityRole === 'student' && !effectivePerms.includes('student')) {
      const hint =
        effectivePerms.includes('coach')
          ? ' Send "role": "coach" (or omit role) to adjust coach reliability.'
          : '';
      return errorResponse(res, `Target user does not have student role.${hint}`, 400);
    }

    const [reliability, created] = await UserReliability.findOrCreate({
      where: { user_id: userId, role: reliabilityRole },
      defaults: {
        user_id: userId,
        role: reliabilityRole,
        reliability_score: 100.0,
        score_version: SCORE_FORMULA_VERSION,
      },
    });

    const beforeState = reliability.toJSON();
    await reliability.update({
      reliability_score: scoreValue,
      score_source: 'admin_override',
    });

    // Log this as a manual admin adjustment with full audit trail
    await logAudit(req.user.id, 'admin_reliability_adjustment', 'user_reliability', reliability.user_id, {
      before_score: beforeState.reliability_score,
      role: reliabilityRole,
      reason,
      explanation,
    }, {
      after_score: scoreValue,
      adjusted_by_admin: req.user.id,
      role: reliabilityRole,
      reason,
      explanation,
    }, req);

    return successResponse(res, {
      user_id: userId,
      role: reliabilityRole,
      user_roles: dbAssignments,
      effective_roles: effectivePerms,
      previous_score: beforeState.reliability_score,
      new_score: scoreValue,
      adjusted_by: req.user.id,
      reason,
      explanation,
    }, 'Reliability score adjusted successfully');
  } catch (error) {
    logger.error('Adjust reliability error:', error);
    return errorResponse(res, 'Failed to adjust reliability score', 500);
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    let { page, limit, user_id, action, table_name, record_id } = req.validated;
    // Only use "show all" (10000) when client sent no page and no limit in the URL
    const hasPage = Object.prototype.hasOwnProperty.call(req.query, 'page');
    const hasLimit = Object.prototype.hasOwnProperty.call(req.query, 'limit');
    if (!hasPage && !hasLimit) {
      limit = 10000;
    } else if (hasPage && !hasLimit) {
      limit = 10;
    }
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = {};
    if (user_id != null) where.user_id = Number(user_id);
    if (action != null && action !== '') where.action = action;
    if (table_name != null && table_name !== '') where.table_name = table_name;
    if (record_id != null) where.record_id = Number(record_id);

    const logs = await AuditLog.findAndCountAll({
      where,
      limit: queryLimit,
      offset,
      order: [['created_at', 'DESC']],
    });

    const response = getPagingData(logs, page, queryLimit);
    return paginatedResponse(res, response.items, response.pagination, 'Audit logs retrieved successfully');
  } catch (error) {
    logger.error('Get audit logs error:', error);
    return errorResponse(res, 'Failed to retrieve audit logs', 500);
  }
};

/**
 * Stable admin JSON for GET /api/admin/coaches/:coachId/courts (no raw Sequelize / no ORM drift).
 */
function mapCoachCourtLinkForAdmin(link) {
  const court = link.court;
  if (!court) {
    throw new Error('CoachCourtLocation row missing court include');
  }
  const lat = court.latitude != null ? Number(court.latitude) : null;
  const lng = court.longitude != null ? Number(court.longitude) : null;
  const createdBy = court.createdBy;
  return {
    id: link.id,
    coach_id: link.coach_id,
    court_id: link.court_id,
    coach_notes: link.coach_notes != null ? link.coach_notes : null,
    created_at: link.created_at != null ? new Date(link.created_at).toISOString() : null,
    updated_at: link.updated_at != null ? new Date(link.updated_at).toISOString() : null,
    court: {
      id: court.id,
      name: court.name,
      address: court.address != null ? court.address : null,
      latitude: lat,
      longitude: lng,
      is_private: Boolean(court.is_private),
      created_by: createdBy
        ? {
            id: createdBy.id,
            full_name: createdBy.full_name != null ? createdBy.full_name : null,
          }
        : null,
    },
  };
}

/**
 * GET /api/admin/coaches/:coachId/courts
 * Admin only: list courts linked to a coach (for support/moderation).
 */
export const getCoachCourtsForAdmin = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }
    const coachId = parseInt(req.params.coachId, 10);
    if (Number.isNaN(coachId)) {
      return errorResponse(res, 'Invalid coach ID', 400);
    }
    const coach = await User.findByPk(coachId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    const coachRoles = getEffectiveRolesForUserRecord(coach);
    if (!coach || !coachRoles.includes('coach')) {
      return errorResponse(res, 'Coach not found', 404);
    }
    const coachCourts = await CoachCourtLocation.findAll({
      where: { coach_id: coachId },
      include: [
        {
          model: CourtLocation,
          as: 'court',
          where: { deleted_at: null },
          required: true,
          include: [{ model: User, as: 'createdBy', attributes: ['id', 'full_name'] }],
        },
      ],
      order: [['created_at', 'ASC']],
    });
    const result = coachCourts.map((link) => mapCoachCourtLinkForAdmin(link));
    return successResponse(res, result, 'Coach courts retrieved successfully');
  } catch (error) {
    logger.error('Admin get coach courts error:', error);
    return errorResponse(res, 'Failed to retrieve coach courts', 500);
  }
};

/**
 * DELETE /api/admin/coaches/:coachId/courts/:courtId
 * Admin only: unlink a court from a coach (e.g. wrong court linked).
 * `courtId` is the court_locations.id (same as `court_id` on the link row from GET .../courts).
 * Success `data`: `coach_id`, `court_id`, and court `name` (null if the court row is missing).
 */
export const deleteCoachCourtForAdmin = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }
    const coachId = parseInt(req.params.coachId, 10);
    const courtId = parseInt(req.params.courtId, 10);
    if (Number.isNaN(coachId) || Number.isNaN(courtId)) {
      return errorResponse(res, 'Invalid coach ID or court ID', 400);
    }
    const link = await CoachCourtLocation.findOne({
      where: { court_id: courtId, coach_id: coachId },
    });
    if (!link) {
      return errorResponse(
        res,
        'This coach is not linked to that court (check court id from GET /api/admin/coaches/:coachId/courts)',
        404,
      );
    }
    await link.destroy();
    const court = await CourtLocation.findOne({
      where: { id: courtId, deleted_at: null },
      attributes: ['id', 'name'],
    });
    return successResponse(res, {
      coach_id: coachId,
      court_id: courtId,
      name: court?.name ?? null,
    }, 'Court removed from coach');
  } catch (error) {
    logger.error('Admin delete coach court error:', error);
    return errorResponse(res, 'Failed to remove court from coach', 500);
  }
};

/**
 * DELETE /api/admin/coaches/:coachId/availability/:id
 * Admin only: delete a coach's availability slot (e.g. wrong times).
 */
export const deleteCoachAvailabilityForAdmin = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }
    const coachId = parseInt(req.params.coachId, 10);
    const availabilityId = parseInt(req.params.id, 10);
    if (Number.isNaN(coachId) || Number.isNaN(availabilityId)) {
      return errorResponse(res, 'Invalid coach ID or availability ID', 400);
    }
    const availability = await CoachAvailability.findByPk(availabilityId);
    if (!availability) {
      return errorResponse(res, 'Availability not found', 404);
    }
    if (availability.coach_id !== coachId) {
      return errorResponse(res, 'Availability does not belong to this coach', 403);
    }
    await availability.destroy();
    return successResponse(res, null, 'Availability deleted successfully');
  } catch (error) {
    logger.error('Admin delete coach availability error:', error);
    return errorResponse(res, 'Failed to delete availability', 500);
  }
};
