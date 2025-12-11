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
    const { full_name, email, password, role = 'student', phone, timezone } = req.body;

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

    return successResponse(res, {
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
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
    const { email, password } = req.body;

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
