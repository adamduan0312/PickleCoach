import { Link, useLocation, useNavigate } from 'react-router-dom';
import { backLinkTarget } from '../../utils/backNavigation.js';

/**
 * "Back" that returns to the page the user actually came from inside the app, or to `fallbackTo`
 * when the page was opened directly (new tab, bookmark, email link).
 */
export function BackLink({ fallbackTo, fallbackLabel, className, alwaysFallback = false, arrow = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const target = backLinkTarget({
    state: location.state,
    historyIdx: window.history.state?.idx,
    fallbackTo,
    fallbackLabel,
    alwaysFallback,
  });
  const content = arrow ? (
    <>
      <span aria-hidden="true">←</span>
      {target.label}
    </>
  ) : target.label;

  if (target.kind === 'link') {
    return <Link className={className} to={target.href}>{content}</Link>;
  }
  return (
    <a
      className={className}
      href={target.href}
      onClick={(e) => {
        // Modified clicks (new tab/window) keep the plain link behaviour.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(-1);
      }}
    >
      {content}
    </a>
  );
}
