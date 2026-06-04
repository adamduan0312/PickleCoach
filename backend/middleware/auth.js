import jwt from 'jsonwebtoken';
import { User, UserRole } from '../models/index.js';
import { effectiveRolesFromGovernance, getDbRoleAssignments } from '../utils/roleGovernance.js';

/** Expect `Authorization: Bearer <jwt>`. Rejects missing/malformed scheme (no silent "raw token" fallback). */
function parseBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') return null;
  const match = authorizationHeader.trim().match(/^Bearer\s+(\S+)/i);
  return match ? match[1] : null;
}

export const authenticate = async (req, res, next) => {
  try {
    const token = parseBearerToken(req.headers.authorization || '');

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findByPk(decoded.userId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }
    if (user.deleted_at) {
      return res.status(401).json({
        error: 'This account has been deleted. Log in with a different account or ask an administrator to restore access.',
      });
    }
    if (!user.is_active) {
      return res.status(401).json({
        error: 'This account is inactive. Contact support if you need access restored.',
      });
    }

    // Token versioning: ensure token has not been revoked
    const tokenVersionFromToken = decoded.tokenVersion ?? 0;
    const currentTokenVersion = user.token_version ?? 0;
    if (currentTokenVersion !== tokenVersionFromToken) {
      return res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
    }

    req.user = user;
    const dbRoleAssignments = getDbRoleAssignments(user);
    /** @type {string[]} ONLY source for `authorize()` and route-level permission checks on this request. */
    const activePermissions = effectiveRolesFromGovernance(dbRoleAssignments, user);
    req.user.dbRoleAssignments = dbRoleAssignments;
    req.user.roles = activePermissions;
    req.user.effectiveRoles = activePermissions;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

/** Check if the authenticated user has at least one allowed role (uses **`req.user.roles`** = effective / active permissions only). */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const roles = req.user.roles || [];
    if (!allowedRoles.some((r) => roles.includes(r))) {
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

/** For routes where students/coaches must verify email but admins may act without (e.g. support-created disputes). */
export const requireVerifiedEmailUnlessAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const roles = req.user.roles || [];
  if (roles.includes('admin')) {
    return next();
  }
  if (!req.user.email_verified_at) {
    return res.status(403).json({
      error: 'Email verification required to perform this action. Please verify your email.',
    });
  }
  return next();
};
