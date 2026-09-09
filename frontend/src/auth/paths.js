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
 * Shared `/bookings/:id` is participant UI + participant API. Admins in admin
 * mode must use `/admin/bookings/:id` (and `/api/admin/bookings/:id`).
 * @param {string | null | undefined} pathname
 * @returns {string | null}
 */
export function adminBookingPathFromShared(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  const path = pathname.split('?')[0];
  const match = path.match(/^\/bookings\/([^/]+)$/);
  return match ? `/admin/bookings/${match[1]}` : null;
}

/**
 * After login, resume `from` only when this account may access it AND it matches
 * the restored experience mode. Otherwise go to that mode's home.
 * Admin mode remaps shared booking detail URLs to the admin booking route.
 *
 * Callers should pass `from` only for auth-guard interruptions (see
 * {@link resumePathFromLoginState}). Normal logout → login must omit `from`
 * so the next user lands on role home, not the previous user's page.
 */
export function postLoginPath(user, mode, from) {
  const effectiveMode = mode
    || (hasStudentRole(user?.roles) ? 'student' : null)
    || (hasCoachRole(user?.roles) ? 'coach' : null)
    || (hasAdminRole(user?.roles) ? 'admin' : 'student');

  let destination = from;
  if (effectiveMode === 'admin' && hasAdminRole(user?.roles)) {
    const adminBooking = adminBookingPathFromShared(from);
    if (adminBooking) destination = adminBooking;
  }

  if (
    destination
    && userCanAccessPath(user, destination)
    && pathMatchesMode(destination, effectiveMode)
  ) {
    return destination;
  }
  return homePathFor(user, effectiveMode);
}

/**
 * Login location.state from RequireAuth / RequireRole sets `authRedirect: true`.
 * Plain visits to /login (including after logout) must not resume a path — that
 * would carry one user's page into the next account on a shared browser.
 *
 * @param {{ from?: string, authRedirect?: boolean } | null | undefined} state
 * @returns {string | null}
 */
export function resumePathFromLoginState(state) {
  if (!state || state.authRedirect !== true) return null;
  const from = state.from;
  if (!from || typeof from !== 'string') return null;
  const path = from.split('?')[0];
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}
