import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findByPk(decoded.userId);

    if (!user || !user.is_active || user.deleted_at) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    // Token versioning: ensure token has not been revoked
    const tokenVersionFromToken = decoded.tokenVersion ?? 0;
    const currentTokenVersion = user.token_version ?? 0;
    if (currentTokenVersion !== tokenVersionFromToken) {
      return res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const requireVerifiedEmail = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!req.user.email_verified_at) {
    return res.status(403).json({
      error: 'Email verification required to perform this action. Please verify your email.',
    });
  }

  return next();
};
