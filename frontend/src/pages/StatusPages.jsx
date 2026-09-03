import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { homePathFor } from '../auth/paths.js';

export function ForbiddenPage() {
  const { user, mode, isAuthenticated } = useAuth();
  const home = isAuthenticated ? homePathFor(user, mode) : '/';

  return (
    <div className="page-narrow">
      <h1>You don’t have access to that page</h1>
      <p className="muted">Your account role doesn’t include this area of PickleCoach.</p>
      <Link className="btn" to={home}>Go home</Link>
    </div>
  );
}

export function NotFoundPage() {
  const { user, mode, isAuthenticated } = useAuth();
  const home = isAuthenticated ? homePathFor(user, mode) : '/';

  return (
    <div className="page-narrow">
      <h1>Page not found</h1>
      <p className="muted">That URL isn’t part of the PickleCoach app.</p>
      <Link className="btn" to={home}>Go home</Link>
    </div>
  );
}
