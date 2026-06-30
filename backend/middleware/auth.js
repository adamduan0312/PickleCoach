import jwt from 'jsonwebtoken';
import { User, UserRole } from '../models/index.js';
import { effectiveRolesFromGovernance, getDbRoleAssignments } from '../utils/roleGovernance.js';

/** Expect `Authorization: Bearer <jwt>`. Rejects missing/malformed scheme (no silent "raw token" fallback). */
function parseBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') return null;
  const match = authorizationHeader.trim().match(/^Bearer\s+(\S+)/i);
  return match ? match[1] : null;
}

/** Load user + effective roles from JWT; throws on invalid/revoked token or inactive user. */
async function loadUserForRequest(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
  const user = await User.findByPk(decoded.userId, {
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });

  if (!user) {
    const err = new Error('Invalid or inactive user');
    err.authStatus = 401;
    err.authBody = { error: 'Invalid or inactive user' };
    throw err;
  }
  if (user.deleted_at) {
    const err = new Error('User deleted');
    err.authStatus = 401;
    err.authBody = {
      error: 'This account has been deleted. Log in with a different account or ask an administrator to restore access.',
    };
    throw err;
  }
  if (!user.is_active) {
    const err = new Error('User inactive');
    err.authStatus = 401;
    err.authBody = {
      error: 'This account is inactive. Contact support if you need access restored.',
    };
    throw err;
  }

  const tokenVersionFromToken = decoded.tokenVersion ?? 0;
  const currentTokenVersion = user.token_version ?? 0;
  if (currentTokenVersion !== tokenVersionFromToken) {
    const err = new Error('Token revoked');
    err.authStatus = 401;
    err.authBody = { error: 'Token has been revoked. Please log in again.' };
    throw err;
  }

  const dbRoleAssignments = getDbRoleAssignments(user);
  /** @type {string[]} ONLY source for `authorize()` and route-level permission checks on this request. */
  const activePermissions = effectiveRolesFromGovernance(dbRoleAssignments, user);
  user.dbRoleAssignments = dbRoleAssignments;
  user.roles = activePermissions;
  user.effectiveRoles = activePermissions;
  return user;
}

function respondAuthError(res, error) {
  if (error?.authStatus && error?.authBody) {
    return res.status(error.authStatus).json(error.authBody);
  }
  return res.status(401).json({ error: 'Invalid token' });
}

export const authenticate = async (req, res, next) => {
  const token = parseBearerToken(req.headers.authorization || '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = await loadUserForRequest(token);
    next();
  } catch (error) {
    return respondAuthError(res, error);
  }
};

/** Sets `req.user` when a valid Bearer token is present; continues anonymously when omitted. */
export const optionalAuthenticate = async (req, res, next) => {
  const token = parseBearerToken(req.headers.authorization || '');
  if (!token) {
    return next();
  }
  try {
    req.user = await loadUserForRequest(token);
    next();
  } catch (error) {
    return respondAuthError(res, error);
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
