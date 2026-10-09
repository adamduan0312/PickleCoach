import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { homePathFor } from '../auth/paths.js';
import { PublicFooter } from '../components/layout/PublicFooter.jsx';
import { LEGAL_DETAILS } from '../domain/legal.js';
import { COACH_FAQ, CONTACT_ANCHOR, STUDENT_FAQ } from '../domain/siteContent.js';

function FaqList({ items }) {
  return items.map(({ q, a }) => (
    <section className="legal-section" key={q}>
      <h3>{q}</h3>
      {a.length === 1 ? <p>{a[0]}</p> : <ul>{a.map((line) => <li key={line}>{line}</li>)}</ul>}
    </section>
  ));
}

export function FaqPage() {
  const { user, mode, isAuthenticated } = useAuth();
  const home = isAuthenticated ? homePathFor(user, mode) : '/';
  const email = LEGAL_DETAILS.contactEmail;
  return (
    <>
      <div className="page-narrow legal-page faq-page">
        <p className="small"><Link to={home}>← Back to PickleCoach</Link></p>
        <h1>Frequently asked questions</h1>

        <h2>For students</h2>
        <FaqList items={STUDENT_FAQ} />

        <h2>For coaches</h2>
        <FaqList items={COACH_FAQ} />

        <h2 id={CONTACT_ANCHOR}>Contact support</h2>
        <p>
          Need help with a booking, payment, your account, or an issue report? Email{' '}
          {email.includes('@') ? <a href={`mailto:${email}`}>{email}</a> : email}. If it’s about a specific booking,
          include the booking number.
        </p>
        <p className="small muted">
          To report a problem with a lesson, use “Report issue” on the booking page — issue reports there are tracked
          with the booking and must be made within 24 hours after the lesson ends.
        </p>
      </div>
      <PublicFooter />
    </>
  );
}
