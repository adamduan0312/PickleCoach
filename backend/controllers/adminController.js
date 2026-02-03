import bcrypt from 'bcryptjs';
import { AdminAnalytics, AdminAlert, User, Booking, Payment, Dispute, UserReliability } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';

export const getDashboardStats = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const totalStudents = await User.count({ where: { role: 'student' } });
    const totalCoaches = await User.count({ where: { role: 'coach' } });
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
    if (req.user.role !== 'admin') {
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
    if (req.user.role !== 'admin') {
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
    if (req.user.role !== 'admin') {
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

    // Create admin user
    const adminUser = await User.create({
      full_name,
      email,
      password_hash,
      role: 'admin',
      phone,
      timezone: timezone || 'UTC',
      is_active: true,
    });

    await logAudit(req.user.id, 'admin_created', 'users', adminUser.id, null, { email: adminUser.email, role: adminUser.role }, req);

    return successResponse(res, {
      id: adminUser.id,
      full_name: adminUser.full_name,
      email: adminUser.email,
      role: adminUser.role,
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
    if (req.user.role !== 'admin') {
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

    const targetUser = await User.findByPk(id);
    if (!targetUser) {
      return errorResponse(res, 'User not found', 404);
    }

    // Admins cannot have reliability scores
    if (targetUser.role === 'admin') {
      return errorResponse(res, 'Cannot adjust reliability for admin users', 400);
    }

    // Only allow for students and coaches
    if (targetUser.role !== 'student' && targetUser.role !== 'coach') {
      return errorResponse(res, 'Can only adjust reliability for students or coaches', 400);
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
      user_role: targetUser.role,
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
