import { Op } from 'sequelize';
import { User, UserRole, CoachProfile, UserReliability, sequelize } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logger } from '../config/logger.js';
import { serializeAdminUserList, serializeAdminUserDetail } from '../utils/userDto.js';
import { validateAdminRoleRemovalSafeguards, countOtherLiveAdmins } from '../utils/userRoleChangeGuards.js';
import { effectiveRolesFromGovernance, serializeRoleState } from '../utils/roleGovernance.js';
import { softDeleteUserAccount, restoreUserAccount } from '../utils/userLifecycle.js';

export const getAllUsers = async (req, res) => {
  try {
    const { page, limit, role, include_deleted, search } = req.validated;

    const andConditions = [];
    // Default: non–soft-deleted users (Active + Suspended). Pass include_deleted=true for Deleted too.
    if (include_deleted !== 'true') {
      andConditions.push({ deleted_at: null });
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
    const itemsWithRoles = response.items.map((u) => serializeAdminUserList(u));
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

    const payload = serializeAdminUserDetail(user);

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
    const userId = parseInt(id, 10);
    if (Number.isNaN(userId)) {
      return errorResponse(res, 'Invalid user ID', 400);
    }
    const { full_name, email, phone, timezone, avatar_url, is_active, roles, deleted_at, role_governance_locked } =
      req.validated;

    const user = await User.findByPk(userId);
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

    const restoring = deleted_at === null && user.deleted_at != null;
    const activating = is_active === true;
    const suspending = is_active === false;

    // Cannot activate while still deleted (must restore with deleted_at: null first or in same request)
    if (user.deleted_at && activating && !restoring) {
      logger.warn(`Admin ${req.user.id} attempted to activate deleted user ${userId} without undeleting`);
      return errorResponse(
        res,
        'Cannot activate a deleted user. Set deleted_at to null to restore first, or restore and activate in the same request',
        400,
      );
    }

    // Suspension must not touch soft-delete fields / coach profile
    if (suspending && user.deleted_at && !restoring) {
      // Already deleted — is_active is already false; treat as no-op for access flag
    }

    let uniqueRoles;
    if (roles !== undefined) {
      uniqueRoles = [...new Set(roles)];
      const previousRoles = await UserRole.findAll({
        where: { user_id: user.id },
        attributes: ['role'],
      }).then((rows) => rows.map((r) => r.role));

      const hadAdmin = previousRoles.includes('admin');
      const willHaveAdmin = uniqueRoles.includes('admin');
      if (hadAdmin && !willHaveAdmin) {
        const otherAdminCount = await countOtherLiveAdmins(user.id);
        const guard = validateAdminRoleRemovalSafeguards({
          actorUserId: req.user.id,
          targetUserId: user.id,
          previousRoles,
          nextRoles: uniqueRoles,
          otherAdminUserCount: otherAdminCount,
        });
        if (!guard.ok) {
          return errorResponse(res, guard.message, guard.status);
        }
      }
    }

    await sequelize.transaction(async (transaction) => {
      if (restoring) {
        await restoreUserAccount(user, { transaction });
        logger.info(`Admin ${req.user.id} restored user ${userId} (cleared deleted_at + coach profile)`);
        // After restore, account is Active. Optional explicit suspend in same request:
        if (suspending) {
          await user.update({ is_active: false }, { transaction });
          logger.info(`Admin ${req.user.id} suspended user ${userId} immediately after restore`);
        }
      } else if (is_active !== undefined) {
        await user.update({ is_active }, { transaction });
        if (suspending) {
          logger.info(`Admin ${req.user.id} suspended user ${userId} (is_active=false; coach profile unchanged)`);
        } else if (activating) {
          logger.info(`Admin ${req.user.id} reactivated user ${userId}`);
        }
      }

      // Guard invariant: never leave is_active=true with deleted_at set
      await user.reload({ transaction });
      if (user.is_active && user.deleted_at) {
        throw Object.assign(new Error('Invalid user state: cannot be active while deleted'), {
          statusCode: 400,
          clientMessage: 'Invalid state: an active user cannot have deleted_at set',
        });
      }

      const profileFields = {
        full_name: full_name || user.full_name,
        email: email !== undefined ? email : user.email,
        phone: phone !== undefined ? phone : user.phone,
        timezone: timezone || user.timezone,
        avatar_url: avatar_url !== undefined ? avatar_url : user.avatar_url,
      };
      if (email !== undefined && email !== user.email) {
        profileFields.token_version = (user.token_version ?? 0) + 1;
      }
      await user.update(profileFields, { transaction });

      if (roles !== undefined) {
        await UserRole.destroy({ where: { user_id: user.id }, transaction });
        if (uniqueRoles.length > 0) {
          await UserRole.bulkCreate(
            uniqueRoles.map((role) => ({ user_id: user.id, role })),
            { transaction },
          );
        }
        await user.update(
          {
            role_governance_locked: true,
            admin_allowed_roles: uniqueRoles,
          },
          { transaction },
        );
      } else if (role_governance_locked === false) {
        await user.update(
          {
            role_governance_locked: false,
            admin_allowed_roles: null,
          },
          { transaction },
        );
      }
    });

    await user.reload({
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    const dbRoles = user.userRoles?.length ? user.userRoles.map((r) => r.role) : [];
    const currentRoles = [...dbRoles].sort();
    const effective = effectiveRolesFromGovernance(dbRoles, user);

    // `roles` = persisted assignments (same convention as GET /api/users serializers); `role_state.effective_roles` = authorize() view.
    return successResponse(res, {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      roles: currentRoles,
      role_state: serializeRoleState(user, effective),
      is_active: user.is_active,
      deleted_at: user.deleted_at ?? null,
      phone: user.phone ?? null,
      timezone: user.timezone ?? null,
      avatar_url: user.avatar_url ?? null,
    }, 'User updated successfully');
  } catch (error) {
    if (error?.statusCode === 400 && error.clientMessage) {
      return errorResponse(res, error.clientMessage, 400);
    }
    logger.error('Update user error:', error);
    return errorResponse(res, 'Failed to update user', 500);
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(id, 10);
    if (Number.isNaN(userId)) {
      return errorResponse(res, 'Invalid user ID', 400);
    }
    const user = await User.findByPk(userId);

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (user.deleted_at) {
      return errorResponse(res, 'User is already deleted', 400);
    }

    const targetIsAdmin = await UserRole.findOne({
      where: { user_id: user.id, role: 'admin' },
    });
    if (targetIsAdmin) {
      const otherLiveAdminCount = await countOtherLiveAdmins(user.id);
      if (otherLiveAdminCount < 1) {
        return errorResponse(res, 'Cannot delete this user: they are an admin and no other active admin exists. Assign or restore another admin first.', 409, null, {
          code: 'last_admin_required',
        });
      }
    }

    await sequelize.transaction(async (transaction) => {
      await softDeleteUserAccount(user, { transaction });
    });
    return successResponse(res, null, 'User deleted successfully');
  } catch (error) {
    logger.error('Delete user error:', error);
    return errorResponse(res, 'Failed to delete user', 500);
  }
};
