import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { User, CoachProfile } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { logger } from '../config/logger.js';
import * as notificationService from '../services/notificationService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

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
      role,
      phone,
      timezone: timezone || 'UTC',
      ...(avatar_url !== undefined && avatar_url !== '' && { avatar_url }),
    });

    const token = jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    await logAudit(user.id, 'user_registered', 'users', user.id, null, user.toJSON(), req);

    // Return user data - role is only 'student' or 'coach' from registration.
    // Echo safe request fields (phone, timezone, avatar_url) so response shape is predictable; use null when optional and unset.
    return successResponse(res, {
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        phone: user.phone ?? null,
        timezone: user.timezone ?? null,
        avatar_url: user.avatar_url ?? null,
      },
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

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    if (!user.is_active) {
      return errorResponse(res, 'Account is inactive', 403);
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    await user.update({ last_login: new Date() });

    const token = jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    await logAudit(user.id, 'user_login', 'users', user.id, null, user.toJSON(), req);

    // Echo safe user fields so response shape matches register; optional fields as null.
    return successResponse(res, {
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        phone: user.phone ?? null,
        timezone: user.timezone ?? null,
        avatar_url: user.avatar_url ?? null,
      },
      token,
    }, 'Login successful');
  } catch (error) {
    logger.error('Login error:', error);
    return errorResponse(res, 'Login failed', 500);
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password_hash'] },
    });

    return successResponse(res, user, 'Profile retrieved successfully');
  } catch (error) {
    logger.error('Get profile error:', error);
    return errorResponse(res, 'Failed to retrieve profile', 500);
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { full_name, phone, timezone, avatar_url } = req.validated;
    const user = await User.findByPk(req.user.id);

    const beforeState = user.toJSON();
    await user.update({
      full_name: full_name || user.full_name,
      phone: phone !== undefined ? phone : user.phone,
      timezone: timezone || user.timezone,
      avatar_url: avatar_url !== undefined ? avatar_url : user.avatar_url,
    });

    await logAudit(req.user.id, 'profile_updated', 'users', user.id, beforeState, user.toJSON(), req);

    // Echo all safe request fields so response shape is predictable; optional as null.
    return successResponse(res, {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone ?? null,
      timezone: user.timezone ?? null,
      avatar_url: user.avatar_url ?? null,
    }, 'Profile updated successfully');
  } catch (error) {
    logger.error('Update profile error:', error);
    return errorResponse(res, 'Failed to update profile', 500);
  }
};

/**
 * Refresh JWT token
 * POST /api/auth/refresh
 * Body: { token: string }
 */
export const refreshToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return errorResponse(res, 'Token is required', 400);
    }

    // Verify the existing token (even if expired, we can decode it)
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      // If token is expired, try to decode without verification
      if (error.name === 'TokenExpiredError') {
        decoded = jwt.decode(token);
        if (!decoded) {
          return errorResponse(res, 'Invalid token', 401);
        }
      } else {
        return errorResponse(res, 'Invalid token', 401);
      }
    }

    // Find the user
    const user = await User.findByPk(decoded.userId);
    if (!user || !user.is_active) {
      return errorResponse(res, 'User not found or inactive', 401);
    }

    // Generate new token
    const newToken = jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    await logAudit(user.id, 'token_refreshed', 'users', user.id, null, { token_refreshed: true }, req);

    return successResponse(res, {
      token: newToken,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        phone: user.phone ?? null,
        timezone: user.timezone ?? null,
        avatar_url: user.avatar_url ?? null,
      },
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

    if (!user.is_active) {
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
 * Authenticated user only. Admins cannot use this (use admin user management instead).
 */
export const deleteMyAccount = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (user.role === 'admin') {
      return errorResponse(res, 'Admins cannot delete their account via this endpoint', 403);
    }

    const beforeState = user.toJSON();
    await user.update({
      deleted_at: new Date(),
      is_active: false,
    });

    const coachProfile = await CoachProfile.findOne({ where: { user_id: user.id } });
    if (coachProfile) {
      await coachProfile.update({ deleted_at: new Date() });
    }

    await logAudit(req.user.id, 'user_self_deleted', 'users', user.id, beforeState, { deleted_at: user.deleted_at }, req);

    return successResponse(res, null, 'Account deleted successfully');
  } catch (error) {
    logger.error('Delete my account error:', error);
    return errorResponse(res, 'Failed to delete account', 500);
  }
};

/**
 * Switch between student and coach (self-service)
 * PUT /api/auth/me/role
 * Body: { role: 'student' | 'coach' }
 * Admins cannot use this (they must use admin user management to change role).
 */
export const switchRole = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (user.role === 'admin') {
      return errorResponse(res, 'Admins cannot switch role via this endpoint', 403);
    }

    const { role } = req.validated;
    if (role === user.role) {
      return successResponse(res, {
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          phone: user.phone ?? null,
          timezone: user.timezone ?? null,
          avatar_url: user.avatar_url ?? null,
        },
        token: req.headers.authorization?.split(' ')[1],
      }, 'Role unchanged (already ' + user.role + ')');
    }

    const beforeState = user.toJSON();
    await user.update({ role });

    const newToken = jwt.sign({ userId: user.id, role: user.role, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    await logAudit(req.user.id, 'user_switched_role', 'users', user.id, beforeState, { role: user.role }, req);

    return successResponse(res, {
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        phone: user.phone ?? null,
        timezone: user.timezone ?? null,
        avatar_url: user.avatar_url ?? null,
      },
      token: newToken,
    }, 'Role updated successfully. Use the new token for subsequent requests.');
  } catch (error) {
    logger.error('Switch role error:', error);
    return errorResponse(res, 'Failed to switch role', 500);
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

    return successResponse(res, null, 'Password changed successfully');
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

    return successResponse(res, null, 'Email updated successfully');
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

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await user.update({
      email_verification_token: verificationToken,
      email_verification_expires: verificationExpires,
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

    const user = await User.findOne({
      where: {
        email_verification_token: token,
        email_verification_expires: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      return errorResponse(res, 'Invalid or expired verification token', 400);
    }

    const beforeState = user.toJSON();

    await user.update({
      email_verified_at: user.email_verified_at || new Date(),
      email_verification_token: null,
      email_verification_expires: null,
    });

    await logAudit(user.id, 'email_verified', 'users', user.id, beforeState, {
      email_verified_at: user.email_verified_at,
    }, req);

    return successResponse(res, null, 'Email verified successfully');
  } catch (error) {
    logger.error('Confirm email verification error:', error);
    return errorResponse(res, 'Failed to confirm email verification', 500);
  }
};
