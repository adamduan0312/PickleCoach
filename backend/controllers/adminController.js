import bcrypt from 'bcryptjs';
import { AdminAnalytics, AdminAlert, User, UserRole, Booking, Payment, Dispute, UserReliability, CoachCourtLocation, CourtLocation, CoachAvailability, AuditLog } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { getPagination, getPagingData } from '../utils/pagination.js';

export const getDashboardStats = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const totalStudents = await UserRole.count({ where: { role: 'student' } });
    const totalCoaches = await UserRole.count({ where: { role: 'coach' } });
    const totalBookings = await Booking.count();
    const activeBookings = await Booking.count({ where: { status: { [Op.in]: ['pending', 'confirmed'] } } });
    
    const totalRevenue = await Payment.sum('total_charge_to_student', {
      where: { payment_status: 'captured' },
    }) || 0;

    const totalCommissions = await Payment.sum('platform_fee_amount', {
      where: { payment_status: 'captured' },
    }) || 0;

    const pendingDisputes = await Dispute.count({ where: { status: { [Op.in]: ['open', 'under_review'] } } });
    const unresolvedAlerts = await AdminAlert.count({ where: { resolved: false } });

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
      alerts: {
        unresolved: unresolvedAlerts,
      },
    }, 'Dashboard stats retrieved successfully');
  } catch (error) {
    logger.error('Get dashboard stats error:', error);
    return errorResponse(res, 'Failed to retrieve dashboard stats', 500);
  }
};

export const getAlerts = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const { resolved } = req.validated;
    const alerts = await AdminAlert.findAll({
      where: { resolved: resolved === 'true' },
      include: [
        { model: User, as: 'relatedUser', attributes: ['id', 'full_name'] },
        { model: Booking, as: 'relatedBooking' },
        { model: Payment, as: 'relatedPayment' },
      ],
      order: [['created_at', 'DESC']],
    });

    return successResponse(res, alerts, 'Alerts retrieved successfully');
  } catch (error) {
    logger.error('Get alerts error:', error);
    return errorResponse(res, 'Failed to retrieve alerts', 500);
  }
};

export const resolveAlert = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const { id } = req.params;
    const alert = await AdminAlert.findByPk(id);

    if (!alert) {
      return errorResponse(res, 'Alert not found', 404);
    }

    await alert.update({ resolved: true, resolved_at: new Date() });
    return successResponse(res, alert, 'Alert resolved successfully');
  } catch (error) {
    logger.error('Resolve alert error:', error);
    return errorResponse(res, 'Failed to resolve alert', 500);
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
 * Manually adjust a user's reliability score
 * This is a SEPARATE action from dispute resolution
 * Allows admins to make explicit reliability adjustments with justification
 */
export const adjustUserReliability = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized: Only admins can adjust reliability scores', 403);
    }

    const { id } = req.params; // user_id from route
    const { new_score, reason, explanation } = req.body;

    if (new_score === undefined) {
      return errorResponse(res, 'new_score is required', 400);
    }

    // Validate score range
    const scoreValue = parseFloat(new_score);
    if (isNaN(scoreValue) || scoreValue < 0 || scoreValue > 100) {
      return errorResponse(res, 'Reliability score must be a number between 0 and 100', 400);
    }

    const targetUser = await User.findByPk(id, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    if (!targetUser) {
      return errorResponse(res, 'User not found', 404);
    }

    const targetRoles = targetUser.userRoles?.map((r) => r.role) ?? [];
    if (targetRoles.includes('admin')) {
      return errorResponse(res, 'Cannot adjust reliability for admin users', 400);
    }
    if (!targetRoles.includes('coach')) {
      return errorResponse(res, 'Can only adjust reliability for coaches', 400);
    }

    const [reliability, created] = await UserReliability.findOrCreate({
      where: { user_id: id },
      defaults: {
        user_id: id,
        reliability_score: 100.00,
      },
    });

    const beforeState = reliability.toJSON();
    await reliability.update({
      reliability_score: scoreValue,
    });

    // Log this as a manual admin adjustment with full audit trail
    await logAudit(req.user.id, 'admin_reliability_adjustment', 'user_reliability', reliability.user_id, {
      before_score: beforeState.reliability_score,
      reason,
      explanation,
    }, {
      after_score: scoreValue,
      adjusted_by_admin: req.user.id,
      reason,
      explanation,
    }, req);

    return successResponse(res, {
      user_id: parseInt(id),
      user_roles: targetRoles,
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
    const coachRoles = coach?.userRoles?.map((r) => r.role) ?? [];
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
      order: [['preferred', 'DESC'], ['created_at', 'ASC']],
    });
    return successResponse(res, coachCourts, 'Coach courts retrieved successfully');
  } catch (error) {
    logger.error('Admin get coach courts error:', error);
    return errorResponse(res, 'Failed to retrieve coach courts', 500);
  }
};

/**
 * DELETE /api/admin/coaches/:coachId/courts/:linkId
 * Admin only: unlink a court from a coach (e.g. wrong court linked).
 */
export const deleteCoachCourtForAdmin = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }
    const coachId = parseInt(req.params.coachId, 10);
    const linkId = parseInt(req.params.linkId, 10);
    if (Number.isNaN(coachId) || Number.isNaN(linkId)) {
      return errorResponse(res, 'Invalid coach ID or link ID', 400);
    }
    const link = await CoachCourtLocation.findOne({
      where: { id: linkId, coach_id: coachId },
    });
    if (!link) {
      return errorResponse(res, 'Court link not found', 404);
    }
    await link.destroy();
    return successResponse(res, null, 'Court removed from coach');
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
