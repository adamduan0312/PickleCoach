import { hasAdminRole, hasCoachRole, hasStudentRole } from '../domain/userReadiness.js';

/**
 * Experience mode for the current user. Preferred mode is kept only while that role remains.
 */
export function inferMode(user, preferred) {
  const roles = user?.roles || [];
  if (preferred && roles.includes(preferred)) return preferred;
  if (hasStudentRole(roles)) return 'student';
  if (hasCoachRole(roles)) return 'coach';
  if (hasAdminRole(roles)) return 'admin';
  return 'student';
}

export function homePathFor(user, mode) {
  const roles = user?.roles || [];
  if (mode === 'admin' && hasAdminRole(roles)) return '/admin';
  if (mode === 'coach' && hasCoachRole(roles)) return '/coach';
  if (hasStudentRole(roles)) return '/dashboard';
  if (hasCoachRole(roles)) return '/coach';
  if (hasAdminRole(roles)) return '/admin';
  return '/dashboard';
}

/**
 * Roles required by the route guard for a pathname.
 * `null` means any authenticated user (page enforces finer rules).
 * @param {string | null | undefined} pathname
 * @returns {string[] | null}
 */
export function rolesRequiredForPath(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  const path = pathname.split('?')[0];

  if (path === '/dashboard') return ['student'];
  if (path.startsWith('/book/') && path.includes('/checkout')) return ['student'];
  if (path === '/bookings/confirming') return ['student'];
  if (path === '/bookings') return ['student'];
  // /bookings/:id — shared detail; API/page enforce participant access
  if (/^\/bookings\/[^/]+$/.test(path)) return null;

  if (path === '/coach' || path.startsWith('/coach/')) return ['coach'];
  if (path === '/admin' || path.startsWith('/admin/')) return ['admin'];

  return null;
}

/**
 * @param {{ roles?: string[] } | null | undefined} user
 * @param {string | null | undefined} pathname
 */
export function userCanAccessPath(user, pathname) {
  const required = rolesRequiredForPath(pathname);
  if (!required) return true;
  const roles = user?.roles || [];
  return required.some((role) => roles.includes(role));
}

/**
 * Whether a path belongs to the active experience mode.
 * Dual-role accounts must not resume a coach URL when their restored mode is student.
 */
export function pathMatchesMode(pathname, mode) {
  if (!pathname || typeof pathname !== 'string') return false;
  const path = pathname.split('?')[0];
  const required = rolesRequiredForPath(path);

  if (mode === 'coach') {
    if (required?.includes('student') && !required.includes('coach')) return false;
    if (required?.includes('admin') && !required.includes('coach')) return false;
    return true;
  }
  if (mode === 'admin') {
    if (required?.includes('student') && !required.includes('admin')) return false;
    if (required?.length === 1 && required[0] === 'coach') return false;
    return true;
  }
  // student (default): never resume coach/admin-only areas
  if (path === '/coach' || path.startsWith('/coach/')) return false;
  if (path === '/admin' || path.startsWith('/admin/')) return false;
  return true;
}

/**
 * After login, resume `from` only when this account may access it AND it matches
 * the restored experience mode. Otherwise go to that mode's home.
 */
export function postLoginPath(user, mode, from) {
  const effectiveMode = mode
    || (hasStudentRole(user?.roles) ? 'student' : null)
    || (hasCoachRole(user?.roles) ? 'coach' : null)
    || (hasAdminRole(user?.roles) ? 'admin' : 'student');

  if (
    from
    && userCanAccessPath(user, from)
    && pathMatchesMode(from, effectiveMode)
  ) {
    return from;
  }
  return homePathFor(user, effectiveMode);
}
