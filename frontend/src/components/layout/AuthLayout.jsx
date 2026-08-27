import { Link } from 'react-router-dom';

export function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="page-narrow">
      <Link className="brand" to="/" style={{ marginBottom: 24, display: 'inline-flex' }}>
        <span className="brand-mark">P</span>
        PickleCoach
      </Link>
      <h1>{title}</h1>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
      <div className="card" style={{ marginTop: 16 }}>
        {children}
      </div>
    </div>
  );
}
