import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { User, UserRole, CoachProfile, UserReliability, sequelize } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { serializeAuthProfileUser, serializeAuthSessionUser } from '../utils/userDto.js';
import { logAudit } from '../utils/audit.js';
import { logger } from '../config/logger.js';
import * as notificationService from '../services/notificationService.js';
import { canSelfServiceAddRole, canSelfServiceRemoveRole } from '../utils/roleGovernance.js';
import { countOtherLiveAdmins } from '../utils/userRoleChangeGuards.js';
import { softDeleteUserAccount } from '../utils/userLifecycle.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
/** Minimum interval between verification emails for the same user (spam / cost control). */
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

/** Same row graph as GET/PUT profile — single source for `serializeAuthProfileUser`. */
async function loadUserForAuthProfile(userId) {
  return User.findByPk(userId, {
    attributes: { exclude: ['password_hash'] },
    include: [
      { model: UserRole, as: 'userRoles', attributes: ['role'] },
      { model: CoachProfile, as: 'coachProfile' },
      { model: UserReliability, as: 'reliabilities', required: false },
    ],
  });
}

/** Login-shaped `{ token, user }` for responses after sensitive self-service actions. */
function buildAuthSessionPayload(user) {
  const token = jwt.sign(
    { userId: user.id, tokenVersion: user.token_version ?? 0 },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  return {
    token,
    user: serializeAuthSessionUser(user),
  };
}

export const register = async (req, res) => {
  try {
    const { full_name, email, password, role, phone, timezone, avatar_url } = req.validated;

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return errorResponse(res, 'Email already registered', 409);
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      full_name,
      email,
      password_hash,
      phone,
      timezone: timezone || 'UTC',
      ...(avatar_url !== undefined && avatar_url !== '' && { avatar_url }),
    });

    // Stripe Customer is created when the user completes a verified financial flow (e.g. booking payment),
    // not at registration — avoids payment infrastructure for unverified accounts.

    await UserRole.create({ user_id: user.id, role });

    await user.reload({
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    const token = jwt.sign({ userId: user.id, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    await logAudit(user.id, 'user_registered', 'users', user.id, null, user.toJSON(), req);

    return successResponse(res, {
      user: serializeAuthSessionUser(user),
      token,
    }, 'User registered successfully', 201);
  } catch (error) {
    logger.error('Registration error:', error);
    return errorResponse(res, 'Registration failed', 500);
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.validated;

    const user = await User.findOne({
      where: { email },
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    if (!user) {
      await logAudit(null, 'login_failed', 'users', null, null, { reason: 'invalid_credentials' }, req);
      return errorResponse(res, 'Invalid credentials', 401);
    }

    if (user.deleted_at) {
      await logAudit(user.id, 'login_failed', 'users', user.id, null, { reason: 'account_deleted' }, req);
      return errorResponse(res, 'This account has been deleted. Please contact support.', 401);
    }

    if (!user.is_active) {
      await logAudit(user.id, 'login_failed', 'users', user.id, null, { reason: 'account_suspended' }, req);
      return errorResponse(res, 'This account has been suspended. Please contact support.', 401);
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      await logAudit(user.id, 'login_failed', 'users', user.id, null, { reason: 'invalid_credentials' }, req);
      return errorResponse(res, 'Invalid credentials', 401);
    }

    await user.update({ last_login: new Date() });

    const token = jwt.sign({ userId: user.id, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    await user.reload({
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    await logAudit(user.id, 'user_login', 'users', user.id, null, user.toJSON(), req);

    return successResponse(res, {
      user: serializeAuthSessionUser(user),
      token,
    }, 'Login successful');
  } catch (error) {
    logger.error('Login error:', error);
    return errorResponse(res, 'Login failed', 500);
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await loadUserForAuthProfile(req.user.id);

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    return successResponse(res, serializeAuthProfileUser(user), 'Profile retrieved successfully');
  } catch (error) {
    logger.error('Get profile error:', error);
    return errorResponse(res, 'Failed to retrieve profile', 500);
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { full_name, phone, timezone, avatar_url } = req.validated;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const beforeState = user.toJSON();
    await user.update({
      full_name: full_name || user.full_name,
      phone: phone !== undefined ? phone : user.phone,
      timezone: timezone || user.timezone,
      avatar_url: avatar_url !== undefined ? avatar_url : user.avatar_url,
    });

    await logAudit(req.user.id, 'profile_updated', 'users', user.id, beforeState, user.toJSON(), req);

    const refreshed = await loadUserForAuthProfile(req.user.id);
    if (!refreshed) {
      return errorResponse(res, 'User not found', 404);
    }

    return successResponse(res, serializeAuthProfileUser(refreshed), 'Profile updated successfully');
  } catch (error) {
    logger.error('Update profile error:', error);
    return errorResponse(res, 'Failed to update profile', 500);
  }
};

/**
 * Refresh JWT token
 * POST /api/auth/refresh
 * Body: { token: string }
 *
 * Requires a valid JWT signature. Expired tokens may refresh only if signature verifies and
 * tokenVersion matches the user (same rules as authenticate middleware).
 */
export const refreshToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return errorResponse(res, 'Token is required', 400);
    }

    const trimmed = token.trim();
    let decoded;
    try {
      decoded = jwt.verify(trimmed, JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        try {
          // Signature must still verify — never use jwt.decode alone for refresh.
          decoded = jwt.verify(trimmed, JWT_SECRET, { ignoreExpiration: true });
        } catch (inner) {
          await logAudit(null, 'token_refresh_invalid', null, null, null, { reason: 'expired_bad_signature' }, req);
          return errorResponse(res, 'Authentication failed', 401);
        }
      } else {
        await logAudit(null, 'token_refresh_invalid', null, null, null, { reason: 'jwt_verify_failed' }, req);
        return errorResponse(res, 'Authentication failed', 401);
      }
    }

    const userId = decoded?.userId;
    if (userId == null || Number.isNaN(Number(userId))) {
      await logAudit(null, 'token_refresh_invalid', null, null, null, { reason: 'missing_user_id_claim' }, req);
      return errorResponse(res, 'Authentication failed', 401);
    }

    const user = await User.findByPk(Number(userId), {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    if (!user || !user.is_active || user.deleted_at) {
      await logAudit(user?.id ?? null, 'token_refresh_denied', 'users', user?.id ?? null, null, { reason: 'inactive_or_missing_user' }, req);
      return errorResponse(res, 'Authentication failed', 401);
    }

    const tokenVersionFromToken = decoded.tokenVersion ?? 0;
    const currentTokenVersion = user.token_version ?? 0;
    if (currentTokenVersion !== tokenVersionFromToken) {
      await logAudit(user.id, 'token_refresh_denied_version_mismatch', 'users', user.id, null, {
        token_version_claim: tokenVersionFromToken,
        token_version_current: currentTokenVersion,
      }, req);
      return errorResponse(res, 'Authentication failed', 401);
    }

    const newToken = jwt.sign({ userId: user.id, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    await logAudit(user.id, 'token_refreshed', 'users', user.id, null, { token_refreshed: true }, req);

    return successResponse(res, {
      token: newToken,
      user: serializeAuthSessionUser(user),
    }, 'Token refreshed successfully');
  } catch (error) {
    logger.error('Refresh token error:', error);
    return errorResponse(res, 'Failed to refresh token', 500);
  }
};

/**
 * Forgot password - Request password reset
 * POST /api/auth/forgot-password
 * Body: { email: string }
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.validated;

    const user = await User.findOne({ where: { email } });
    
    // Don't reveal if email exists (security best practice)
    if (!user) {
      return successResponse(res, null, 'If an account exists with this email, a password reset link has been sent', 200);
    }

    if (user.deleted_at || !user.is_active) {
      return successResponse(res, null, 'If an account exists with this email, a password reset link has been sent', 200);
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 3600000); // 1 hour from now

    await user.update({
      password_reset_token: resetToken,
      password_reset_expires: resetExpires,
    });

    // Send password reset email
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    
    try {
      const notification = await notificationService.createNotification(
        user.id,
        'password_reset',
        'email',
        {
          reset_url: resetUrl,
          reset_token: resetToken,
          expires_in: '1 hour',
        }
      );
      
      // Send the email immediately
      await notificationService.sendNotification(notification.id);
    } catch (emailError) {
      logger.error('Failed to send password reset email:', emailError);
      // Continue even if email fails - token is still generated
    }

    await logAudit(user.id, 'password_reset_requested', 'users', user.id, null, { email: user.email }, req);

    return successResponse(res, null, 'If an account exists with this email, a password reset link has been sent', 200);
  } catch (error) {
    logger.error('Forgot password error:', error);
    return errorResponse(res, 'Failed to process password reset request', 500);
  }
};

/**
 * Reset password - Reset password with token
 * POST /api/auth/reset-password
 * Body: { token: string, password: string }
 */
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.validated;

    const user = await User.findOne({
      where: {
        password_reset_token: token,
        password_reset_expires: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      return errorResponse(res, 'Invalid or expired reset token', 400);
    }

    // Hash new password
    const password_hash = await bcrypt.hash(password, 10);

    const beforeState = user.toJSON();
    await user.update({
      password_hash,
      password_reset_token: null,
      password_reset_expires: null,
      token_version: (user.token_version ?? 0) + 1,
    });

    await logAudit(user.id, 'password_reset_completed', 'users', user.id, beforeState, { password_reset: true }, req);

    return successResponse(res, null, 'Password reset successfully', 200);
  } catch (error) {
    logger.error('Reset password error:', error);
    return errorResponse(res, 'Failed to reset password', 500);
  }
};

/**
 * Delete my account (soft delete)
 * DELETE /api/auth/me
 * Same invariant as `DELETE /api/users/:id`: if this user has an **`admin`** `user_roles` row,
 * self-delete is allowed only when **≥1 other live admin** remains (`countOtherLiveAdmins`).
 */
export const deleteMyAccount = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const hasAdminAssignment = await UserRole.findOne({
      where: { user_id: user.id, role: 'admin' },
    });
    if (hasAdminAssignment) {
      const otherLiveAdminCount = await countOtherLiveAdmins(user.id);
      if (otherLiveAdminCount < 1) {
        return errorResponse(
          res,
          'Cannot delete your account: you are an admin and no other active admin exists. Assign or restore another admin first.',
          409,
          null,
          { code: 'last_admin_required' },
        );
      }
    }

    const beforeState = user.toJSON();
    await sequelize.transaction(async (transaction) => {
      await softDeleteUserAccount(user, { transaction });
    });
    await user.reload();

    await logAudit(req.user.id, 'user_self_deleted', 'users', user.id, beforeState, { deleted_at: user.deleted_at }, req);

    return successResponse(res, null, 'Account deleted successfully');
  } catch (error) {
    logger.error('Delete my account error:', error);
    return errorResponse(res, 'Failed to delete account', 500);
  }
};

/**
 * Logout – invalidate current and all other tokens for this user
 * POST /api/auth/logout
 * Auth required. Increments token_version so all existing JWTs are rejected. Client should discard the token after calling.
 */
export const logout = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const newVersion = (user.token_version ?? 0) + 1;
    await user.update({ token_version: newVersion });

    await logAudit(req.user.id, 'user_logout', 'users', user.id, null, { token_version: newVersion }, req);

    return successResponse(res, null, 'Logged out successfully');
  } catch (error) {
    logger.error('Logout error:', error);
    return errorResponse(res, 'Failed to log out', 500);
  }
};

/**
 * Add or remove student/coach capability (self-service).
 * Route: **PUT /api/auth/me/role**
 * Body: { role: 'student' | 'coach', action?: 'add' | 'remove' }  (action defaults to add)
 *
 * Invariants:
 * - Does **not** delete coach profiles, lessons, bookings, payments, reviews, Stripe data, etc.
 * - Must keep at least one of `student` or `coach` after remove.
 * - Cannot change `admin` here. Admins cannot use this endpoint (use admin user management).
 * - Which dashboard to show is a frontend `activeRole` concern — not stored server-side.
 */
export const addUserRole = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if ((req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Admins cannot change roles via this endpoint; use admin user management.', 403);
    }

    const { role, action } = req.validated;
    const currentRoles = user.userRoles && user.userRoles.length ? user.userRoles.map((r) => r.role) : [];

    if (action === 'remove') {
      if (!currentRoles.includes(role)) {
        return successResponse(res, {
          user: serializeAuthSessionUser(user),
          token: req.headers.authorization?.split(' ')[1],
        }, 'Capability unchanged (you do not have the ' + role + ' role).');
      }

      if (!canSelfServiceRemoveRole(user, role, currentRoles)) {
        return errorResponse(
          res,
          'You must keep at least one of student or coach. Add the other role before removing this one.',
          400,
        );
      }

      await UserRole.destroy({ where: { user_id: user.id, role } });

      const updatedRoles = currentRoles.filter((r) => r !== role).sort();
      await logAudit(
        req.user.id,
        'user_self_service_role_removed',
        'users',
        user.id,
        { roles: currentRoles },
        { roles: updatedRoles },
        req,
      );

      await user.reload({
        include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
      });

      const newToken = jwt.sign({ userId: user.id, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
      });

      return successResponse(res, {
        user: serializeAuthSessionUser(user),
        token: newToken,
      }, 'Role removed successfully. Historical bookings and profile data are retained. Use the new token for subsequent requests.');
    }

    // action === 'add'
    if (!canSelfServiceAddRole(user, role, currentRoles)) {
      return errorResponse(res, 'This role has been restricted by an administrator', 403);
    }

    if (currentRoles.includes(role)) {
      return successResponse(res, {
        user: serializeAuthSessionUser(user),
        token: req.headers.authorization?.split(' ')[1],
      }, 'Capability unchanged (you already have the ' + role + ' role).');
    }

    await UserRole.findOrCreate({
      where: { user_id: user.id, role },
      defaults: { user_id: user.id, role },
    });

    const updatedRoles = [...currentRoles, role].sort();
    await logAudit(req.user.id, 'user_self_service_role_added', 'users', user.id, { roles: currentRoles }, { roles: updatedRoles }, req);

    await user.reload({
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    const newToken = jwt.sign({ userId: user.id, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return successResponse(res, {
      user: serializeAuthSessionUser(user),
      token: newToken,
    }, 'Role added successfully. Use the new token for subsequent requests.');
  } catch (error) {
    logger.error('Manage role (PUT /api/auth/me/role) error:', error);
    return errorResponse(res, 'Failed to update role', 500);
  }
};

/**
 * Change password (self-service)
 * PUT /api/auth/change-password
 * Body: { current_password: string, new_password: string }
 */
export const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.validated;

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const isValidPassword = await bcrypt.compare(current_password, user.password_hash);
    if (!isValidPassword) {
      return errorResponse(res, 'Current password is incorrect', 400);
    }

    const newPasswordHash = await bcrypt.hash(new_password, 10);
    const beforeState = user.toJSON();

    const newTokenVersion = (user.token_version ?? 0) + 1;

    await user.update({
      password_hash: newPasswordHash,
      token_version: newTokenVersion,
    });

    await logAudit(req.user.id, 'password_changed', 'users', user.id, beforeState, { password_changed: true, token_version: newTokenVersion }, req);

    await user.reload({
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    return successResponse(res, buildAuthSessionPayload(user), 'Password changed successfully');
  } catch (error) {
    logger.error('Change password error:', error);
    return errorResponse(res, 'Failed to change password', 500);
  }
};

/**
 * Request email change
 * POST /api/auth/change-email/request
 * Body: { new_email: string, password: string }
 */
export const requestEmailChange = async (req, res) => {
  try {
    const { new_email, password } = req.validated;

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return errorResponse(res, 'Invalid password', 400);
    }

    if (new_email === user.email) {
      return errorResponse(res, 'New email must be different from current email', 400);
    }

    const existingUser = await User.findOne({ where: { email: new_email } });
    if (existingUser) {
      return errorResponse(res, 'Email is already in use by another account', 400);
    }

    const emailChangeToken = crypto.randomBytes(32).toString('hex');
    const emailChangeExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await user.update({
      email_change_token: emailChangeToken,
      email_change_expires: emailChangeExpires,
      email_change_new_email: new_email,
    });

    const confirmUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/change-email/confirm?token=${emailChangeToken}`;

    try {
      const notification = await notificationService.createNotification(
        user.id,
        'email_change_confirm',
        'email',
        {
          confirm_url: confirmUrl,
          confirm_token: emailChangeToken,
          new_email,
          expires_in: '24 hours',
        }
      );

      await notificationService.sendNotification(notification.id);
    } catch (emailError) {
      logger.error('Failed to send email change confirmation email:', emailError);
    }

    await logAudit(req.user.id, 'email_change_requested', 'users', user.id, null, {
      new_email,
      email_change_expires: emailChangeExpires,
    }, req);

    return successResponse(res, null, 'Email change confirmation sent to new address');
  } catch (error) {
    logger.error('Request email change error:', error);
    return errorResponse(res, 'Failed to request email change', 500);
  }
};

/**
 * Confirm email change
 * POST /api/auth/change-email/confirm
 * Body: { token: string }
 */
export const confirmEmailChange = async (req, res) => {
  try {
    const { token } = req.validated;

    const user = await User.findOne({
      where: {
        email_change_token: token,
        email_change_expires: { [Op.gt]: new Date() },
      },
    });

    if (!user || !user.email_change_new_email) {
      return errorResponse(res, 'Invalid or expired email change token', 400);
    }

    const oldEmail = user.email;
    const newEmail = user.email_change_new_email;
    const beforeState = user.toJSON();

    const newTokenVersion = (user.token_version ?? 0) + 1;

    await user.update({
      email: newEmail,
      email_change_token: null,
      email_change_expires: null,
      email_change_new_email: null,
      email_verified_at: new Date(),
      token_version: newTokenVersion,
    });

    await logAudit(user.id, 'email_change_completed', 'users', user.id, beforeState, {
      old_email: oldEmail,
      new_email: newEmail,
      email_verified_at: user.email_verified_at,
      token_version: newTokenVersion,
    }, req);

    // Notify old email that the email address was changed
    try {
      if (oldEmail && oldEmail !== newEmail) {
        const notification = await notificationService.createNotification(
          user.id,
          'email_changed_notification',
          'email',
          {
            old_email: oldEmail,
            new_email: newEmail,
          }
        );

        await notificationService.sendNotification(notification.id);
      }
    } catch (emailError) {
      logger.error('Failed to send old-email notification after email change:', emailError);
    }

    const refreshed = await User.findByPk(user.id, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    return successResponse(res, buildAuthSessionPayload(refreshed), 'Email updated successfully');
  } catch (error) {
    logger.error('Confirm email change error:', error);
    return errorResponse(res, 'Failed to confirm email change', 500);
  }
};

/**
 * Request email verification
 * POST /api/auth/verify-email/request
 */
export const requestEmailVerification = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (user.email_verified_at) {
      return successResponse(res, null, 'Email is already verified');
    }

    const lastSent = user.email_verification_last_sent_at
      ? new Date(user.email_verification_last_sent_at).getTime()
      : 0;
    if (lastSent && Date.now() - lastSent < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil(
        (EMAIL_VERIFICATION_RESEND_COOLDOWN_MS - (Date.now() - lastSent)) / 1000,
      );
      return errorResponse(
        res,
        'Please wait before requesting another verification email.',
        429,
        null,
        { retryAfterSec },
      );
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await user.update({
      email_verification_token: verificationToken,
      email_verification_expires: verificationExpires,
      email_verification_last_sent_at: new Date(),
    });

    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;

    try {
      const notification = await notificationService.createNotification(
        user.id,
        'email_verification',
        'email',
        {
          verify_url: verifyUrl,
          verify_token: verificationToken,
          expires_in: '24 hours',
        }
      );

      await notificationService.sendNotification(notification.id);
    } catch (emailError) {
      logger.error('Failed to send email verification email:', emailError);
    }

    await logAudit(req.user.id, 'email_verification_requested', 'users', user.id, null, {
      email_verification_expires: verificationExpires,
    }, req);

    return successResponse(res, null, 'Verification email sent');
  } catch (error) {
    logger.error('Request email verification error:', error);
    return errorResponse(res, 'Failed to request email verification', 500);
  }
};

/**
 * Confirm email verification
 * POST /api/auth/verify-email/confirm
 * Body: { token: string }
 */
export const confirmEmailVerification = async (req, res) => {
  try {
    const { token } = req.validated;

    // Token stays on the user until it expires or a new verification email replaces it.
    // Re-clicks on the same valid link return a friendly success — no repeat side effects.
    const user = await User.findOne({
      where: {
        email_verification_token: token,
        email_verification_expires: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      return errorResponse(res, 'Invalid or expired verification token', 400);
    }

    if (user.email_verified_at) {
      return successResponse(res, null, 'Email already verified');
    }

    const beforeState = user.toJSON();
    const verifiedAt = new Date();

    await user.update({
      email_verified_at: verifiedAt,
    });

    await logAudit(user.id, 'email_verified', 'users', user.id, beforeState, {
      email_verified_at: verifiedAt,
    }, req);

    return successResponse(res, null, 'Email verified successfully');
  } catch (error) {
    logger.error('Confirm email verification error:', error);
    return errorResponse(res, 'Failed to confirm email verification', 500);
  }
};
