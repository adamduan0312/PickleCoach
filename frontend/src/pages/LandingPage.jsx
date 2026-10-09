import { Link } from 'react-router-dom';
import { PRIVACY_PATH, TERMS_PATH } from '../domain/legal.js';
import { BENEFITS_HEADING, BENEFITS_INTRO, COACH_BENEFITS, STUDENT_BENEFITS } from '../domain/platformBenefits.js';

function BenefitList({ heading, items }) {
  return (
    <div className="card landing-benefits-card">
      <h3>{heading}</h3>
      <ul className="landing-benefits-list">
        {items.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span className="muted">{item.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
      <section className="landing-benefits" aria-labelledby="landing-benefits-heading">
        <h2 id="landing-benefits-heading">{BENEFITS_HEADING}</h2>
        <p className="muted">{BENEFITS_INTRO}</p>
        <div className="grid-2">
          <BenefitList heading="For students" items={STUDENT_BENEFITS} />
          <BenefitList heading="For coaches" items={COACH_BENEFITS} />
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
