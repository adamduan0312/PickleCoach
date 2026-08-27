import { hasAdminRole, hasCoachRole, hasStudentRole } from '../domain/userReadiness.js';

export function homePathFor(user, mode) {
  const roles = user?.roles || [];
  if (mode === 'admin' && hasAdminRole(roles)) return '/admin';
  if (mode === 'coach' && hasCoachRole(roles)) return '/coach';
  if (hasStudentRole(roles)) return '/dashboard';
  if (hasCoachRole(roles)) return '/coach';
  if (hasAdminRole(roles)) return '/admin';
  return '/dashboard';
}
