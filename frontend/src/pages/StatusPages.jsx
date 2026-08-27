import { Link } from 'react-router-dom';

export function ForbiddenPage() {
  return (
    <div className="page-narrow">
      <h1>You don’t have access to that page</h1>
      <p className="muted">Your account role doesn’t include this area of PickleCoach.</p>
      <Link className="btn" to="/">Go home</Link>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="page-narrow">
      <h1>Page not found</h1>
      <p className="muted">That URL isn’t part of the PickleCoach app.</p>
      <Link className="btn" to="/">Go home</Link>
    </div>
  );
}
