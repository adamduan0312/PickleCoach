import { Link } from 'react-router-dom';
import { PRIVACY_PATH, TERMS_PATH } from '../domain/legal.js';

export function LandingPage() {
  return (
    <div>
      <header className="app-header">
        <Link className="brand" to="/">
          <span className="brand-mark">P</span>
          PickleCoach
        </Link>
        <div className="header-actions">
          <Link className="btn ghost" to="/login">Log in</Link>
          <Link className="btn" to="/register">Get started</Link>
        </div>
      </header>
      <section className="hero">
        <h1>Book pickleball lessons with local coaches.</h1>
        <p>
          PickleCoach connects students with coaches. Find a coach, pick a lesson and time,
          authorize payment, and get on the court.
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
          <Link className="btn" to="/register">Create an account</Link>
          <Link className="btn secondary" to="/login">I already have an account</Link>
        </div>
      </section>
      <footer className="legal-footer small muted">
        <Link to={TERMS_PATH}>Terms of Service</Link>
        <span aria-hidden="true"> · </span>
        <Link to={PRIVACY_PATH}>Privacy Policy</Link>
      </footer>
    </div>
  );
}
