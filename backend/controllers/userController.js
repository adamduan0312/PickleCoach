import { Op } from 'sequelize';
import { User, UserRole, CoachProfile, UserReliability, sequelize } from '../models/index.js';
import { attachLegacyReliabilityAliases } from '../services/reliabilityEngine.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logger } from '../config/logger.js';

export const getAllUsers = async (req, res) => {
  try {
    const { page, limit, role, include_deleted, search } = req.validated;

    const andConditions = [];
    // By default only return active, non-deleted users; admin can pass include_deleted=true to see all (including soft-deleted/inactive)
    if (include_deleted !== 'true') {
      andConditions.push({ deleted_at: null, is_active: true });
    }
    // Always include user_roles so we can return roles for each user; filter by role when requested
    const includeForRole = role
      ? [{ model: UserRole, as: 'userRoles', attributes: ['role'], where: { role }, required: true }]
      : [{ model: UserRole, as: 'userRoles', attributes: ['role'] }];

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[\\%_]/g, '\\$&');
      const pattern = `%${escaped.toLowerCase()}%`;
      andConditions.push({
        [Op.or]: [
          sequelize.where(sequelize.fn('LOWER', sequelize.col('full_name')), { [Op.like]: pattern }),
          sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), { [Op.like]: pattern }),
        ],
      });
    }

    const where = andConditions.length ? { [Op.and]: andConditions } : {};

    const findOptions = {
      where,
      attributes: { exclude: ['password_hash'] },
      include: includeForRole,
      order: [['id', 'DESC']],
      distinct: true,
    };

    if (limit != null) {
      const { limit: queryLimit, offset } = getPagination(page, limit);
      findOptions.limit = queryLimit;
      findOptions.offset = offset;
    }

    const users = await User.findAndCountAll(findOptions);

    const response = getPagingData(users, page, limit ?? users.count);
    const itemsWithRoles = response.items.map((u) => {
      const json = u.toJSON();
      json.roles = (u.userRoles || []).map((r) => r.role);
      delete json.userRoles;
      return json;
    });
    if (limit != null) {
      return paginatedResponse(res, itemsWithRoles, response.pagination, 'Users retrieved successfully');
    }
    return successResponse(res, itemsWithRoles, 'Users retrieved successfully', 200);
  } catch (error) {
    logger.error('Get users error:', error);
    return errorResponse(res, 'Failed to retrieve users', 500);
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(id, 10);
    if (Number.isNaN(userId)) {
      return errorResponse(res, 'Invalid user ID', 400);
    }

    // Check authorization: users can view their own profile, admins can view any profile
    if (req.user.id !== userId && !(req.user.roles || []).includes('admin')) {
      logger.warn(`User ${req.user.id} attempted to access user ${userId} without permission`);
      return errorResponse(res, 'You can only view your own profile', 403);
    }

    // Admins can view deleted users, regular users cannot
    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password_hash'] },
      include: [
        { model: UserRole, as: 'userRoles', attributes: ['role'] },
        { model: CoachProfile, as: 'coachProfile' },
        { model: UserReliability, as: 'reliabilities' },
      ],
    });

    if (!user) {
      logger.warn(`User ${userId} not found in database`);
      return errorResponse(res, 'User not found', 404);
    }

    // Regular users cannot view deleted profiles, but admins can
    if (user.deleted_at && !(req.user.roles || []).includes('admin')) {
      logger.warn(`User ${req.user.id} attempted to access deleted user ${userId}`);
      return errorResponse(res, 'User not found', 404);
    }

    const roles = user.userRoles?.map((r) => r.role) ?? [];
    const payload = user.toJSON();
    payload.roles = roles;
    delete payload.userRoles;

    const relRows = user.reliabilities || [];
    delete payload.reliabilities;
    const coachRel = relRows.find((r) => r.role === 'coach');
    const studentRel = relRows.find((r) => r.role === 'student');
    if (roles.includes('coach') && coachRel) {
      payload.reliability = attachLegacyReliabilityAliases(coachRel.toJSON());
    }
    if (roles.includes('student') && studentRel) {
      payload.reliability_student = attachLegacyReliabilityAliases(studentRel.toJSON());
    }

    logger.info(`User ${req.user.id} (roles: ${(req.user.roles || []).join(',')}) retrieved user ${userId}`);
    return successResponse(res, payload, 'User retrieved successfully');
  } catch (error) {
    logger.error('Get user error:', error);
    return errorResponse(res, 'Failed to retrieve user', 500);
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, timezone, avatar_url, is_active, role, deleted_at } = req.validated;

    const user = await User.findByPk(id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // If changing email, ensure it is not already used by another user
    if (email !== undefined && email !== user.email) {
      const existing = await User.findOne({ where: { email } });
      if (existing) {
        return errorResponse(res, 'Email is already in use by another user', 400);
      }
    }

    // Guard: Prevent setting is_active: true on a deleted user (must undelete first)
    if (user.deleted_at && is_active === true && deleted_at !== null) {
      logger.warn(`Admin ${req.user.id} attempted to activate deleted user ${id} without undeleting`);
      return errorResponse(res, 'Cannot activate a deleted user. Set deleted_at to null to undelete first, or undelete and activate in separate requests', 400);
    }

    const updateData = {
      full_name: full_name || user.full_name,
      email: email !== undefined ? email : user.email,
      phone: phone !== undefined ? phone : user.phone,
      timezone: timezone || user.timezone,
      avatar_url: avatar_url !== undefined ? avatar_url : user.avatar_url,
      is_active: is_active !== undefined ? is_active : user.is_active,
    };

    if (email !== undefined && email !== user.email) {
      updateData.token_version = (user.token_version ?? 0) + 1;
    }

    // Allow explicit undelete by setting deleted_at to null
    if (deleted_at === null) {
      updateData.deleted_at = null;
      logger.info(`Admin ${req.user.id} undeleted user ${id} (cleared deleted_at)`);
    }

    await user.update(updateData);

    if (role !== undefined) {
      await UserRole.destroy({ where: { user_id: user.id } });
      await UserRole.create({ user_id: user.id, role });
    }

    const currentRoles = await UserRole.findAll({ where: { user_id: user.id }, attributes: ['role'] }).then((rows) => rows.map((r) => r.role));

    return successResponse(res, {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      roles: currentRoles,
      is_active: user.is_active,
      phone: user.phone ?? null,
      timezone: user.timezone ?? null,
      avatar_url: user.avatar_url ?? null,
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

    if (user.deleted_at) {
      return errorResponse(res, 'User is already deleted', 400);
    }

    await user.update({ deleted_at: new Date(), is_active: false });
    const coachProfile = await CoachProfile.findOne({ where: { user_id: user.id } });
    if (coachProfile && !coachProfile.deleted_at) {
      await coachProfile.update({ deleted_at: new Date() });
    }
    return successResponse(res, null, 'User deleted successfully');
  } catch (error) {
    logger.error('Delete user error:', error);
    return errorResponse(res, 'Failed to delete user', 500);
  }
};
