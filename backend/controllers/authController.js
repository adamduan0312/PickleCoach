import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { User } from '../models/index.js';
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

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
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

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
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
    const newToken = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
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
    });

    await logAudit(user.id, 'password_reset_completed', 'users', user.id, beforeState, { password_reset: true }, req);

    return successResponse(res, null, 'Password reset successfully', 200);
  } catch (error) {
    logger.error('Reset password error:', error);
    return errorResponse(res, 'Failed to reset password', 500);
  }
};
