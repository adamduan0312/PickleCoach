import { Link } from 'react-router-dom';
import { PRIVACY_PATH, TERMS_PATH } from '../../domain/legal.js';
import {
  ABOUT_ANCHOR,
  BECOME_COACH_PATH,
  CONTACT_ANCHOR,
  FAQ_PATH,
  SITE_TAGLINE,
} from '../../domain/siteContent.js';

const YEAR = new Date().getFullYear();

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <strong>PickleCoach</strong>
          <p className="small muted">{SITE_TAGLINE}</p>
        </div>
        <nav className="site-footer-links" aria-label="Footer">
          <div>
            <h3>Explore</h3>
            <Link to="/discover">Discover coaches</Link>
            <Link to={BECOME_COACH_PATH}>Become a coach</Link>
          </div>
          <div>
            <h3>Help</h3>
            <Link to={FAQ_PATH}>FAQ</Link>
            <a href={`${FAQ_PATH}#${CONTACT_ANCHOR}`}>Contact support</a>
          </div>
          <div>
            <h3>About</h3>
            <a href={`/#${ABOUT_ANCHOR}`}>About PickleCoach</a>
          </div>
          <div>
            <h3>Legal</h3>
            <Link to={TERMS_PATH}>Terms of Service</Link>
            <Link to={PRIVACY_PATH}>Privacy Policy</Link>
          </div>
        </nav>
      </div>
      <p className="small muted site-footer-copy">© {YEAR} PickleCoach</p>
    </footer>
  );
}
