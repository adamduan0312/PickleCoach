import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { LoadingState } from '../components/ui/States.jsx';
import { homePathFor } from './paths.js';
import { isIntentionalLogout } from './logoutIntent.js';

export function GuestOnly({ children }) {
  const { isAuthenticated, bootstrapping, user, mode } = useAuth();
  if (bootstrapping) return <LoadingState label="Loading session…" />;
  if (isAuthenticated) {
    // Same destination as a fresh login with no return URL.
    return <Navigate to={homePathFor(user, mode)} replace />;
  }
  return children;
}

export function RequireAuth({ children }) {
  const { isAuthenticated, bootstrapping } = useAuth();
  const location = useLocation();
  if (bootstrapping) return <LoadingState label="Loading session…" />;
  if (!isAuthenticated) {
    // Intentional logout: clean login, do not resume the page we just left.
    if (isIntentionalLogout()) {
      return <Navigate to="/login" replace />;
    }
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname, authRedirect: true }}
      />
    );
  }
  return children;
}

export function RequireRole({ roles, children }) {
  const { user, bootstrapping, isAuthenticated } = useAuth();
  const location = useLocation();
  if (bootstrapping) return <LoadingState label="Loading session…" />;
  if (!isAuthenticated) {
    if (isIntentionalLogout()) {
      return <Navigate to="/login" replace />;
    }
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname, authRedirect: true }}
      />
    );
  }
  const userRoles = user?.roles || [];
  const ok = roles.some((role) => userRoles.includes(role));
  if (!ok) {
    return <Navigate to="/forbidden" replace />;
  }
  return children;
}

/**
 * Mode-scoped booking surfaces (checkout). Roles still authorize via RequireRole;
 * active mode must be Student so Coach mode cannot initiate bookings.
 */
export function RequireStudentMode({ children }) {
  const { mode, bootstrapping, isAuthenticated, user } = useAuth();
  if (bootstrapping) return <LoadingState label="Loading session…" />;
  if (!isAuthenticated) {
    if (isIntentionalLogout()) {
      return <Navigate to="/login" replace />;
    }
    return <Navigate to="/login" replace />;
  }
  if (mode !== 'student') {
    return <Navigate to={homePathFor(user, mode)} replace />;
  }
  return children;
}
