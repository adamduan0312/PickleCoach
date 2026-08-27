import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout.jsx';
import { Alert, LoadingState } from '../../components/ui/States.jsx';
import { authApi, getStoredToken } from '../../api/index.js';
import { oncePerKey } from '../../api/once.js';
import { useAuth } from '../../auth/AuthContext.jsx';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { isAuthenticated, refreshProfile } = useAuth();
  const [status, setStatus] = useState(token ? 'working' : 'missing');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    oncePerKey(`verify-email:${token}`, () => authApi.confirmEmailVerification(token))
      .then(async (res) => {
        if (cancelled) return;
        setStatus('ok');
        setMessage(res.message);
        // Prefer stored JWT over isAuthenticated — auth may still be bootstrapping
        // when this effect first runs, so skipping refresh left the banner stuck.
        if (getStoredToken()) {
          try { await refreshProfile(); } catch { /* ignore */ }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(err.message);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time token confirm
  }, [token]);

  return (
    <AuthLayout title="Email verification">
      {status === 'working' ? <LoadingState label="Verifying your email…" /> : null}
      {status === 'missing' ? <Alert tone="error">This page needs a token from your verification email.</Alert> : null}
      {status === 'ok' ? <Alert tone="success">{message || 'Email verified successfully.'}</Alert> : null}
      {status === 'error' ? <Alert tone="error">{message}</Alert> : null}
      <p style={{ marginTop: 16 }}>
        {isAuthenticated || getStoredToken() ? <Link to="/dashboard">Continue to the app</Link> : <Link to="/login">Log in</Link>}
      </p>
    </AuthLayout>
  );
}
