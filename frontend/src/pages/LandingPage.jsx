import { Link } from 'react-router-dom';
import { PublicFooter } from '../components/layout/PublicFooter.jsx';
import { BENEFITS_HEADING, BENEFITS_INTRO, COACH_BENEFITS, STUDENT_BENEFITS } from '../domain/platformBenefits.js';
import {
  ABOUT_ANCHOR,
  ABOUT_TEXT,
  BECOME_COACH_PATH,
  FAQ_PATH,
  FIND_COACH_PATH,
  HOME_SUBHEADING,
  HOW_IT_WORKS,
  SITE_TAGLINE,
} from '../domain/siteContent.js';

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
        <h1>{SITE_TAGLINE}</h1>
        <p>{HOME_SUBHEADING}</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
          <Link className="btn" to={FIND_COACH_PATH}>Find a coach</Link>
          <Link className="btn secondary" to={BECOME_COACH_PATH}>Become a coach</Link>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </section>
      <section className="landing-about" id={ABOUT_ANCHOR} aria-labelledby="landing-about-heading">
        <h2 id="landing-about-heading">About PickleCoach</h2>
        <p className="muted">{ABOUT_TEXT}</p>
        <ol className="landing-steps">
          {HOW_IT_WORKS.map((step) => (
            <li className="card" key={step.title}>
              <strong>{step.title}</strong>
              <span className="muted">{step.body}</span>
            </li>
          ))}
        </ol>
        <p className="small muted">
          Questions? Read the <Link to={FAQ_PATH}>FAQ</Link>.
        </p>
      </section>
      <section className="landing-benefits" aria-labelledby="landing-benefits-heading">
        <h2 id="landing-benefits-heading">{BENEFITS_HEADING}</h2>
        <p className="muted">{BENEFITS_INTRO}</p>
        <div className="grid-2">
          <BenefitList heading="For students" items={STUDENT_BENEFITS} />
          <BenefitList heading="For coaches" items={COACH_BENEFITS} />
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
