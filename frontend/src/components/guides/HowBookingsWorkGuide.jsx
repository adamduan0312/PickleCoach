import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { guideForRole } from '../../domain/howBookingsWork.js';
import {
  dismissHowBookingsWork,
  isHowBookingsWorkDismissed,
  reopenHowBookingsWork,
} from '../../utils/howBookingsWorkStorage.js';

/**
 * Short dismissible how-bookings card for dashboards.
 * Reopen via `?guide=1` (Settings / Account) even after dismiss.
 */
export function HowBookingsWorkGuide({ userId, role }) {
  const guide = guideForRole(role);
  const [searchParams, setSearchParams] = useSearchParams();
  const forceOpen = searchParams.get('guide') === '1';
  const [visible, setVisible] = useState(() => {
    if (!guide || userId == null) return false;
    if (forceOpen) return true;
    return !isHowBookingsWorkDismissed(userId, role);
  });

  useEffect(() => {
    if (!guide || userId == null) {
      setVisible(false);
      return;
    }
    if (forceOpen) {
      reopenHowBookingsWork(userId, role);
      setVisible(true);
      return;
    }
    setVisible(!isHowBookingsWorkDismissed(userId, role));
  }, [guide, userId, role, forceOpen]);

  if (!guide || !visible) return null;

  function clearGuideParam() {
    if (!forceOpen) return;
    const next = new URLSearchParams(searchParams);
    next.delete('guide');
    setSearchParams(next, { replace: true });
  }

  function onGotIt() {
    dismissHowBookingsWork(userId, role);
    clearGuideParam();
    setVisible(false);
  }

  return (
    <section className="card how-bookings-guide" aria-labelledby={`how-bookings-guide-${role}`}>
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={`how-bookings-guide-${role}`}>{guide.title}</h2>
          <p className="how-bookings-guide-highlight">{guide.highlight}</p>
          <ol className="how-bookings-guide-steps">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <button type="button" className="btn secondary" onClick={onGotIt}>
          Got it
        </button>
      </div>
      <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
        You can open this again anytime from Account settings.
      </p>
    </section>
  );
}
