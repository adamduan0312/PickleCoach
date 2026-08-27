import { useState } from 'react';
import { Link } from 'react-router-dom';
import { coachesApi } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, LoadingState } from '../../components/ui/States.jsx';
import { useAsync } from '../../hooks/useAsync.js';

function payoutReadinessCopy(data) {
  if (!data) return null;
  if (data.stripe_ready || data.payouts_enabled) {
    return {
      tone: 'success',
      title: 'Payouts ready',
      body: 'Stripe payouts are enabled. You can appear in student discovery once lessons, teaching courts, and availability are also complete.',
    };
  }
  if (data.details_submitted && !data.payouts_enabled) {
    return {
      tone: 'warning',
      title: 'Stripe is reviewing your account',
      body: 'You’ve submitted details, but payouts aren’t enabled yet. Students can’t discover you until payouts are on. Check Stripe or resume onboarding if anything is still missing.',
    };
  }
  if (data.onboarded && !data.details_submitted) {
    return {
      tone: 'warning',
      title: 'Finish Stripe setup',
      body: 'Your Stripe account was started but details aren’t complete. Finish onboarding so you can receive payouts and appear in Discover.',
    };
  }
  return {
    tone: 'info',
    title: 'Connect Stripe to get paid',
    body: 'Students can only discover you after payouts are enabled. You’ll complete a short form on Stripe’s site — PickleCoach never stores your bank details.',
  };
}

export function StripeConnectPage() {
  const { refreshProfile, refreshStripeStatus, user } = useAuth();
  const { data, error, loading } = useAsync(() => coachesApi.stripeStatus().then((r) => r.data), [user?.id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const readiness = payoutReadinessCopy(data);

  async function onboard() {
    setBusy(true);
    setErr(null);
    try {
      const res = await coachesApi.stripeOnboard();
      const url = res.data?.onboarding_url;
      await refreshProfile();
      await refreshStripeStatus();
      if (url) window.location.href = url;
      else setErr('No onboarding URL returned.');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Payouts</h1>
      <p className="muted">
        Connect a Stripe account so you can receive lesson payouts. Marketplace discovery stays off until payouts are enabled.
      </p>
      {loading ? <LoadingState /> : null}
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      <Alert tone="error">{err}</Alert>
      {data && readiness ? (
        <div className="card stack">
          <Alert tone={readiness.tone}>
            <strong>{readiness.title}</strong>
            <div className="small" style={{ marginTop: 4 }}>{readiness.body}</div>
          </Alert>
          <ul className="small muted" style={{ margin: 0, paddingLeft: '1.1rem' }}>
            <li>Account started: {data.onboarded ? 'Yes' : 'Not yet'}</li>
            <li>Details submitted: {data.details_submitted ? 'Yes' : 'Not yet'}</li>
            <li>Payouts enabled: {data.payouts_enabled ? 'Yes' : 'Not yet'}</li>
          </ul>
          {!data.stripe_ready ? (
            <button className="btn" type="button" disabled={busy} onClick={onboard}>
              {busy ? 'Opening Stripe…' : data.onboarded ? 'Resume Stripe setup' : 'Connect Stripe'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function StripeReturnPage() {
  const { refreshProfile, refreshStripeStatus } = useAuth();
  useAsync(async () => {
    await refreshStripeStatus();
    await refreshProfile();
    return true;
  }, []);
  return (
    <div className="page">
      <h1>Stripe setup</h1>
      <p>If you finished Stripe’s form, status updates here shortly. You can also reopen the payouts page from your coach dashboard.</p>
      <Link className="btn" to="/coach/stripe">Check payout status</Link>
    </div>
  );
}

export function StripeRefreshPage() {
  return <StripeConnectPage />;
}
