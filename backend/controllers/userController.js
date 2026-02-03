import { User, CoachProfile, UserReliability } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logger } from '../config/logger.js';

export const getAllUsers = async (req, res) => {
  try {
    const { page, limit, role, is_active } = req.validated;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = {};
    if (role) where.role = role;
    if (is_active !== undefined) where.is_active = is_active === 'true';

    const users = await User.findAndCountAll({
      where,
      limit: queryLimit,
      offset,
      attributes: { exclude: ['password_hash'] },
      order: [['created_at', 'DESC']],
    });

    const response = getPagingData(users, page, queryLimit);
    return successResponse(res, response.items, 'Users retrieved successfully', 200);
  } catch (error) {
    logger.error('Get users error:', error);
    return errorResponse(res, 'Failed to retrieve users', 500);
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id, {
      attributes: { exclude: ['password_hash'] },
      include: [
        { model: CoachProfile, as: 'coachProfile' },
        { model: UserReliability, as: 'reliability' },
      ],
    });

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    return successResponse(res, user, 'User retrieved successfully');
  } catch (error) {
    logger.error('Get user error:', error);
    return errorResponse(res, 'Failed to retrieve user', 500);
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, phone, timezone, is_active, role } = req.validated;

    const user = await User.findByPk(id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    await user.update({
      full_name: full_name || user.full_name,
      phone: phone !== undefined ? phone : user.phone,
      timezone: timezone || user.timezone,
      is_active: is_active !== undefined ? is_active : user.is_active,
      role: role || user.role,
    });

    // Echo all safe request fields so response shape matches update body; optional as null.
    return successResponse(res, {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
      phone: user.phone ?? null,
      timezone: user.timezone ?? null,
    }, 'User updated successfully');
  } catch (error) {
    logger.error('Update user error:', error);
    return errorResponse(res, 'Failed to update user', 500);
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    await user.destroy();
    return successResponse(res, null, 'User deleted successfully');
  } catch (error) {
    logger.error('Delete user error:', error);
    return errorResponse(res, 'Failed to delete user', 500);
  }
};
