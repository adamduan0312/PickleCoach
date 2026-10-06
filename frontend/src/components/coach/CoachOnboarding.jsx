import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { coachesApi } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { StatusBadge } from '../ui/States.jsx';
import { setupContinuation } from '../../domain/coachSetup.js';

function ReadyToBeDiscovered({ userId }) {
  return (
    <>
      <h2 className="coach-onboarding-title">You’re ready to be discovered! ✓</h2>
      <p className="small">Your coach profile can now appear in Discover.</p>
      {userId ? <Link className="btn secondary" to={`/coaches/${userId}`}>View public profile</Link> : null}
    </>
  );
}

function stepStatus(item, isNext) {
  if (item.done) return <span className="coach-onboarding-status done">✓ Complete</span>;
  if (item.disabled) return <span className="coach-onboarding-status small muted">{item.hint}</span>;
  if (isNext) return <span className="badge info">Next step</span>;
  return <span className="coach-onboarding-status muted" aria-hidden="true">○</span>;
}

/**
 * Dashboard "Get listed on Discover" card: the five required steps, progress, and the
 * current step's call to action in one place. Collapses to a short confirmation once listed.
 */
export function CoachOnboardingCard({ listed, setup, userId, onRefresh }) {
  if (listed) {
    return (
      <section className="card coach-onboarding" aria-labelledby="coach-onboarding-title">
        <div className="spread">
          <span id="coach-onboarding-title" className="small muted coach-next-step-label">Discover</span>
          <StatusBadge status="listed" label="Listed for students" tone="success" />
        </div>
        <ReadyToBeDiscovered userId={userId} />
      </section>
    );
  }

  const { checklist, next, doneCount, total } = setup;
  const percent = Math.round((doneCount / total) * 100);

  return (
    <section className="card coach-onboarding" aria-labelledby="coach-onboarding-title">
      <div className="spread">
        <h2 id="coach-onboarding-title" className="coach-onboarding-title">Get listed on Discover</h2>
        <StatusBadge status="unlisted" label="Not listed yet" tone="warning" />
      </div>
      <p className="small muted">Complete these {total} steps so students can find and book you.</p>

      <div className="coach-onboarding-progress">
        <span className="small"><strong>{doneCount} of {total}</strong> complete</span>
        <div
          className="coach-onboarding-bar"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={doneCount}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>

      <ol className="coach-onboarding-steps">
        {checklist.map((item, i) => {
          const isNext = next?.key === item.key;
          return (
            <li
              key={item.key}
              className={`${item.done ? 'done' : ''}${isNext ? ' current' : ''}${item.disabled ? ' disabled' : ''}`}
            >
              <span className="coach-onboarding-num" aria-hidden="true">{i + 1}</span>
              {item.disabled ? (
                <span aria-disabled="true">{item.label}</span>
              ) : (
                <Link to={item.to}>
                  {item.label}
                  <span className="visually-hidden">{item.done ? ' (done)' : ' (not done)'}</span>
                </Link>
              )}
              {stepStatus(item, isNext)}
            </li>
          );
        })}
      </ol>

      {next ? (
        <div className="coach-onboarding-next">
          <h3>Next: {next.title}</h3>
          <p className="small">{next.detail}</p>
          <Link className="btn" to={next.to}>{next.cta} →</Link>
        </div>
      ) : null}

      <div className="row">
        <button type="button" className="btn ghost" onClick={onRefresh}>Refresh</button>
      </div>
    </section>
  );
}

/**
 * Shown on a setup page once that page's step is done, so the coach can go straight to the
 * next step instead of back to the dashboard. Hidden for coaches who were already listed
 * when the page opened. `refreshKey` changes (e.g. the page's success message) re-check status.
 * A next step on this same page (the profile photo) scrolls to it instead of linking.
 */
export function SetupNextStep({ step, refreshKey }) {
  const { user, readiness } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState(null);
  const [listedAtLoad, setListedAtLoad] = useState(null);
  const hasStatus = status !== null;

  useEffect(() => {
    // Pages clear their message before each action; only a new message needs a re-check.
    if (refreshKey == null && hasStatus) return undefined;
    let alive = true;
    coachesApi.marketplaceStatus()
      .then((res) => {
        if (!alive) return;
        setListedAtLoad((prev) => (prev === null ? Boolean(res.data?.listed) : prev));
        setStatus(res.data);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, readiness.coachUiPhase]);

  if (!status || listedAtLoad) return null;
  const view = setupContinuation(step, status.steps, {
    coachUiPhase: readiness.coachUiPhase,
    profileExists: status.profile_exists,
    profileMissingFields: status.profile_missing_fields,
  });
  if (!view) return null;

  return (
    <div className="card coach-onboarding coach-continue" aria-live="polite">
      <p className="coach-continue-done">✓ {view.doneLabel}</p>
      {view.next ? (
        <>
          <h2 className="coach-onboarding-title">Next: {view.next.title}</h2>
          <p className="small">{view.next.detail}</p>
          {view.next.anchor && view.next.to === location.pathname ? (
            <button
              type="button"
              className="btn"
              onClick={() => document.getElementById(view.next.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            >
              {view.next.cta} ↑
            </button>
          ) : (
            <Link className="btn" to={view.next.to}>{view.next.cta} →</Link>
          )}
        </>
      ) : (
        <ReadyToBeDiscovered userId={user?.id} />
      )}
    </div>
  );
}
