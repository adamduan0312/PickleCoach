import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { logger } from '../config/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export const register = async (req, res) => {
  try {
    const { full_name, email, password, role, phone, timezone } = req.validated;

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
    });

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    await logAudit(user.id, 'user_registered', 'users', user.id, null, user.toJSON(), req);

    // Return user data - role is only 'student' or 'coach' from registration
    // Never expose admin role option to normal users
    return successResponse(res, {
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role, // Will be 'student' or 'coach' only
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

    // Return user data - role will be 'student', 'coach', or 'admin'
    // Frontend should handle admin differently (redirect to admin dashboard)
    // Normal users won't see admin-related UI elements
    return successResponse(res, {
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
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
    const { full_name, phone, timezone, avatar_url } = req.body;
    const user = await User.findByPk(req.user.id);

    const beforeState = user.toJSON();
    await user.update({
      full_name: full_name || user.full_name,
      phone: phone !== undefined ? phone : user.phone,
      timezone: timezone || user.timezone,
      avatar_url: avatar_url !== undefined ? avatar_url : user.avatar_url,
    });

    await logAudit(req.user.id, 'profile_updated', 'users', user.id, beforeState, user.toJSON(), req);

    return successResponse(res, {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      timezone: user.timezone,
      avatar_url: user.avatar_url,
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
        avatar_url: user.avatar_url,
      },
    }, 'Token refreshed successfully');
  } catch (error) {
    logger.error('Refresh token error:', error);
    return errorResponse(res, 'Failed to refresh token', 500);
  }
};
