import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert } from '../ui/States.jsx';
import { PRIVACY_PATH } from '../../domain/legal.js';

export const CLOSE_ACCOUNT_BLOCKED_COPY =
  'You can’t close your account while lessons, issue reports, or payouts are still in progress.';

export function CloseAccountCard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function closeAccount() {
    setBusy(true);
    setError(null);
    try {
      await authApi.closeAccount();
      await logout();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Couldn’t close your account. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="card stack" id="close-account">
      <h2>Close account</h2>
      <p className="small muted">
        Closing your account signs you out, and you won’t be able to sign in again. If you coach, your profile is no
        longer shown. Booking, payment, message, issue and review records are kept, as described in our{' '}
        <Link to={PRIVACY_PATH}>Privacy Policy</Link>.
      </p>
      <p className="small muted">{CLOSE_ACCOUNT_BLOCKED_COPY}</p>
      <Alert tone="error">{error}</Alert>
      {confirming ? (
        <div className="stack">
          <p className="small"><strong>Close your account now?</strong> To reopen it later, you’d need to contact us.</p>
          <div className="row">
            <button className="btn danger" type="button" disabled={busy} onClick={closeAccount}>
              {busy ? 'Closing…' : 'Yes, close my account'}
            </button>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => { setConfirming(false); setError(null); }}>
              Keep my account
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button className="btn secondary" type="button" onClick={() => setConfirming(true)}>Close account…</button>
        </div>
      )}
    </div>
  );
}
