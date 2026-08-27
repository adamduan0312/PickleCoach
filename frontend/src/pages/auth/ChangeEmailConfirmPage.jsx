import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout.jsx';
import { Alert, LoadingState } from '../../components/ui/States.jsx';
import { authApi } from '../../api/index.js';
import { oncePerKey } from '../../api/once.js';
import { useAuth } from '../../auth/AuthContext.jsx';

export function ChangeEmailConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { applySession, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(token ? 'working' : 'missing');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    oncePerKey(`change-email:${token}`, () => authApi.confirmEmailChange(token))
      .then(async (res) => {
        if (cancelled) return;
        setStatus('ok');
        setMessage(res.message);
        if (res.data?.token) {
          await applySession(res.data.token, res.data.user);
        }
        setTimeout(() => navigate('/settings'), 1200);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(err.message);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time token; do not re-fire on auth/nav identity
  }, [token]);

  return (
    <AuthLayout title="Confirm email change">
      {status === 'working' ? <LoadingState label="Updating your email…" /> : null}
      {status === 'missing' ? <Alert tone="error">Missing confirmation token.</Alert> : null}
      {status === 'ok' ? <Alert tone="success">{message}</Alert> : null}
      {status === 'error' ? <Alert tone="error">{message}</Alert> : null}
      <p style={{ marginTop: 16 }}>
        {isAuthenticated ? <Link to="/settings">Back to settings</Link> : <Link to="/login">Log in</Link>}
      </p>
    </AuthLayout>
  );
}
