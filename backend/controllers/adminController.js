import { AdminAnalytics, AdminAlert, User, Booking, Payment, Dispute } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { Op } from 'sequelize';

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
    console.error('Get dashboard stats error:', error);
    return errorResponse(res, 'Failed to retrieve dashboard stats', 500);
  }
};

export const getAlerts = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const { resolved = false } = req.query;
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
    console.error('Get alerts error:', error);
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
    console.error('Resolve alert error:', error);
    return errorResponse(res, 'Failed to resolve alert', 500);
  }
};
